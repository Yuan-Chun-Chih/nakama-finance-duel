import { Session, type ChannelMessage, type Socket } from "@heroiclabs/nakama-js";

import {
  cryptoFallbackId,
  getNakamaClient,
  requireLiveSession,
} from "./client";
import type {
  ChatMessageView,
  ChatPage,
  ChatSession,
  ChatTarget,
  DashboardSnapshot,
  RealtimeMetaSnapshot,
} from "./types";

const CHAT_HISTORY_LIMIT = 50;
const CHAT_KIND_ROOM = 1;
const CHAT_KIND_DM = 2;
const TYPING_SIGNAL_KIND = "__typing__";
const TYPING_TTL_MS = 2500;

let cachedSocket: Socket | null = null;
let cachedSocketUserId: string | null = null;

const liveChatListeners = new Map<string, Set<(message: ChatMessageView) => void>>();
const liveUnreadListeners = new Set<(counts: Record<string, number>) => void>();
const liveMetaListeners = new Set<(snapshot: RealtimeMetaSnapshot) => void>();
const liveUnreadCounts = new Map<string, number>();
const liveTargetChannels = new Map<string, { channelId: string; target: ChatTarget }>();
const liveChannelTargets = new Map<string, string>();
const liveOnlineUserIds = new Set<string>();
const liveChannelPresence = new Map<string, Map<string, string>>();
const liveTypingUsers = new Map<string, Map<string, string>>();
const liveTypingTimers = new Map<string, ReturnType<typeof setTimeout>>();

// 從 dashboard snapshot 建立可聊天目標。
// 好友只取 accepted 狀態；group/guild 只取 owner/admin/member，避免 visitor/requested 也出現在聊天清單。
export function buildChatTargets(snapshot: DashboardSnapshot | null): ChatTarget[] {
  if (!snapshot?.profile) {
    return [];
  }

  // 可聊天的對象只包含已接受好友，以及目前實際已加入的群組/公會。
  const friendTargets = snapshot.friends
    .filter((friend) => friend.state === "accepted")
    .map((friend) => ({
      id: friend.id,
      kind: "friend" as const,
      label: friend.displayName,
      subtitle: `@${friend.username}`,
    }));

  const communityTargets = snapshot.communities
    // 只有自己實際已加入的 community 才能聊天。
    .filter((community) => community.role === "owner" || community.role === "admin" || community.role === "member")
    .map((community) => ({
      id: community.id,
      kind: community.kind,
      label: community.name,
      subtitle: `${community.kind} · ${community.memberCount} members`,
    }));

  return [...friendTargets, ...communityTargets];
}

// 開啟指定聊天目標：確保 socket 已連線、join channel，然後載入最近一頁歷史訊息。
export async function openChatSession(target: ChatTarget): Promise<ChatSession> {
  const session = await requireLiveSession();
  // 先 join/resolve channel，再抓歷史訊息，避免「尚未加入頻道就讀寫」的錯誤。
  const channelId = await ensureLiveChatChannelId(session, target);
  const history = await getNakamaClient().listChannelMessages(session, channelId, CHAT_HISTORY_LIMIT, true);
  markChatTargetRead(target);

  return {
    channelId,
    target,
    messages: normalizeChannelMessages(history.messages ?? []),
    nextCursor: history.next_cursor ?? null,
    prevCursor: history.prev_cursor ?? null,
  };
}

// 依 Nakama cursor 載入更舊的訊息，用於聊天室「歷史分頁」。
export async function loadOlderChatMessages(channelId: string, cursor: string | null): Promise<ChatPage> {
  if (!cursor) {
    return { messages: [], nextCursor: null, prevCursor: null };
  }

  const session = await requireLiveSession();
  const history = await getNakamaClient().listChannelMessages(session, channelId, CHAT_HISTORY_LIMIT, true, cursor);
  return {
    messages: normalizeChannelMessages(history.messages ?? []),
    nextCursor: history.next_cursor ?? null,
    prevCursor: history.prev_cursor ?? null,
  };
}

