import type { Client, Friend, Group, LeaderboardRecord, Session } from "@heroiclabs/nakama-js";

import {
  clearLiveSession,
  cryptoFallbackId,
  emptySnapshot,
  extractErrorMessage,
  getNakamaClient,
  getRuntimeContext,
  parseRpcPayload,
  persistLiveSession,
  requireLiveSession,
  restoreLiveSession,
  toLiveModeError,
  validateAuthPayload,
} from "./client";
import { resetRealtimeState } from "./chat";
import type {
  AuthPayload,
  CommunityDetail,
  CommunityPayload,
  CommunityRole,
  CommunityView,
  DashboardSnapshot,
  FriendState,
  FriendView,
  GroupKind,
  GuildAuditEntry,
  GuildContribution,
  GuildDetail,
  GuildJoinPolicy,
  GuildJoinRequest,
  GuildMember,
  LeaderboardEntry,
  LeaderboardRpcRecord,
  RuntimeContext,
  UserSearchCandidate,
} from "./types";

// 本檔是前端 Nakama service 的「資料流程層」。
// 它不負責畫面，也不負責 realtime socket；只負責把 UI 意圖轉成 Nakama API / Go runtime RPC，
// 並把後端回傳資料整理成 React component 容易使用的 DashboardSnapshot / Detail view model。

// 這個 service 檔是前端與 Nakama 溝通的唯一正式入口。
// React 元件只應呼叫這裡暴露的函式，不應直接組 RPC payload 或自己操作 Nakama client。
export async function bootstrapPhaseOne(): Promise<DashboardSnapshot> {
  const runtime = getRuntimeContext();
  const session = await restoreLiveSession();
  if (!session) return emptySnapshot(runtime);

  try {
    return await loadLiveDashboard(session, runtime);
  } catch (error) {
    throw await toLiveModeError("bootstrapPhaseOne", error);
  }
}

// 註冊 Nakama email 帳號。成功後保存 session 並立即載入 dashboard snapshot。
export async function registerWithEmail(payload: AuthPayload): Promise<DashboardSnapshot> {
  validateAuthPayload(payload, true);

  try {
    const client = getNakamaClient();
    const session = await client.authenticateEmail(
      payload.email.trim(),
      payload.password,
      true,
      payload.username?.trim(),
    );
    persistLiveSession(session);
    return await loadLiveDashboard(session, getRuntimeContext());
  } catch (error) {
    throw await toLiveModeError("registerWithEmail", error);
  }
}

// 登入既有 Nakama email 帳號。回傳型別刻意和註冊相同，方便 UI 共用成功後流程。
export async function loginWithEmail(payload: AuthPayload): Promise<DashboardSnapshot> {
  validateAuthPayload(payload, false);

  try {
    const client = getNakamaClient();
    const session = await client.authenticateEmail(payload.email.trim(), payload.password, false);
    persistLiveSession(session);
    return await loadLiveDashboard(session, getRuntimeContext());
  } catch (error) {
    throw await toLiveModeError("loginWithEmail", error);
  }
}

// 登出時清除 session 與 realtime 狀態，並回傳未登入用的空 snapshot。
export async function logoutFromRuntime(): Promise<DashboardSnapshot> {
  resetRealtimeState();
  clearLiveSession();
  return emptySnapshot(getRuntimeContext());
}

// 送出好友邀請。這裡使用 Nakama 原生 friend API，不經過自訂 RPC。
export async function sendFriendInvite(username: string): Promise<DashboardSnapshot> {
  if (!username.trim()) throw new Error("Friend username is required.");

  try {
    const session = await requireLiveSession();
    await getNakamaClient().addFriends(session, undefined, [username.trim()]);
    return await loadLiveDashboard(session, getRuntimeContext());
  } catch (error) {
    throw await toLiveModeError("sendFriendInvite", error);
  }
}

// 搜尋「可新增為好友的玩家候選」。
// 和 dashboard 上的既有好友清單搜尋不同，這個函式會呼叫後端 search_users RPC。
export async function searchUsersForFriendInvite(query: string): Promise<UserSearchCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const session = await requireLiveSession();
    const response = await getNakamaClient().rpc(session, getRuntimeContext().searchUsersRpcId, {
      query: trimmed,
      limit: 8,
    });
    const parsed = parseRpcPayload<{ users?: UserSearchCandidate[] }>(response);
    return parsed.users ?? [];
  } catch (error) {
    throw await toLiveModeError("searchUsersForFriendInvite", error);
  }
}

