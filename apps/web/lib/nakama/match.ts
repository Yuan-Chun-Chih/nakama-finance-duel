import type {
  Match,
  MatchData,
  MatchmakerMatched,
  MatchmakerTicket,
  MatchPresenceEvent,
  Presence,
  Socket,
} from "@heroiclabs/nakama-js";

import { cryptoFallbackId, getNakamaClient, requireLiveSession, safeStorageGet, safeStorageRemove, safeStorageSet } from "./client";
import { getRuntimeContext, parseRpcPayload } from "./client";
import type {
  GroupKind,
  FinanceHistoryPage,
  FinanceMatchmakingView,
  MatchCandleView,
  MatchGameType,
  RelayedMatchEvent,
  RelayedMatchPayload,
  RelayedMatchPresenceEvent,
  RelayedMatchPresenceView,
  RelayedMatchSession,
} from "./types";

export type MatchExchangeNotification = {
  kind?: string;
  eventType?: string;
  communityId?: string;
  communityKind?: GroupKind;
  matchId?: string;
  stateVersion?: number;
  referenceId?: string;
  createdAt?: string;
};

// 舊 relayed 面板使用的訊息代碼；Finance authoritative 對局使用下方獨立代碼。
export const RELAYED_MATCH_OP_CODES = {
  initialStateRequest: 90,
  initialStateSnapshot: 91,
  readyState: 100,
  roundStart: 110,
  tradeAction: 120,
  emote: 130,
  timerSync: 140,
  ping: 150,
  pong: 151,
  hostTransfer: 160,
  portfolioSync: 170,
  matchEnd: 190,
} as const;

// Finance 前端只送意圖，state/event 則由 authoritative runtime 回傳。
export const FINANCE_MATCH_OP_CODES = {
  ready: 220,
  order: 221,
  cancel: 222,
  stateRequest: 223,
  state: 224,
  event: 225,
  resign: 226,
  matchCancel: 227,
} as const;
// Finance authoritative 對局的 state/event 由 runtime 回傳，前端不直接送出。
const MAX_RELAYED_MATCH_PAYLOAD_BYTES = 2300;
const MIN_RELAYED_MATCH_SEND_INTERVAL_MS = 80;

// 同一登入使用者共用一條 Nakama realtime socket，避免每個面板重複連線。
let cachedMatchSocket: Socket | null = null;
let cachedMatchSocketUserId: string | null = null;

// 依 matchId 分流 socket callback，讓不同 React component 只收到自己的房間事件。
const matchDataListeners = new Map<string, Set<(event: RelayedMatchEvent) => void>>();
const matchPresenceListeners = new Map<string, Set<(event: RelayedMatchPresenceEvent) => void>>();
const matchmakerListeners = new Set<(matched: MatchmakerMatched) => void>();
const realtimeConnectionListeners = new Set<(connected: boolean) => void>();
const matchExchangeNotificationListeners = new Set<(notification: MatchExchangeNotification) => void>();

// Directed send 需要 SDK Presence，因此快取每場 match 的 sessionId -> Presence 對照。
const matchPresenceCache = new Map<string, Map<string, Presence>>();

// sequence 用於前端事件排序；send throttle 避免相同 opcode 在極短時間大量送出。
const matchSequenceCounters = new Map<string, number>();
const matchLastSendAt = new Map<string, number>();
const RELAYED_MATCH_RESUME_KEY = "nakama.relayedMatch.resume";

// Refresh resume 只保存重新加入房間所需 metadata，不保存 authoritative state。
export type RelayedMatchResumeState = {
  matchId: string;
  gameType?: MatchGameType;
  communityId?: string;
  kind?: GroupKind;
  name?: string;
  savedAt: string;
};

// Nakama matchmaker 查詢條件與配對屬性。
export type RelayedMatchmakerOptions = {
  query?: string;
  minCount?: number;
  maxCount?: number;
  stringProperties?: Record<string, string>;
  numericProperties?: Record<string, number>;
};

// 透過 RPC 建立 authoritative Finance match，再加入 server 建立的 matchId。
export async function createFinanceMatch(name?: string): Promise<RelayedMatchSession> {
  const session = await requireLiveSession();
  const response = await getNakamaClient().rpc(session, getRuntimeContext().createFinanceMatchRpcId, {
    name: name?.trim() || "BTC trading duel",
  });
  const parsed = parseRpcPayload<{ matchId: string }>(response);
  return joinRelayedMatch(parsed.matchId);
}