// 送出聊天訊息。
// 如果呼叫端有提供 target，會先用 target 確認 channel 已 join，避免出現 Must join channel before sending messages。
export async function sendChatMessage(channelId: string, body: string, target?: ChatTarget): Promise<ChatMessageView> {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error("Message body is required.");
  }

  const session = await requireLiveSession();
  const socket = await ensureLiveSocket(session);
  // 若提供 target，優先依 target 重新確認正確 channelId，避免舊快取導致寫入錯頻道。
  const resolvedChannelId = target ? await ensureLiveChatChannelId(session, target) : channelId;

  try {
    const ack = await socket.writeChatMessage(resolvedChannelId, { body: trimmed });
    return {
      id: ack.message_id,
      channelId: ack.channel_id,
      senderId: session.user_id ?? "self",
      senderName: ack.username ?? "you",
      body: trimmed,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(describeSocketError(error));
  }
}

// 傳送 typing signal。typing 被包成特殊 channel message，normalize 時會排除在正式訊息列表外。
export async function sendTypingSignal(target: ChatTarget): Promise<void> {
  const session = await requireLiveSession();
  const socket = await ensureLiveSocket(session);
  const channelId = await ensureLiveChatChannelId(session, target);

  await socket.writeChatMessage(channelId, {
    __kind: TYPING_SIGNAL_KIND,
    body: "",
  });
}

// 訂閱指定 channel 的新訊息。
// 回傳 unsubscribe function，React component unmount 或切換聊天室時必須呼叫。
export function subscribeToChatChannel(
  channelId: string,
  listener: (message: ChatMessageView) => void,
): () => void {
  const existing = liveChatListeners.get(channelId) ?? new Set<(message: ChatMessageView) => void>();
  existing.add(listener);
  liveChatListeners.set(channelId, existing);

  return () => {
    const listeners = liveChatListeners.get(channelId);
    if (!listeners) return;
    listeners.delete(listener);
    if (!listeners.size) {
      liveChatListeners.delete(channelId);
    }
  };
}

// 預熱 realtime：建立 socket、追蹤好友 presence，並提前 join 可聊天 channels。
// 這能降低使用者第一次點聊天室時的等待時間，也能讓未讀數和在線狀態提早開始更新。
export async function primeRealtimeChat(snapshot: DashboardSnapshot | null): Promise<void> {
  if (!snapshot?.profile) {
    return;
  }

  const session = await requireLiveSession();
  const socket = await ensureLiveSocket(session);
  const targets = buildChatTargets(snapshot);
  const followedUserIds = snapshot.friends.filter((friend) => friend.state === "accepted").map((friend) => friend.id);

  if (followedUserIds.length) {
    const status = await socket.followUsers(followedUserIds);
    liveOnlineUserIds.clear();
    (status.presences ?? []).forEach((presence) => {
      if (presence.user_id) {
        liveOnlineUserIds.add(presence.user_id);
      }
    });
    emitRealtimeMeta();
  }

  await Promise.all(targets.map((target) => ensureLiveChatChannelId(session, target)));
}

// 訂閱未讀數快照。listener 會立刻收到目前狀態，之後每次變更也會被通知。
export function subscribeToUnreadCounts(listener: (counts: Record<string, number>) => void): () => void {
  liveUnreadListeners.add(listener);
  listener(getUnreadCountsSnapshot());
  return () => {
    liveUnreadListeners.delete(listener);
  };
}

// 訂閱 presence / typing 等 realtime metadata。
export function subscribeToRealtimeMeta(listener: (snapshot: RealtimeMetaSnapshot) => void): () => void {
  liveMetaListeners.add(listener);
  listener(buildRealtimeMetaSnapshot());
  return () => {
    liveMetaListeners.delete(listener);
  };
}

// 使用者打開某個聊天目標後，將該 target 的未讀數歸零。
export function markChatTargetRead(target: ChatTarget) {
  const key = getChatTargetKey(target);
  if (!liveUnreadCounts.has(key) || liveUnreadCounts.get(key) === 0) {
    return;
  }

  liveUnreadCounts.set(key, 0);
  emitUnreadCounts();
}