// 建立 group 或 guild。group 只走 Nakama 原生 API；guild 會再呼叫 Go runtime 初始化治理資料。
export async function createCommunity(payload: CommunityPayload): Promise<DashboardSnapshot> {
  if (!payload.name.trim()) throw new Error("Community name is required.");

  try {
    const session = await requireLiveSession();
    const client = getNakamaClient();
    const runtime = getRuntimeContext();

    if (payload.kind === "guild") {
      const group = await client.createGroup(session, {
        name: payload.name.trim(),
        description: payload.description.trim(),
        lang_tag: "guild",
        max_count: 100,
        open: false,
      });

      await client.rpc(session, runtime.createGuildRpcId, {
        guildId: group.id,
        name: payload.name.trim(),
        description: payload.description.trim(),
      });
    } else {
      await client.createGroup(session, {
        name: payload.name.trim(),
        description: payload.description.trim(),
        lang_tag: "group",
        max_count: 24,
        open: payload.open,
      });
    }

    return await loadLiveDashboard(session, runtime);
  } catch (error) {
    throw await toLiveModeError("createCommunity", error);
  }
}

// 邀請成員。guild 需要 runtime 做權限檢查與 audit；一般 group 則直接使用 Nakama API。
export async function inviteCommunityMember(communityId: string, kind: GroupKind, username: string): Promise<void> {
  const trimmed = username.trim();
  if (!trimmed) throw new Error("Username is required.");

  const session = await requireLiveSession();
  const client = getNakamaClient();

  if (kind === "guild") {
    await client.rpc(session, getRuntimeContext().inviteGuildMemberRpcId, { guildId: communityId, username: trimmed });
    return;
  }

  const users = await client.getUsers(session, undefined, [trimmed]);
  const user = users.users?.[0];
  if (!user?.id) throw new Error("Target username not found.");
  await client.addGroupUsers(session, communityId, [user.id]);
}

// 提升成員權限。guild 走 authoritative RPC；group 走原生 promoteGroupUsers。
export async function promoteCommunityMember(communityId: string, kind: GroupKind, userId: string): Promise<void> {
  const session = await requireLiveSession();
  const client = getNakamaClient();

  if (kind === "guild") {
    await client.rpc(session, getRuntimeContext().promoteGuildAdminRpcId, { guildId: communityId, userId });
    return;
  }

  await client.promoteGroupUsers(session, communityId, [userId]);
}

// 降低成員權限。guild 走 authoritative RPC；group 走原生 demoteGroupUsers。
export async function demoteCommunityMember(communityId: string, kind: GroupKind, userId: string): Promise<void> {
  const session = await requireLiveSession();
  const client = getNakamaClient();

  if (kind === "guild") {
    await client.rpc(session, getRuntimeContext().demoteGuildAdminRpcId, { guildId: communityId, userId });
    return;
  }

  await client.demoteGroupUsers(session, communityId, [userId]);
}

// 轉移 owner。guild 的規則由 Go runtime 裁決；group 用原生 promote/demote 模擬 owner 切換。
export async function transferCommunityOwnership(communityId: string, kind: GroupKind, userId: string): Promise<void> {
  const session = await requireLiveSession();
  const client = getNakamaClient();

  if (kind === "guild") {
    await client.rpc(session, getRuntimeContext().transferGuildOwnerRpcId, { guildId: communityId, userId });
    return;
  }

  const members = await client.listGroupUsers(session, communityId, undefined, 100);
  const currentOwner = (members.group_users ?? []).find((entry) => entry.state === 0 && entry.user?.id)?.user?.id;
  const target = (members.group_users ?? []).find((entry) => entry.user?.id === userId);

  if (!currentOwner) throw new Error("Current group owner was not found.");
  if (!target?.user?.id) throw new Error("Target member was not found.");

  if (target.state !== 1) await client.promoteGroupUsers(session, communityId, [userId]);
  await client.promoteGroupUsers(session, communityId, [userId]);
  await client.demoteGroupUsers(session, communityId, [currentOwner]);
}

// 申請加入 guild。後端會檢查 join policy、單一 guild 限制與是否已有申請。
export async function requestGuildJoin(guildId: string): Promise<DashboardSnapshot> {
  try {
    const session = await requireLiveSession();
    const runtime = getRuntimeContext();
    await getNakamaClient().rpc(session, runtime.requestGuildJoinRpcId, { guildId });
    return await loadLiveDashboard(session, runtime);
  } catch (error) {
    throw await toLiveModeError("requestGuildJoin", error);
  }
}