// 讀取 Finance stats、分頁對局，以及指定 arena 的 orders/fills/portfolio snapshots。
export async function listFinanceHistory(payload?: { arenaId?: string; limit?: number; cursor?: string }): Promise<FinanceHistoryPage> {
  const session = await requireLiveSession();
  const response = await getNakamaClient().rpc(session, getRuntimeContext().listFinanceHistoryRpcId, payload ?? {});
  return parseRpcPayload<FinanceHistoryPage>(response);
}
export async function listMatchCandles(payload: { symbol: string; limit?: number }): Promise<MatchCandleView[]> {
  const session = await requireLiveSession();
// 從 runtime storage 讀取 candle feed，前端不直接連外部交易所。
  const response = await getNakamaClient().rpc(session, getRuntimeContext().listMatchCandlesRpcId, {
    symbol: payload.symbol,
    limit: payload.limit ?? 120,
  });
  const parsed = parseRpcPayload<{ candles?: MatchCandleView[] }>(response);
  return parsed.candles ?? [];
}

// 使用 matchId 或 matchmaker token 加入 Nakama realtime match。
export async function joinRelayedMatch(matchId: string, token?: string): Promise<RelayedMatchSession> {
  const trimmedMatchId = safeTrim(matchId);
  const trimmedToken = safeTrim(token);
  if (!trimmedMatchId && !trimmedToken) {
    throw new Error("Match id or match token is required.");
  }

  const socket = await ensureRelayedMatchSocket();
  const match = await socket.joinMatch(trimmedMatchId || undefined, trimmedToken || undefined);
  return cacheAndNormalizeMatch(match);
}

// 離開房間後一併清除 listener、presence 與 sequence cache，避免 stale state。
export async function leaveRelayedMatch(matchId: string): Promise<void> {
  const trimmedMatchId = safeTrim(matchId);
  if (!trimmedMatchId) {
    return;
  }

  const socket = await ensureRelayedMatchSocket();
  try {
    await socket.leaveMatch(trimmedMatchId);
  } finally {
    clearRelayedMatchLocalState(trimmedMatchId);
  }
}

// 廣播 match data；送出前統一補 sequence/createdAt 並檢查 payload 大小。
export async function sendRelayedMatchState(
  matchId: string,
  opCode: number,
  payload: RelayedMatchPayload | Record<string, unknown>,
): Promise<void> {
  const trimmedMatchId = safeTrim(matchId);
  if (!trimmedMatchId) {
    throw new Error("Match id is required.");
  }

  const socket = await ensureRelayedMatchSocket();
  await guardRelayedMatchSend(trimmedMatchId, opCode);
  await socket.sendMatchState(trimmedMatchId, opCode, encodeRelayedMatchPayload(trimmedMatchId, payload));
}

// 只送給指定 session，適合 reconnect snapshot reply 或 pong。
export async function sendRelayedMatchStateToPresenceIds(
  matchId: string,
  opCode: number,
  payload: RelayedMatchPayload | Record<string, unknown>,
  recipientSessionIds: string[],
): Promise<void> {
  const trimmedMatchId = safeTrim(matchId);
  if (!trimmedMatchId) {
    throw new Error("Match id is required.");
  }

  const recipients = resolveRecipientPresences(trimmedMatchId, recipientSessionIds);
  if (!recipients.length) {
    throw new Error("No valid recipient presence found for directed match state.");
  }

  const socket = await ensureRelayedMatchSocket();
  await guardRelayedMatchSend(trimmedMatchId, opCode);
  await socket.sendMatchState(trimmedMatchId, opCode, encodeRelayedMatchPayload(trimmedMatchId, payload), recipients);
}

// 舊 relayed Ready 訊息；Ready 狀態需由接收端自行彙整。
export async function sendRelayedReadyState(matchId: string, ready: boolean): Promise<void> {
  await sendRelayedMatchState(matchId, RELAYED_MATCH_OP_CODES.readyState, {
    kind: "ready_state",
    ready,
    createdAt: new Date().toISOString(),
  });
}