// 登出或切換帳號時清空 socket、channel cache、未讀數、presence、typing timers。
export function resetRealtimeState() {
  cachedSocket?.disconnect(false);
  cachedSocket = null;
  cachedSocketUserId = null;
  liveChatListeners.clear();
  liveUnreadListeners.clear();
  liveMetaListeners.clear();
  liveUnreadCounts.clear();
  liveTargetChannels.clear();
  liveChannelTargets.clear();
  liveOnlineUserIds.clear();
  liveChannelPresence.clear();
  liveTypingUsers.clear();
  liveTypingTimers.forEach((timer) => clearTimeout(timer));
  liveTypingTimers.clear();
}

// 建立或重用 Nakama realtime socket。
// socket event handler 也在這裡集中註冊，避免 UI component 直接處理低階 socket event。
async function ensureLiveSocket(session: Session) {
  if (cachedSocket && cachedSocketUserId === session.user_id) {
    return cachedSocket;
  }

  const socket = getNakamaClient().createSocket(process.env.NEXT_PUBLIC_NAKAMA_USE_SSL === "true", false);
  socket.ondisconnect = () => {
    cachedSocket = null;
    cachedSocketUserId = null;
    liveTargetChannels.clear();
    liveChannelTargets.clear();
    liveOnlineUserIds.clear();
    liveChannelPresence.clear();
    liveTypingUsers.clear();
    emitRealtimeMeta();
  };
  socket.onchannelmessage = (message: ChannelMessage) => {
    if (isTypingSignalMessage(message)) {
      registerTypingSignal(message.channel_id ?? "", message.sender_id ?? "", message.username ?? "unknown");
      return;
    }

    const normalized = normalizeChannelMessage(message);
    const listeners = liveChatListeners.get(normalized.channelId);
    const targetKey = liveChannelTargets.get(normalized.channelId);

    if (targetKey && normalized.senderId !== cachedSocketUserId) {
      liveUnreadCounts.set(targetKey, (liveUnreadCounts.get(targetKey) ?? 0) + 1);
      emitUnreadCounts();
    }

    if (!listeners?.size) {
      return;
    }

    listeners.forEach((listener) => listener(normalized));
  };
  socket.onstatuspresence = (statusPresence) => {
    (statusPresence.joins ?? []).forEach((presence) => {
      if (presence.user_id) liveOnlineUserIds.add(presence.user_id);
    });
    (statusPresence.leaves ?? []).forEach((presence) => {
      if (presence.user_id) liveOnlineUserIds.delete(presence.user_id);
    });
    emitRealtimeMeta();
  };
  socket.onchannelpresence = (channelPresence) => {
    const current = liveChannelPresence.get(channelPresence.channel_id) ?? new Map<string, string>();
    (channelPresence.joins ?? []).forEach((presence) => {
      if (presence.user_id) current.set(presence.user_id, presence.username || "unknown");
    });
    (channelPresence.leaves ?? []).forEach((presence) => {
      if (presence.user_id) current.delete(presence.user_id);
    });
    liveChannelPresence.set(channelPresence.channel_id, current);
    emitRealtimeMeta();
  };

  await socket.connect(session, true);
  cachedSocket = socket;
  cachedSocketUserId = session.user_id ?? null;
  return socket;
}

// 依 ChatTarget join 正確 channel，並快取 target key -> channel id。
// friend 使用 DM channel；group/guild 使用 deterministic room channel。
async function ensureLiveChatChannelId(session: Session, target: ChatTarget): Promise<string> {
  const key = getChatTargetKey(target);
  const existing = liveTargetChannels.get(key);
  if (existing && target.kind === "friend") {
    return existing.channelId;
  }

  const socket = await ensureLiveSocket(session);
  const chatTarget = resolveChatJoinTarget(target);
  const channel = await socket.joinChat(chatTarget.target, chatTarget.type, true, false);

  liveTargetChannels.set(key, { channelId: channel.id, target });
  liveChannelTargets.set(channel.id, key);
  const presences = liveChannelPresence.get(channel.id) ?? new Map<string, string>();
  (channel.presences ?? []).forEach((presence) => {
    if (presence.user_id) presences.set(presence.user_id, presence.username || "unknown");
  });
  if (channel.self?.user_id) {
    presences.set(channel.self.user_id, channel.self.username || "you");
  }
  liveChannelPresence.set(channel.id, presences);
  if (!liveUnreadCounts.has(key)) {
    liveUnreadCounts.set(key, 0);
  }
  emitUnreadCounts();
  emitRealtimeMeta();
  return channel.id;
}