// 加入一般 open group。guild 不走這條，guild 必須走 request/approve 流程。
export async function joinCommunity(communityId: string): Promise<DashboardSnapshot> {
  try {
    const session = await requireLiveSession();
    await getNakamaClient().joinGroup(session, communityId);
    return await loadLiveDashboard(session, getRuntimeContext());
  } catch (error) {
    throw await toLiveModeError("joinCommunity", error);
  }
}

// 離開一般 group。
export async function leaveGroup(communityId: string): Promise<DashboardSnapshot> {
  try {
    const session = await requireLiveSession();
    await getNakamaClient().leaveGroup(session, communityId);
    return await loadLiveDashboard(session, getRuntimeContext());
  } catch (error) {
    throw await toLiveModeError("leaveGroup", error);
  }
}

// 核准 guild 加入申請。後端會同步 group roster、guild_membership storage 與 audit log。
export async function approveGuildJoin(guildId: string, userId: string): Promise<DashboardSnapshot> {
  try {
    const session = await requireLiveSession();
    const runtime = getRuntimeContext();
    await getNakamaClient().rpc(session, runtime.approveGuildJoinRpcId, { guildId, userId });
    return await loadLiveDashboard(session, runtime);
  } catch (error) {
    throw await toLiveModeError("approveGuildJoin", error);
  }
}

// 拒絕 guild 加入申請。後端會移除 request 並寫入 audit log。
export async function rejectGuildJoin(guildId: string, userId: string): Promise<DashboardSnapshot> {
  try {
    const session = await requireLiveSession();
    const runtime = getRuntimeContext();
    await getNakamaClient().rpc(session, runtime.rejectGuildJoinRpcId, { guildId, userId });
    return await loadLiveDashboard(session, runtime);
  } catch (error) {
    throw await toLiveModeError("rejectGuildJoin", error);
  }
}

// 離開 guild。若後端已經離開但前端 snapshot 還沒同步，會重抓 dashboard 收斂狀態。
export async function leaveGuild(guildId?: string): Promise<DashboardSnapshot> {
  const runtime = getRuntimeContext();
  try {
    const session = await requireLiveSession();
    await getNakamaClient().rpc(session, runtime.leaveGuildRpcId, guildId ? { guildId } : {});
    return await loadLiveDashboard(session, runtime);
  } catch (error) {
    if (await isGuildAlreadyLeftError(error)) {
      const session = await requireLiveSession();
      return await loadLiveDashboard(session, runtime);
    }
    const session = await requireLiveSession();
    const snapshot = await loadLiveDashboard(session, runtime);
    if (!hasActiveGuildMembership(snapshot, guildId)) return snapshot;
    throw await toLiveModeError("leaveGuild", error);
  }
}

// 解散 guild。owner-only，由 Go runtime 刪除 group 與相關 guild membership。
export async function disbandGuild(guildId: string): Promise<DashboardSnapshot> {
  if (!guildId.trim()) throw new Error("Guild id is required.");

  try {
    const session = await requireLiveSession();
    const runtime = getRuntimeContext();
    await getNakamaClient().rpc(session, runtime.disbandGuildRpcId, { guildId });
    return await loadLiveDashboard(session, runtime);
  } catch (error) {
    throw await toLiveModeError("disbandGuild", error);
  }
}

// 踢出 guild 成員。權限與 owner/admin 規則在 Go runtime 檢查。
export async function kickGuildMember(guildId: string, userId: string): Promise<DashboardSnapshot> {
  try {
    const session = await requireLiveSession();
    const runtime = getRuntimeContext();
    await getNakamaClient().rpc(session, runtime.kickGuildMemberRpcId, { guildId, userId });
    return await loadLiveDashboard(session, runtime);
  } catch (error) {
    throw await toLiveModeError("kickGuildMember", error);
  }
}

// 接受好友邀請。Nakama 的 addFriends 對 inbound request 會轉為 accepted。
export async function acceptFriend(friendId: string): Promise<DashboardSnapshot> {
  try {
    const session = await requireLiveSession();
    await getNakamaClient().addFriends(session, [friendId]);
    return await loadLiveDashboard(session, getRuntimeContext());
  } catch (error) {
    throw await toLiveModeError("acceptFriend", error);
  }
}

// 拒絕好友邀請目前等同刪除該 friend edge。
export async function rejectFriend(friendId: string): Promise<DashboardSnapshot> {
  return removeFriend(friendId);
}