// 向舊 relayed host 要求 client-side snapshot；authoritative 對局不依賴此流程。
export async function sendRelayedInitialStateRequest(matchId: string, targetSessionId?: string): Promise<void> {
  const payload = {
    kind: "initial_state_request",
    body: "requesting current match snapshot",
    createdAt: new Date().toISOString(),
  };
  if (targetSessionId) {
    await sendRelayedMatchStateToPresenceIds(matchId, RELAYED_MATCH_OP_CODES.initialStateRequest, payload, [targetSessionId]);
    return;
  }
  await sendRelayedMatchState(matchId, RELAYED_MATCH_OP_CODES.initialStateRequest, payload);
}

// 傳送輕量 emote 訊號，不影響任何 authoritative 狀態。
export async function sendRelayedEmote(matchId: string, body: string): Promise<void> {
  await sendRelayedMatchState(matchId, RELAYED_MATCH_OP_CODES.emote, {
    kind: "emote",
    body,
    createdAt: new Date().toISOString(),
  });
}

// 舊 relayed timer 同步，攜帶 remaining seconds、round 與 startedAt。
export async function sendRelayedTimerSync(
  matchId: string,
  secondsRemaining: number,
  options: { durationSeconds?: number; roundStartedAt?: string; round?: number } = {},
): Promise<void> {
  await sendRelayedMatchState(matchId, RELAYED_MATCH_OP_CODES.timerSync, {
    kind: "timer_sync",
    secondsRemaining,
    durationSeconds: options.durationSeconds ?? secondsRemaining,
    roundStartedAt: options.roundStartedAt,
    round: options.round,
    createdAt: new Date().toISOString(),
  });
}
// authoritative Finance 對局的 portfolio 同步，攜帶 round、duration、roundStartedAt 與玩家資產狀態。
export async function sendRelayedPortfolioSync(
  matchId: string,
  payload: {
    round: number;
    durationSeconds: number;
    roundStartedAt: string;
    sessionId: string;
    cash: number;
    pnl: number;
  },
): Promise<void> {
  await sendRelayedMatchState(matchId, RELAYED_MATCH_OP_CODES.portfolioSync, {
    kind: "portfolio_sync",
    ...payload,
    createdAt: new Date().toISOString(),
  });
}

// 送出帶 nonce/sentAt 的 ping，收到 pong 後可估算 RTT。
export async function sendRelayedPing(matchId: string): Promise<{ nonce: string; sentAt: number }> {
  const ping = { nonce: cryptoFallbackId(), sentAt: Date.now() };
  await sendRelayedMatchState(matchId, RELAYED_MATCH_OP_CODES.ping, {
    kind: "ping",
    ...ping,
    createdAt: new Date().toISOString(),
  });
  return ping;
}

// Pong 使用 directed send，只回覆原始 ping sender。
export async function sendRelayedPong(matchId: string, targetSessionId: string, nonce: string, sentAt: number): Promise<void> {
  await sendRelayedMatchStateToPresenceIds(
    matchId,
    RELAYED_MATCH_OP_CODES.pong,
    {
      kind: "pong",
      nonce,
      sentAt,
      createdAt: new Date().toISOString(),
    },
    [targetSessionId],
  );
}

// 加入 Nakama matchmaker，等待 socket matched callback 提供 match token。
export async function addRelayedMatchmaker(options: RelayedMatchmakerOptions = {}): Promise<MatchmakerTicket> {
  const socket = await ensureRelayedMatchSocket();
  return socket.addMatchmaker(
    options.query?.trim() || "*",
    options.minCount ?? 2,
    options.maxCount ?? 2,
    options.stringProperties,
    options.numericProperties,
  );
}
// 取消 Nakama matchmaker，若已經 matched 則會取消 authoritative 對局。
export async function updateFinanceMatchmaking(action: "begin" | "cancel" | "status"): Promise<FinanceMatchmakingView> {
  const session = await requireLiveSession();
  const response = await getNakamaClient().rpc(session, getRuntimeContext().financeMatchmakingRpcId, { action });
  return parseRpcPayload<{ matchmaking: FinanceMatchmakingView }>(response).matchmaking;
}

// 加入 Nakama matchmaker，等待 socket matched callback 提供 match token。
export async function startFinanceMatchmaking(queueToken: string): Promise<MatchmakerTicket> {
  return addRelayedMatchmaker({
    query: "+properties.gameType:finance",
    minCount: 2,
    maxCount: 2,
    stringProperties: { gameType: "finance", queueToken },
  });
}

