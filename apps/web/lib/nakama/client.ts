import { Client, Session } from "@heroiclabs/nakama-js";

import type { AuthPayload, DashboardSnapshot, RpcResponsePayload, RuntimeContext } from "./types";

const SESSION_TOKEN_KEY = "nakama.session.token";
const SESSION_REFRESH_KEY = "nakama.session.refresh";
const DEFAULT_LEADERBOARD_ID = "portfolio_return_global";
const DEFAULT_GUILD_LEADERBOARD_ID = "guild_average_return_weekly";

let cachedClient: Client | null = null;

// 建立並快取 Nakama HTTP client。
// 前端所有一般 API / RPC 呼叫都會共用這個 client，避免每次操作都重新建立連線設定。
export function getNakamaClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const host = process.env.NEXT_PUBLIC_NAKAMA_HOST;
  const port = process.env.NEXT_PUBLIC_NAKAMA_PORT ?? "7350";
  const serverKey = process.env.NEXT_PUBLIC_NAKAMA_SERVER_KEY ?? "defaultkey";
  const useSSL = process.env.NEXT_PUBLIC_NAKAMA_USE_SSL === "true";

  if (!host) {
    // 專案目前是 live-only。沒有 Nakama host 代表環境設定錯誤，不再退回 mock mode。
    throw new Error("NEXT_PUBLIC_NAKAMA_HOST is not configured.");
  }

  cachedClient = new Client(serverKey, host, port, useSSL);
  return cachedClient;
}

// 集中整理前端需要知道的 runtime id。
// 好處是 UI / service 不需要到處硬編 RPC 名稱；未來若 RPC id 改名，只要改 env 或這裡的 fallback。
export function getRuntimeContext(): RuntimeContext {
  if (!process.env.NEXT_PUBLIC_NAKAMA_HOST) {
    throw new Error("Nakama Live is required. Configure NEXT_PUBLIC_NAKAMA_HOST.");
  }

  return {
    mode: "nakama",
    leaderboardId: process.env.NEXT_PUBLIC_NAKAMA_LEADERBOARD_ID ?? DEFAULT_LEADERBOARD_ID,
    guildLeaderboardId: process.env.NEXT_PUBLIC_NAKAMA_GUILD_LEADERBOARD_ID ?? DEFAULT_GUILD_LEADERBOARD_ID,
    scoreRpcId: process.env.NEXT_PUBLIC_NAKAMA_SCORE_RPC_ID ?? "submit_portfolio_score",
    createGuildRpcId: process.env.NEXT_PUBLIC_NAKAMA_CREATE_GUILD_RPC_ID ?? "create_guild",
    inviteGuildMemberRpcId: process.env.NEXT_PUBLIC_NAKAMA_INVITE_GUILD_MEMBER_RPC_ID ?? "invite_guild_member",
    promoteGuildAdminRpcId: process.env.NEXT_PUBLIC_NAKAMA_PROMOTE_GUILD_ADMIN_RPC_ID ?? "promote_guild_admin",
    demoteGuildAdminRpcId: process.env.NEXT_PUBLIC_NAKAMA_DEMOTE_GUILD_ADMIN_RPC_ID ?? "demote_guild_admin",
    transferGuildOwnerRpcId: process.env.NEXT_PUBLIC_NAKAMA_TRANSFER_GUILD_OWNER_RPC_ID ?? "transfer_guild_owner",
    requestGuildJoinRpcId: process.env.NEXT_PUBLIC_NAKAMA_REQUEST_GUILD_JOIN_RPC_ID ?? "request_guild_join",
    approveGuildJoinRpcId: process.env.NEXT_PUBLIC_NAKAMA_APPROVE_GUILD_JOIN_RPC_ID ?? "approve_guild_join",
    rejectGuildJoinRpcId: process.env.NEXT_PUBLIC_NAKAMA_REJECT_GUILD_JOIN_RPC_ID ?? "reject_guild_join",
    leaveGuildRpcId: process.env.NEXT_PUBLIC_NAKAMA_LEAVE_GUILD_RPC_ID ?? "leave_guild",
    disbandGuildRpcId: process.env.NEXT_PUBLIC_NAKAMA_DISBAND_GUILD_RPC_ID ?? "disband_guild",
    kickGuildMemberRpcId: process.env.NEXT_PUBLIC_NAKAMA_KICK_GUILD_MEMBER_RPC_ID ?? "kick_guild_member",
    listGuildJoinRequestsRpcId:
      process.env.NEXT_PUBLIC_NAKAMA_LIST_GUILD_JOIN_REQUESTS_RPC_ID ?? "list_guild_join_requests",
    getGuildDetailRpcId: process.env.NEXT_PUBLIC_NAKAMA_GET_GUILD_DETAIL_RPC_ID ?? "get_guild_detail",
    updateGuildSettingsRpcId: process.env.NEXT_PUBLIC_NAKAMA_UPDATE_GUILD_SETTINGS_RPC_ID ?? "update_guild_settings",
    searchUsersRpcId: process.env.NEXT_PUBLIC_NAKAMA_SEARCH_USERS_RPC_ID ?? "search_users",
    createFinanceMatchRpcId: process.env.NEXT_PUBLIC_NAKAMA_CREATE_FINANCE_MATCH_RPC_ID ?? "create_finance_match",
    financeMatchmakingRpcId: process.env.NEXT_PUBLIC_NAKAMA_FINANCE_MATCHMAKING_RPC_ID ?? "finance_matchmaking",
    listFinanceHistoryRpcId: process.env.NEXT_PUBLIC_NAKAMA_LIST_FINANCE_HISTORY_RPC_ID ?? "list_finance_history",
    listMatchCandlesRpcId: process.env.NEXT_PUBLIC_NAKAMA_LIST_MATCH_CANDLES_RPC_ID ?? "list_match_candles",
  };
}