// 刪除好友或移除待處理邀請。
export async function removeFriend(friendId: string): Promise<DashboardSnapshot> {
  try {
    const session = await requireLiveSession();
    await getNakamaClient().deleteFriends(session, [friendId]);
    return await loadLiveDashboard(session, getRuntimeContext());
  } catch (error) {
    throw await toLiveModeError("removeFriend", error);
  }
}

// 取得 guild detail 一次性完整讀模型：metadata、members、requests、audit、contributions、metrics。
export async function fetchGuildDetail(guildId: string): Promise<GuildDetail> {
  try {
    const session = await requireLiveSession();
    const runtime = getRuntimeContext();
    const response = await getNakamaClient().rpc(session, runtime.getGuildDetailRpcId, { guildId });
    const parsed = parseRpcPayload<{
      guild: {
        id: string;
        name: string;
        description: string;
        kind: GroupKind;
        memberCount: number;
        viewerRole: CommunityRole;
        announcement?: string;
        joinPolicy?: GuildJoinPolicy;
      };
      members: GuildMember[];
      requests: GuildJoinRequest[];
      audit?: GuildAuditEntry[];
      contributions?: GuildContribution[];
      metrics?: { averageScore?: number; submittedMembers?: number };
    }>(response);

    return {
      guild: {
        id: parsed.guild.id,
        name: parsed.guild.name,
        description: parsed.guild.description,
        kind: parsed.guild.kind,
        memberCount: parsed.guild.memberCount,
        open: false,
        role: parsed.guild.viewerRole,
        canJoin: false,
        canRequestJoin: false,
        pendingRequests: parsed.requests,
        announcement: parsed.guild.announcement ?? "",
        joinPolicy: parsed.guild.joinPolicy ?? "request",
      },
      members: parsed.members,
      requests: parsed.requests,
      audit: parsed.audit ?? [],
      contributions: parsed.contributions ?? [],
      metrics: {
        averageScore: Number(parsed.metrics?.averageScore ?? 0),
        submittedMembers: Number(parsed.metrics?.submittedMembers ?? 0),
      },
    };
  } catch (error) {
    throw await toLiveModeError("fetchGuildDetail", error);
  }
}

// 更新 guild announcement 與 join policy。權限由 Go runtime 檢查。
export async function updateGuildSettings(
  guildId: string,
  payload: { announcement: string; joinPolicy: GuildJoinPolicy },
): Promise<void> {
  try {
    const session = await requireLiveSession();
    await getNakamaClient().rpc(session, getRuntimeContext().updateGuildSettingsRpcId, {
      guildId,
      announcement: payload.announcement,
      joinPolicy: payload.joinPolicy,
    });
  } catch (error) {
    throw await toLiveModeError("updateGuildSettings", error);
  }
}

// 取得 community detail。若該 community 是 guild，會轉接 fetchGuildDetail 取得完整治理資料。
export async function fetchCommunityDetail(communityId: string): Promise<CommunityDetail> {
  try {
    const session = await requireLiveSession();
    const client = getNakamaClient();
    const account = await client.getAccount(session);
    const userId = account.user?.id;

    if (!userId) throw new Error("Authenticated account is missing user data.");

    const memberships = await listLiveUserGroups(client, session, userId, 50);
    const membership = (memberships.user_groups ?? []).find((entry) => entry.group?.id === communityId);
    if (!membership?.group) throw new Error("Community membership not found.");

    if (membership.group.lang_tag === "guild") {
      const detail = await fetchGuildDetail(communityId);
      return { community: detail.guild, members: detail.members, requests: detail.requests };
    }

    const membersResult = await client.listGroupUsers(session, communityId, undefined, 100);
    return {
      community: {
        ...mapLiveCommunity(membership.group, membership.state, true),
        canJoin: false,
        canRequestJoin: false,
        pendingRequests: [],
      },
      members: (membersResult.group_users ?? []).map((entry) => ({
        userId: entry.user?.id ?? cryptoFallbackId(),
        username: entry.user?.username ?? "unknown",
        displayName: entry.user?.display_name ?? entry.user?.username ?? "Unknown player",
        role: mapGroupRole(entry.state),
      })),
      requests: [],
    };
  } catch (error) {
    throw await toLiveModeError("fetchCommunityDetail", error);
  }
}