// 使用 ticket 離開 matchmaker queue。
export async function removeRelayedMatchmaker(ticket: string): Promise<void> {
  const trimmedTicket = safeTrim(ticket);
  if (!trimmedTicket) {
    return;
  }

  const socket = await ensureRelayedMatchSocket();
  await socket.removeMatchmaker(trimmedTicket);
}

// 註冊 match data listener，回傳 unsubscribe 供 React cleanup 使用。
export function subscribeToRelayedMatchData(
  matchId: string,
  listener: (event: RelayedMatchEvent) => void,
): () => void {
  const listeners = matchDataListeners.get(matchId) ?? new Set<(event: RelayedMatchEvent) => void>();
  listeners.add(listener);
  matchDataListeners.set(matchId, listeners);

  return () => {
    const current = matchDataListeners.get(matchId);
    if (!current) return;
    current.delete(listener);
    if (!current.size) matchDataListeners.delete(matchId);
  };
}

// 訂閱 presence join/leave，並回傳完整 presence 與 deterministic host projection。
export function subscribeToRelayedMatchPresence(
  matchId: string,
  listener: (event: RelayedMatchPresenceEvent) => void,
): () => void {
  const listeners = matchPresenceListeners.get(matchId) ?? new Set<(event: RelayedMatchPresenceEvent) => void>();
  listeners.add(listener);
  matchPresenceListeners.set(matchId, listeners);

  return () => {
    const current = matchPresenceListeners.get(matchId);
    if (!current) return;
    current.delete(listener);
    if (!current.size) matchPresenceListeners.delete(matchId);
  };
}

// 將全域 socket matchmaker callback 分派給所有已註冊 listener。
export function subscribeToRelayedMatchmaker(listener: (matched: MatchmakerMatched) => void): () => void {
  matchmakerListeners.add(listener);
  return () => {
    matchmakerListeners.delete(listener);
  };
}

export function subscribeToRealtimeConnection(listener: (connected: boolean) => void): () => void {
  realtimeConnectionListeners.add(listener);
  listener(Boolean(cachedMatchSocket));
  return () => {
    realtimeConnectionListeners.delete(listener);
  };
}

export function subscribeToMatchExchangeNotifications(listener: (notification: MatchExchangeNotification) => void): () => void {
  matchExchangeNotificationListeners.add(listener);
  void ensureRelayedMatchSocket();
  return () => {
    matchExchangeNotificationListeners.delete(listener);
  };
}

// 保存 active match metadata，供頁面刷新後重新加入。
export function persistRelayedMatchResume(state: Omit<RelayedMatchResumeState, "savedAt">) {
  safeStorageSet(RELAYED_MATCH_RESUME_KEY, JSON.stringify({ ...state, savedAt: new Date().toISOString() }));
}

// 解析 resume JSON；格式錯誤時清除損壞資料並回傳 null。
export function restoreRelayedMatchResume(): RelayedMatchResumeState | null {
  const raw = safeStorageGet(RELAYED_MATCH_RESUME_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as RelayedMatchResumeState;
    return parsed.matchId ? parsed : null;
  } catch {
    clearRelayedMatchResume();
    return null;
  }
}

export function clearRelayedMatchResume() {
  safeStorageRemove(RELAYED_MATCH_RESUME_KEY);
}

// 清除單一 match 的本地快取，不會刪除 Nakama server 上的 match。
export function clearRelayedMatchLocalState(matchId: string) {
  const trimmedMatchId = safeTrim(matchId);
  if (!trimmedMatchId) {
    return;
  }

  matchPresenceCache.delete(trimmedMatchId);
  matchDataListeners.delete(trimmedMatchId);
  matchPresenceListeners.delete(trimmedMatchId);
  [...matchSequenceCounters.keys()]
    .filter((key) => key.startsWith(`${trimmedMatchId}:`))
    .forEach((key) => matchSequenceCounters.delete(key));
  [...matchLastSendAt.keys()]
    .filter((key) => key.startsWith(`${trimmedMatchId}:`))
    .forEach((key) => matchLastSendAt.delete(key));
}