// 從 localStorage 還原 Nakama session。
// 若 token 即將過期，會先用 refresh token 換新 session，再回傳給呼叫端。
export async function restoreLiveSession() {
  const token = safeStorageGet(SESSION_TOKEN_KEY);
  const refreshToken = safeStorageGet(SESSION_REFRESH_KEY);
  if (!token || !refreshToken) {
    return null;
  }

  const session = Session.restore(token, refreshToken);
  const nowPlusFiveMinutes = Date.now() / 1000 + 300;

  if (session.isexpired(nowPlusFiveMinutes)) {
    const refreshed = await getNakamaClient().sessionRefresh(session);
    persistLiveSession(refreshed);
    return refreshed;
  }

  return session;
}

// 給必須登入才能執行的操作使用。
// 例如好友邀請、建立 guild、送出排行榜分數，都應該先取得有效 session。
export async function requireLiveSession() {
  const session = await restoreLiveSession();
  if (!session) {
    throw new Error("No active session.");
  }
  return session;
}

// 登入 / 註冊成功後，將 token 保存到 localStorage。
// 後續重新整理頁面時，bootstrapPhaseOne 可以透過 restoreLiveSession 回到登入狀態。
export function persistLiveSession(session: Session) {
  safeStorageSet(SESSION_TOKEN_KEY, session.token);
  safeStorageSet(SESSION_REFRESH_KEY, session.refresh_token);
}

// 登出時清掉瀏覽器端 session。
// realtime socket 狀態會由 chat.ts 的 resetRealtimeState 負責清理。
export function clearLiveSession() {
  safeStorageRemove(SESSION_TOKEN_KEY);
  safeStorageRemove(SESSION_REFRESH_KEY);
}

// 登入 / 註冊表單的最小前端檢查。
// 後端仍是最終權限來源；這裡主要是避免空資料打到 Nakama。
export function validateAuthPayload(payload: AuthPayload, requireUsername: boolean) {
  if (!payload.email.trim()) {
    throw new Error("Email is required.");
  }
  if (!payload.password.trim()) {
    throw new Error("Password is required.");
  }
  if (payload.password.trim().length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  if (requireUsername && !payload.username?.trim()) {
    throw new Error("Username is required.");
  }
}

// Nakama RPC response 的 payload 有時是 JSON string，有時已經是 object。
// 所有 RPC 解析都走這裡，讓 dashboard.ts 不需要重複判斷格式。
export function parseRpcPayload<T>(response: RpcResponsePayload<T>) {
  const raw = response.payload;
  if (typeof raw === "string") {
    return JSON.parse(raw) as T;
  }
  return (raw ?? {}) as T;
}

// 將 SDK / fetch / runtime error 包裝成 `[live:action]` 格式。
// 這對 debug 很重要，因為 UI 可以直接看出是哪個 live operation 失敗。
export async function toLiveModeError(action: string, error: unknown) {
  if (typeof Response !== "undefined" && error instanceof Response) {
    const body = await error.text().catch(() => "");
    const suffix = body ? `: ${body}` : "";
    return new Error(`[live:${action}] HTTP ${error.status} ${error.statusText}${suffix}`);
  }

  if (error instanceof Error) {
    return new Error(`[live:${action}] ${error.message}`);
  }

  return new Error(`[live:${action}] ${String(error)}`);
}

// 未登入或沒有資料時的 dashboard 空快照。
// UI 會靠 profile 是否為 null 判斷要顯示 Access 還是登入後功能區。
export function emptySnapshot(runtime: RuntimeContext): DashboardSnapshot {
  return {
    runtime,
    profile: null,
    friends: [],
    communities: [],
    leaderboards: {
      global: [],
      friends: [],
      guild: [],
    },
  };
}

// localStorage helper 都要處理 SSR / 非瀏覽器環境。
// Next.js client component 通常在瀏覽器跑，但工具函式保持防禦性會比較安全。
export function safeStorageGet(key: string) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

export function safeStorageSet(key: string, value: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
}

export function safeStorageRemove(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

// 在瀏覽器不支援 crypto.randomUUID 時提供 fallback id。
// 主要用於 UI 暫時 key，不應作為後端權威 id。
export function cryptoFallbackId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 10)}`;
}

// 從各種錯誤型別取出可判斷的文字。
// leaveGuild 會用這個函式判斷「後端其實已經離開」這類狀態不同步錯誤。
export async function extractErrorMessage(error: unknown) {
  if (typeof Response !== "undefined" && error instanceof Response) {
    const body = await error.clone().text().catch(() => "");
    return `${error.status} ${error.statusText} ${body}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}