// 提交 portfolio score。前端只送分數意圖，驗證、cooldown、排行榜寫入都在 Go runtime。
export async function submitPortfolioScore(score: number): Promise<DashboardSnapshot> {
  if (!Number.isFinite(score)) throw new Error("Score must be numeric.");

  try {
    const session = await requireLiveSession();
    const runtime = getRuntimeContext();
    const response = await getNakamaClient().rpc(session, runtime.scoreRpcId, {
      score: Math.round(score),
      source: "phase1-ui",
    });
    const payload = parseRpcPayload<{
      records?: { global?: LeaderboardRpcRecord | null; weekly?: LeaderboardRpcRecord | null; guildAverage?: LeaderboardRpcRecord | null };
    }>(response);
    const snapshot = await loadLiveDashboard(session, runtime);
    return mergeSubmittedLeaderboardRecords(snapshot, payload.records);
  } catch (error) {
    throw await toLiveModeError("submitPortfolioScore", error);
  }
}

// 組裝首頁 snapshot 的中心函式。所有登入後 UI 都盡量以這份 snapshot 為單一資料來源。
async function loadLiveDashboard(session: Session, runtime: RuntimeContext): Promise<DashboardSnapshot> {
  const client = getNakamaClient();
  const account = await client.getAccount(session);
  const userId = account.user?.id;

  if (!userId) throw new Error("Authenticated account is missing user data.");

  const [friendsResult, membershipsResult, discoverableResult, globalBoardResult, guildBoardResult] = await Promise.all([
    client.listFriends(session, undefined, 20),
    listLiveUserGroups(client, session, userId, 50),
    client.listGroups(session, undefined, undefined, 50),
    safeListLeaderboardRecords(client, session, runtime.leaderboardId),
    safeListLeaderboardRecords(client, session, runtime.guildLeaderboardId),
  ]);

  const friends = (friendsResult.friends ?? []).map(mapLiveFriend);
  const ownCommunities = (membershipsResult.user_groups ?? []).map((entry) =>
    mapLiveCommunity(entry.group, entry.state, true),
  );
  const communities = mergeDiscoverableCommunities(ownCommunities, discoverableResult.groups ?? []);
  const globalBoard = mapLeaderboardRecords(globalBoardResult.records ?? []);
  const guildBoard = mapLeaderboardRecords(guildBoardResult.records ?? []);
  const friendIds = new Set(friends.map((friend) => friend.id));
  const friendBoard = globalBoard.filter((entry) => friendIds.has(entry.ownerId) || entry.ownerId === userId);

  for (const community of communities) {
    if (community.kind === "guild" && (community.role === "owner" || community.role === "admin")) {
      community.pendingRequests = await loadLiveGuildRequests(session, runtime, community.id);
    }

    community.canRequestJoin =
      community.kind === "guild" && community.role === "visitor" && community.pendingRequests.length === 0;
    community.canJoin = community.kind === "group" && community.open && community.role === "visitor";
  }

  return {
    runtime,
    profile: {
      id: userId,
      username: account.user?.username ?? "unknown",
      displayName: account.user?.display_name ?? account.user?.username ?? userId,
      email: account.email ?? "",
    },
    friends,
    communities,
    leaderboards: { global: globalBoard, friends: friendBoard, guild: guildBoard },
  };
}

// 讀 leaderboard 失敗時降級成空榜，避免排行榜暫時失敗拖垮整個 dashboard。
async function safeListLeaderboardRecords(client: Client, session: Session, leaderboardId: string) {
  try {
    return await client.listLeaderboardRecords(session, leaderboardId, undefined, 20);
  } catch {
    return { records: [] as LeaderboardRecord[] };
  }
}

// 首頁 owner/admin guild 摘要用的 pending requests 載入函式。
async function loadLiveGuildRequests(session: Session, runtime: RuntimeContext, guildId: string) {
  try {
    const response = await getNakamaClient().rpc(session, runtime.listGuildJoinRequestsRpcId, { guildId });
    const parsed = parseRpcPayload<{ requests?: GuildJoinRequest[] }>(response);
    return parsed.requests ?? [];
  } catch {
    return [];
  }
}

// 包裝 Nakama listUserGroups，避免 SDK 參數順序細節散落在各處。
async function listLiveUserGroups(client: Client, session: Session, userId: string, limit: number) {
  return client.listUserGroups(session, userId, limit);
}

// 合併「已加入」與「可 discover」community。已加入資料優先，因為它包含角色狀態。
function mergeDiscoverableCommunities(mine: CommunityView[], discoverable: Group[]) {
  const seen = new Set(mine.map((community) => community.id));
  const merged = [...mine];

  for (const group of discoverable) {
    if (!group.id || seen.has(group.id)) continue;
    merged.push(mapLiveCommunity(group, undefined, false));
  }

  return merged;
}