// 建立或重用 realtime socket，並將 Nakama callback 轉送到 listener registry。
async function ensureRelayedMatchSocket() {
  const session = await requireLiveSession();
  if (cachedMatchSocket && cachedMatchSocketUserId === session.user_id) {
    return cachedMatchSocket;
  }

  const socket = getNakamaClient().createSocket(process.env.NEXT_PUBLIC_NAKAMA_USE_SSL === "true", false);
  socket.ondisconnect = () => {
    cachedMatchSocket = null;
    cachedMatchSocketUserId = null;
    matchPresenceCache.clear();
    realtimeConnectionListeners.forEach((listener) => listener(false));
  };
  socket.onmatchdata = (matchData: MatchData) => {
    const event = normalizeMatchData(matchData);
    matchDataListeners.get(event.matchId)?.forEach((listener) => listener(event));
  };
  socket.onmatchpresence = (presenceEvent: MatchPresenceEvent) => {
    const event = normalizeMatchPresenceEvent(presenceEvent);
    matchPresenceListeners.get(event.matchId)?.forEach((listener) => listener(event));
  };
  socket.onmatchmakermatched = (matched: MatchmakerMatched) => {
    matchmakerListeners.forEach((listener) => listener(matched));
  };
  (socket as unknown as { onnotification?: (notification: { content?: unknown }) => void }).onnotification = (notification) => {
    const content = normalizeMatchExchangeNotification(notification.content);
    if (!content) {
      return;
    }
    matchExchangeNotificationListeners.forEach((listener) => listener(content));
  };

  await socket.connect(session, true);
  cachedMatchSocket = socket;
  cachedMatchSocketUserId = session.user_id ?? null;
  realtimeConnectionListeners.forEach((listener) => listener(true));
  return socket;
}

// 將 Nakama Match 正規化成 UI session view model，並建立初始 presence cache。
function cacheAndNormalizeMatch(match: Match): RelayedMatchSession {
  const presences = new Map<string, Presence>();
  (match.presences ?? []).forEach((presence) => {
    presences.set(presence.session_id, presence);
  });
  if (match.self?.session_id) {
    presences.set(match.self.session_id, match.self);
  }
  matchPresenceCache.set(match.match_id, presences);

  return {
    matchId: match.match_id,
    authoritative: match.authoritative,
    label: match.label,
    size: match.size,
    self: normalizePresence(match.self),
    presences: normalizePresences([...presences.values()]),
    hostSessionId: selectHostSessionId([...presences.values()]),
  };
}

// 套用 join/leave 到 presence cache，再回傳完整房內成員快照。
function normalizeMatchPresenceEvent(event: MatchPresenceEvent): RelayedMatchPresenceEvent {
  const cached = matchPresenceCache.get(event.match_id) ?? new Map<string, Presence>();
  (event.joins ?? []).forEach((presence) => cached.set(presence.session_id, presence));
  (event.leaves ?? []).forEach((presence) => cached.delete(presence.session_id));
  matchPresenceCache.set(event.match_id, cached);

  return {
    matchId: event.match_id,
    joins: normalizePresences(event.joins ?? []),
    leaves: normalizePresences(event.leaves ?? []),
    presences: normalizePresences([...cached.values()]),
    hostSessionId: selectHostSessionId([...cached.values()]),
  };
}

// 將 SDK MatchData 解碼、解析 JSON，轉成前端一致的事件模型。
function normalizeMatchData(matchData: MatchData): RelayedMatchEvent {
  const raw = decodeMatchData(matchData.data);
  return {
    id: cryptoFallbackId(),
    matchId: matchData.match_id,
    opCode: matchData.op_code,
    senderId: matchData.presence?.user_id ?? "unknown",
    senderName: matchData.presence?.username ?? "unknown",
    payload: parseMatchPayload(raw),
    raw,
    reliable: Boolean(matchData.reliable),
    createdAt: new Date().toISOString(),
  };
}

// 驗證 runtime notification，忽略非 match_exchange 格式的其他通知。
function normalizeMatchExchangeNotification(content: unknown): MatchExchangeNotification | null {
  if (typeof content !== "object" || content === null) {
    return null;
  }
  const record = content as Record<string, unknown>;
  if (record.kind !== "match_exchange" || typeof record.matchId !== "string") {
    return null;
  }
  return {
    kind: "match_exchange",
    eventType: typeof record.eventType === "string" ? record.eventType : undefined,
    communityId: typeof record.communityId === "string" ? record.communityId : undefined,
    communityKind: record.communityKind === "guild" ? "guild" : "group",
    matchId: record.matchId,
    stateVersion: typeof record.stateVersion === "number" ? record.stateVersion : undefined,
    referenceId: typeof record.referenceId === "string" ? record.referenceId : undefined,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
  };
}