// 批次正規化訊息，並排除 typing signal。
function normalizeChannelMessages(messages: ChannelMessage[]): ChatMessageView[] {
  return messages
    .filter((message) => !isTypingSignalMessage(message))
    .map(normalizeChannelMessage)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

// 單筆 Nakama ChannelMessage -> UI ChatMessageView。
function normalizeChannelMessage(message: ChannelMessage): ChatMessageView {
  return {
    id: message.message_id ?? cryptoFallbackId(),
    channelId: message.channel_id ?? "",
    senderId: message.sender_id ?? "unknown",
    senderName: message.username ?? "unknown",
    body: extractChatBody(message.content),
    createdAt: message.create_time ?? new Date().toISOString(),
  };
}

// 從 Nakama message content 取出 body。
function extractChatBody(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  if ("body" in content && typeof content.body === "string") return content.body;
  return JSON.stringify(content);
}

// 判斷訊息是否為 typing signal，而不是正式聊天內容。
function isTypingSignalMessage(message: ChannelMessage) {
  const content = message.content;
  return !!content && typeof content === "object" && "__kind" in content && content.__kind === TYPING_SIGNAL_KIND;
}

// 記錄某使用者正在輸入，並設定 TTL 到期自動移除。
function registerTypingSignal(channelId: string, userId: string, username: string) {
  if (!channelId || !userId || userId === cachedSocketUserId) return;

  const current = liveTypingUsers.get(channelId) ?? new Map<string, string>();
  current.set(userId, username);
  liveTypingUsers.set(channelId, current);
  emitRealtimeMeta();

  const timerKey = `${channelId}:${userId}`;
  const existing = liveTypingTimers.get(timerKey);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    const channelTyping = liveTypingUsers.get(channelId);
    channelTyping?.delete(userId);
    if (channelTyping && channelTyping.size === 0) {
      liveTypingUsers.delete(channelId);
    }
    liveTypingTimers.delete(timerKey);
    emitRealtimeMeta();
  }, TYPING_TTL_MS);
  liveTypingTimers.set(timerKey, timer);
}

// 產生穩定 key，用於未讀數與 channel cache。
function getChatTargetKey(target: ChatTarget) {
  return `${target.kind}:${target.id}`;
}

// 將高階 ChatTarget 轉成 Nakama joinChat 需要的 target/type。
function resolveChatJoinTarget(target: ChatTarget) {
  if (target.kind === "friend") {
    return { target: target.id, type: CHAT_KIND_DM };
  }

  return {
    target: `community:${target.kind}:${target.id}`,
    type: CHAT_KIND_ROOM,
  };
}

// 將 Map 轉成 plain object，方便 React state 使用。
function getUnreadCountsSnapshot() {
  return Object.fromEntries(liveUnreadCounts.entries());
}

// 通知所有未讀數 listener。
function emitUnreadCounts() {
  const snapshot = getUnreadCountsSnapshot();
  liveUnreadListeners.forEach((listener) => listener(snapshot));
}

// 建立 presence / typing metadata 快照。
function buildRealtimeMetaSnapshot(): RealtimeMetaSnapshot {
  const channelPresenceById: Record<string, string[]> = {};
  liveChannelPresence.forEach((presences, channelId) => {
    channelPresenceById[channelId] = [...presences.keys()];
  });

  const typingByChannelId: Record<string, { userId: string; username: string }[]> = {};
  liveTypingUsers.forEach((typingUsers, channelId) => {
    typingByChannelId[channelId] = [...typingUsers.entries()].map(([userId, username]) => ({ userId, username }));
  });

  return {
    onlineUserIds: [...liveOnlineUserIds],
    channelPresenceById,
    typingByChannelId,
  };
}

// 通知所有 realtime metadata listener。
function emitRealtimeMeta() {
  const snapshot = buildRealtimeMetaSnapshot();
  liveMetaListeners.forEach((listener) => listener(snapshot));
}

// 將 socket error 正規化成 UI 可顯示文字。
function describeSocketError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Failed to send realtime chat message.";
}