// SDK Friend object -> UI FriendView。
function mapLiveFriend(friend: Friend): FriendView {
  return {
    id: friend.user?.id ?? cryptoFallbackId(),
    username: friend.user?.username ?? "unknown",
    displayName: friend.user?.display_name ?? friend.user?.username ?? "Unknown player",
    state: mapFriendState(friend.state),
  };
}

// SDK Group/UserGroup -> UI CommunityView。
function mapLiveCommunity(group: Group | undefined, state?: number, isMember = false): CommunityView {
  const kind = group?.lang_tag === "guild" ? "guild" : "group";
  const role = mapGroupRole(state);
  return {
    id: group?.id ?? cryptoFallbackId(),
    name: group?.name ?? "Unnamed community",
    description: group?.description ?? "No description",
    kind,
    memberCount: group?.edge_count ?? 0,
    open: group?.open ?? false,
    role,
    canJoin: kind === "group" && !isMember && (group?.open ?? false),
    canRequestJoin: kind === "guild" && !isMember,
    pendingRequests: [],
  };
}

// SDK LeaderboardRecord -> UI LeaderboardEntry。
function mapLeaderboardRecords(records: LeaderboardRecord[]): LeaderboardEntry[] {
  return records.map((record, index) => ({
    ownerId: record.owner_id ?? `owner-${index}`,
    username: record.username ?? "anonymous",
    score: Number(record.score ?? 0),
    rank: record.rank ?? index + 1,
  }));
}

// 把 submit score RPC 回傳的新紀錄合併進最新 snapshot，讓 UI 立即看到提交結果。
function mergeSubmittedLeaderboardRecords(
  snapshot: DashboardSnapshot,
  records?: { global?: LeaderboardRpcRecord | null; weekly?: LeaderboardRpcRecord | null; guildAverage?: LeaderboardRpcRecord | null },
): DashboardSnapshot {
  if (!records) return snapshot;

  return {
    ...snapshot,
    leaderboards: {
      ...snapshot.leaderboards,
      global: mergeLeaderboardEntry(snapshot.leaderboards.global, records.global),
      friends: mergeLeaderboardEntry(snapshot.leaderboards.friends, records.global),
      guild: mergeLeaderboardEntry(snapshot.leaderboards.guild, records.guildAverage),
    },
  };
}

// 合併單筆 leaderboard record，並重新依分數排序與重算 rank。
function mergeLeaderboardEntry(entries: LeaderboardEntry[], incoming?: LeaderboardRpcRecord | null): LeaderboardEntry[] {
  if (!incoming?.ownerId) return entries;

  const normalized: LeaderboardEntry = {
    ownerId: incoming.ownerId,
    username: incoming.username || incoming.ownerId,
    score: Number(incoming.score ?? 0),
    rank: Number(incoming.rank ?? entries.length + 1),
  };

  const next = entries.filter((entry) => entry.ownerId !== normalized.ownerId);
  next.push(normalized);
  next.sort((left, right) => (right.score !== left.score ? right.score - left.score : left.ownerId.localeCompare(right.ownerId)));

  return next.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

// Nakama friend state number -> UI friend state。
function mapFriendState(value?: number): FriendState {
  switch (value) {
    case 1:
      return "outbound";
    case 2:
      return "inbound";
    case 3:
      return "blocked";
    default:
      return "accepted";
  }
}

// Nakama group user state number -> UI role。
function mapGroupRole(value?: number): CommunityRole {
  switch (value) {
    case 0:
      return "owner";
    case 1:
      return "admin";
    case 3:
      return "requested";
    case undefined:
      return "visitor";
    default:
      return "member";
  }
}

// 判斷 leaveGuild 錯誤是否其實代表後端已經完成退出。
async function isGuildAlreadyLeftError(error: unknown) {
  const message = await extractErrorMessage(error);
  return (
    message.includes("User does not belong to the specified guild.") ||
    message.includes("User does not belong to the specified guild") ||
    message.includes("User does not belong to a guild.") ||
    message.includes("User does not belong to a guild")
  );
}

// 檢查 snapshot 是否仍存在有效 guild membership。
function hasActiveGuildMembership(snapshot: DashboardSnapshot, guildId?: string) {
  return snapshot.communities.some(
    (community) =>
      community.kind === "guild" &&
      (!guildId || community.id === guildId) &&
      (community.role === "owner" || community.role === "admin" || community.role === "member"),
  );
}