// Presence 固定依 sessionId 排序，讓 deterministic host 選擇在各 client 一致。
function normalizePresences(presences: Presence[]): RelayedMatchPresenceView[] {
  return presences
    .map(normalizePresence)
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

function normalizePresence(presence: Presence): RelayedMatchPresenceView {
  return {
    userId: presence?.user_id ?? "",
    sessionId: presence?.session_id ?? "",
    username: presence?.username ?? "unknown",
    node: presence?.node ?? "",
    isSelf: presence?.user_id === cachedMatchSocketUserId,
  };
}

// 將 UI 使用的 session id 解析回 SDK Presence 供 directed send 使用。
function resolveRecipientPresences(matchId: string, recipientSessionIds: string[]) {
  const cached = matchPresenceCache.get(matchId);
  if (!cached) {
    return [];
  }

  const wanted = new Set(recipientSessionIds.filter(Boolean));
  return [...cached.values()].filter((presence) => wanted.has(presence.session_id));
}

// 舊 relayed UI 的 deterministic host；authoritative 遊戲不以此值裁決勝負。
function selectHostSessionId(presences: Presence[]) {
  const sorted = presences
    .filter((presence) => presence.session_id)
    .sort((left, right) => left.session_id.localeCompare(right.session_id));
  return sorted[0]?.session_id ?? null;
}

// SDK payload 為 Uint8Array，統一轉成 UTF-8 字串。
function decodeMatchData(data: Uint8Array) {
  try {
    return new TextDecoder().decode(data);
  } catch {
    return "";
  }
}

// 優先解析 JSON；非 JSON payload 保留原字串供除錯。
function parseMatchPayload(raw: string) {
  if (!raw) return "";
  try {
    return JSON.parse(raw) as RelayedMatchPayload | Record<string, unknown>;
  } catch {
    return raw;
  }
}

function safeTrim(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

// 注入 sequence 與 createdAt，並在送出前執行 UTF-8 byte-size 限制。
function encodeRelayedMatchPayload(matchId: string, payload: RelayedMatchPayload | Record<string, unknown>) {
  const nextPayload =
    typeof payload === "object" && payload !== null
      ? {
          ...payload,
          sequence: typeof payload.sequence === "number" ? payload.sequence : nextMatchSequence(matchId),
          createdAt: typeof payload.createdAt === "string" ? payload.createdAt : new Date().toISOString(),
        }
      : payload;
  const encoded = JSON.stringify(nextPayload);
  const size = new TextEncoder().encode(encoded).byteLength;
  if (size > MAX_RELAYED_MATCH_PAYLOAD_BYTES) {
    throw new Error(`Relayed match payload is too large (${size} bytes). Keep it under ${MAX_RELAYED_MATCH_PAYLOAD_BYTES} bytes.`);
  }
  return encoded;
}

// 每場 match 維護單調遞增的 client sequence。
function nextMatchSequence(matchId: string) {
  const next = (matchSequenceCounters.get(matchId) ?? 0) + 1;
  matchSequenceCounters.set(matchId, next);
  return next;
}

// 對 match/opcode 組合做最小發送間隔，降低連點造成的訊息洪水。
async function guardRelayedMatchSend(matchId: string, opCode: number) {
  const now = Date.now();
  const key = `${matchId}:${opCode}`;
  const elapsed = now - (matchLastSendAt.get(key) ?? 0);
  if (elapsed < MIN_RELAYED_MATCH_SEND_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_RELAYED_MATCH_SEND_INTERVAL_MS - elapsed));
  }
  matchLastSendAt.set(key, Date.now());
}

// Authoritative 與 relayed match 共用 Nakama realtime transport。
// 新功能使用中性名稱；舊 export 暫留給尚未遷移的舊畫面。
export const joinRealtimeMatch = joinRelayedMatch;
export const leaveRealtimeMatch = leaveRelayedMatch;
export const sendRealtimeMatchData = sendRelayedMatchState;
export const subscribeToRealtimeMatchData = subscribeToRelayedMatchData;
export const subscribeToRealtimeMatchPresence = subscribeToRelayedMatchPresence;
export const persistRealtimeMatchResume = persistRelayedMatchResume;
export const restoreRealtimeMatchResume = restoreRelayedMatchResume;
export const clearRealtimeMatchResume = clearRelayedMatchResume;
export const cancelRealtimeMatchmaking = removeRelayedMatchmaker;
export const subscribeToRealtimeMatchmaker = subscribeToRelayedMatchmaker;
