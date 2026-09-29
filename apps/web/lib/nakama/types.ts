// 這個檔案只放型別，不放任何 runtime logic。
// 目的：讓 dashboard.ts、chat.ts、client.ts 和 React component 共用同一套資料模型。

// Nakama group 會被本專案分成一般 group 與帶治理規則的 guild。
export type GroupKind = "group" | "guild";

// Match transport 與 lobby 共用的遊戲識別；新增遊戲時擴充這個 union 即可。
export type MatchGameType = "finance";

// Nakama friend state 轉成前端較好讀的語意。
export type FriendState = "accepted" | "outbound" | "inbound" | "blocked";

// group/guild 成員角色。visitor 代表尚未加入，只是可被 discover 的 community。
export type CommunityRole =
  "owner" | "admin" | "member" | "requested" | "visitor";

// 聊天目標分三種：好友 DM、一般 group、guild。
export type ChatTargetKind = "friend" | "group" | "guild";

// 前端需要知道的 Nakama runtime 設定。
// 這些 id 由 client.ts 的 getRuntimeContext 集中建立，避免 UI 到處硬編 RPC 名稱。
export type RuntimeContext = {
  mode: "nakama";
  leaderboardId: string;
  guildLeaderboardId: string;
  scoreRpcId: string;
  createGuildRpcId: string;
  inviteGuildMemberRpcId: string;
  promoteGuildAdminRpcId: string;
  demoteGuildAdminRpcId: string;
  transferGuildOwnerRpcId: string;
  requestGuildJoinRpcId: string;
  approveGuildJoinRpcId: string;
  rejectGuildJoinRpcId: string;
  leaveGuildRpcId: string;
  disbandGuildRpcId: string;
  kickGuildMemberRpcId: string;
  listGuildJoinRequestsRpcId: string;
  getGuildDetailRpcId: string;
  updateGuildSettingsRpcId: string;
  searchUsersRpcId: string;
  createFinanceMatchRpcId: string;
  financeMatchmakingRpcId: string;
  listFinanceHistoryRpcId: string;
  listMatchCandlesRpcId: string;
};

// 登入 / 註冊共用 payload。
// login 不需要 username；register 需要 username。
export type AuthPayload = {
  email: string;
  password: string;
  username?: string;
};

// 建立 community 的表單資料。
// guild 會被後端強制 private；open 主要給一般 group 使用。
export type CommunityPayload = {
  name: string;
  description: string;
  kind: GroupKind;
  open: boolean;
};

// guild 加入申請，由 Go runtime 寫入 storage。
export type GuildJoinRequest = {
  guildId: string;
  userId: string;
  username: string;
  requestedAt: string;
};

// guild / group 成員在 detail page 的讀模型。
export type GuildMember = {
  userId: string;
  username: string;
  displayName: string;
  role: CommunityRole;
};

// guild 的加入政策。
// request：可送申請；invite_only：只能由管理者邀請。
export type GuildJoinPolicy = "request" | "invite_only";

// guild 治理事件，用於 audit log。
export type GuildAuditEntry = {
  id: string;
  guildId: string;
  action: string;
  actorId: string;
  actorName: string;
  targetUserId?: string;
  targetName?: string;
  summary: string;
  createdAt: string;
};

// guild 成員對 leaderboard 的貢獻讀模型。
// latestScore 來自 portfolio_scores，deltaFromAverage 用於看出與公會平均的差距。
export type GuildContribution = {
  userId: string;
  username: string;
  displayName: string;
  role: CommunityRole;
  hasScore: boolean;
  latestScore?: number;
  updatedAt?: string;
  deltaFromAverage?: number;
};

// guild detail page 需要的一次性完整 snapshot。
export type GuildDetail = {
  guild: CommunityView & {
    announcement: string;
    joinPolicy: GuildJoinPolicy;
  };
  members: GuildMember[];
  requests: GuildJoinRequest[];
  audit: GuildAuditEntry[];
  contributions: GuildContribution[];
  metrics: {
    averageScore: number;
    submittedMembers: number;
  };
};

// 一般 community detail 頁的共用讀模型。
export type CommunityDetail = {
  community: CommunityView;
  members: GuildMember[];
  requests: GuildJoinRequest[];
};

// Friends tab 使用的好友讀模型。
export type FriendView = {
  id: string;
  username: string;
  displayName: string;
  state: FriendState;
};

// 新增好友搜尋結果。
// 這是「尚未加入好友清單的玩家候選」，不是 FriendView。
export type UserSearchCandidate = {
  userId: string;
  username: string;
  displayName: string;
};

// dashboard community card 使用的讀模型。
// role / canJoin / canRequestJoin 是 UI 顯示輔助，真正權限仍由 Nakama runtime 判定。
export type CommunityView = {
  id: string;
  name: string;
  description: string;
  kind: GroupKind;
  memberCount: number;
  open: boolean;
  role: CommunityRole;
  canJoin: boolean;
  canRequestJoin: boolean;
  pendingRequests: GuildJoinRequest[];
};

// leaderboard 列表顯示用資料。
export type LeaderboardEntry = {
  ownerId: string;
  username: string;
  score: number;
  rank: number;
};

export type LeaderboardSets = {
  global: LeaderboardEntry[];
  friends: LeaderboardEntry[];
  guild: LeaderboardEntry[];
};

export type UserProfile = {
  id: string;
  username: string;
  displayName: string;
  email: string;
};

// 首頁 dashboard 的主要資料來源。
// React component 盡量只讀這份 snapshot，mutation 後也重新取得 snapshot。
export type DashboardSnapshot = {
  runtime: RuntimeContext;
  profile: UserProfile | null;
  friends: FriendView[];
  communities: CommunityView[];
  leaderboards: LeaderboardSets;
};

// chat.ts 的高階聊天目標，不直接暴露 Nakama channel id。
export type ChatTarget = {
  id: string;
  kind: ChatTargetKind;
  label: string;
  subtitle: string;
};

export type ChatDeliveryState = "sent" | "sending" | "failed";

// 前端聊天室訊息模型，將 Nakama ChannelMessage 正規化後供 UI 顯示。
export type ChatMessageView = {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  deliveryState?: ChatDeliveryState;
};

export type ChatSession = {
  channelId: string;
  target: ChatTarget;
  messages: ChatMessageView[];
  nextCursor: string | null;
  prevCursor: string | null;
};

export type ChatPage = {
  messages: ChatMessageView[];
  nextCursor: string | null;
  prevCursor: string | null;
};

// realtime metadata 給 UI 顯示 online / presence / typing 狀態。
export type RealtimeMetaSnapshot = {
  onlineUserIds: string[];
  channelPresenceById: Record<string, string[]>;
  typingByChannelId: Record<string, { userId: string; username: string }[]>;
};

// Relayed match 是 client-authoritative 的即時對戰房。
// Nakama 只負責轉送 match state，正式分數仍應交給 Go runtime 驗證。
// Relayed match 中的單一 presence。sessionId 比 userId 更適合用來處理多開分頁與 directed send。
export type RelayedMatchPresenceView = {
  userId: string;
  sessionId: string;
  username: string;
  node: string;
  isSelf: boolean;
};

// 前端加入 Nakama relayed match 後的主要 session view model。
// hostSessionId 是 client-side deterministic host，不是 Nakama authoritative host。
export type RelayedMatchSession = {
  matchId: string;
  authoritative: boolean;
  label?: string;
  size: number;
  self: RelayedMatchPresenceView;
  presences: RelayedMatchPresenceView[];
  hostSessionId: string | null;
};

// match data 的通用 payload。不同 op code 會使用不同欄位，例如 ready、timer、ping/pong 或 state snapshot。
export type RelayedMatchPayload = {
  kind: string;
  body?: string;
  ready?: boolean;
  secondsRemaining?: number;
  durationSeconds?: number;
  round?: number;
  roundStartedAt?: string;
  sessionId?: string;
  cash?: number;
  pnl?: number;
  nonce?: string;
  sentAt?: number;
  sequence?: number;
  state?: Record<string, unknown>;
  createdAt: string;
};

// UI event log 的單筆事件。可能來自 Nakama match data，也可能是前端自己產生的 optimistic/system event。
export type RelayedMatchEvent = {
  id: string;
  matchId: string;
  opCode: number;
  senderId: string;
  senderName: string;
  payload: RelayedMatchPayload | Record<string, unknown> | string;
  raw: string;
  reliable: boolean;
  createdAt: string;
};

// Presence join/leave event 的 normalized view；presences 是套用 joins/leaves 後的完整目前名單。
export type RelayedMatchPresenceEvent = {
  matchId: string;
  joins: RelayedMatchPresenceView[];
  leaves: RelayedMatchPresenceView[];
  presences: RelayedMatchPresenceView[];
  hostSessionId: string | null;
};

// Go runtime 維護的產品層 lobby。Nakama relayed match 本身沒有依 group/guild 查 lobby 的 API。
export type MatchLobbyView = {
  communityId: string;
  kind: GroupKind;
  matchId: string;
  name: string;
  gameType: MatchGameType;
  hostUserId: string;
  hostName: string;
  createdAt: string;
  expiresAt: string;
  status: "open" | "closed";
};

// Go runtime 保存的 match result。現階段 score 仍來自 client，正式版本應由 server 重算。
export type MatchResultView = {
  id: string;
  communityId: string;
  kind: GroupKind;
  matchId: string;
  stateVersion?: number;
  userId: string;
  username: string;
  score: number;
  summary: string;
  hostUserId: string;
  participantUserIds: string[];
  readyUserIds: string[];
  eventCount: number;
  eventHash: string;
  settlement?: MatchSettlementView;
  validation: string;
  submittedAt: string;
};

export type MatchOrderPayload = {
  id: string;
  userId: string;
  symbol: string;
  side: "buy" | "sell";
  orderType?: "limit" | "market";
  timeInForce?: "gtc" | "ioc";
  postOnly?: boolean;
  reduceOnly?: boolean;
  quantity: number;
  limitPrice: number;
  round: number;
  createdAt: string;
};

export type MatchCandleView = {
  symbol: string;
  round: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
  source: string;
  updatedAt: string;
};

export type MatchParticipantSettlementView = {
  userId: string;
  cash: number;
  positions: Record<string, number>;
  averageCost?: Record<string, number>;
  realizedPnl?: number;
  unrealizedPnl?: number;
  exposure?: number;
  nav: number;
  pnl: number;
  returnBps: number;
  score: number;
};

export type MatchOrderSubmissionView = {
  accepted?: boolean;
  stateVersion?: number;
  order: MatchOrderPayload;
  portfolio?: MatchParticipantSettlementView;
  settlement?: MatchSettlementView;
};

export type MatchOrderBookView = {
  communityId: string;
  kind: GroupKind;
  matchId: string;
  stateVersion?: number;
  orderId: string;
  userId: string;
  status: string;
  reason?: string;
  requestedQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  expiresRound: number;
  settlement?: MatchSettlementView["orders"][number];
  updatedAt: string;
};

export type MatchEventView = {
  id: string;
  communityId: string;
  kind: GroupKind;
  matchId: string;
  stateVersion?: number;
  sequence?: number;
  type: string;
  orderId?: string;
  userId?: string;
  payload?: unknown;
  createdAt: string;
};

export type MatchSettlementView = {
  stateVersion?: number;
  initialCash: number;
  prices: Record<string, number>;
  fills: Array<{
    orderId: string;
    userId: string;
    symbol: string;
    side: "buy" | "sell";
    liquidityRole?: "maker" | "taker" | "mixed" | string;
    quantity: number;
    price: number;
    notional: number;
    fee: number;
    tax: number;
    slippage: number;
    round: number;
    createdAt: string;
    executedAt: string;
  }>;
  orders: Array<{
    orderId: string;
    userId: string;
    symbol: string;
    side: "buy" | "sell";
    orderType?: "limit" | "market" | string;
    timeInForce?: "gtc" | "ioc" | string;
    postOnly?: boolean;
    reduceOnly?: boolean;
    liquidityRole?: "maker" | "taker" | "mixed" | string;
    requestedQuantity: number;
    filledQuantity: number;
    limitPrice: number;
    executionPrice: number;
    status: "filled" | "partial" | "rejected" | "expired" | string;
    reason?: string;
    fee: number;
    tax: number;
    slippage: number;
    round: number;
    createdAt: string;
  }>;
  participants: MatchParticipantSettlementView[];
  winnerUserIds: string[];
};

export type MatchReplayView = {
  communityId: string;
  kind: GroupKind;
  matchId: string;
  stateVersion?: number;
  result?: MatchResultView;
  settlement?: MatchSettlementView;
  orders?: MatchOrderPayload[];
  orderBook?: MatchOrderBookView[];
  fills?: MatchSettlementView["fills"];
  events?: MatchEventView[];
  candles?: Record<string, MatchCandleView> | MatchCandleView[];
  storedAt?: string;
  rebuiltAt?: string;
};

export type FinancePortfolioView = {
  userId: string;
  cashCents: number;
  quantityMicros: number;
  averageCostCents: number;
  realizedPnlCents: number;
  unrealizedPnlCents: number;
  navCents: number;
  returnBps: number;
};

export type FinanceOrderView = {
  id: string;
  userId: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantityMicros: number;
  remainingQuantityMicros: number;
  limitPriceCents: number;
  status: string;
  reason?: string;
  round: number;
  createdAt: string;
  updatedAt: string;
};

export type FinanceMatchStateView = {
  kind: "finance_state";
  arenaId: string;
  status:
    | "waiting"
    | "matched_confirming"
    | "countdown"
    | "running"
    | "finished"
    | "canceled";
  players: string[];
  usernames: Record<string, string>;
  ready: Record<string, boolean>;
  online: Record<string, boolean>;
  portfolios: Record<string, FinancePortfolioView>;
  openOrders: FinanceOrderView[];
  round: number;
  remainingSeconds: number;
  countdownSeconds: number;
  priceCents: number;
  priceUpdatedAt: string;
  marketStale: boolean;
  winnerUserIds: string[];
  finishReason: string;
  serverTick: number;
  stateVersion: number;
  opponentLeadStatus: "you_ahead" | "even" | "opponent_ahead";
  canceledByUserId?: string;
  cancelReason?: string;
};

export type FinanceMatchmakingView = {
  userId: string;
  status:
    "idle" | "searching" | "matching" | "matched" | "running" | "cooldown";
  matchId?: string;
  queueToken?: string;
  searchStartedAt?: string;
  cooldownUntil?: string;
  updatedAt: string;
};

export type FinanceMatchEventView = {
  arenaId: string;
  sequence: number;
  type: string;
  actorUserId?: string;
  detail?: string;
  round: number;
  createdAt: string;
};

export type FinanceFillView = {
  id: string;
  arenaId: string;
  orderId: string;
  userId: string;
  side: "buy" | "sell";
  quantityMicros: number;
  priceCents: number;
  notionalCents: number;
  feeCents: number;
  taxCents: number;
  slippageCents: number;
  round: number;
  executedAt: string;
};

export type FinancePortfolioSnapshotView = {
  arenaId: string;
  round: number;
  priceCents: number;
  portfolio: FinancePortfolioView;
  createdAt: string;
};

export type FinancePlayerStatsView = {
  userId: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  rating: number;
  ratingDelta: number;
  totalReturnBps: number;
  bestReturnBps: number;
  updatedAt: string;
};

export type FinanceGameView = {
  arenaId: string;
  communityId: string;
  kind: GroupKind;
  players: string[];
  portfolios: Record<string, FinancePortfolioView>;
  winnerUserIds: string[];
  finishReason: string;
  startedAt: string;
  finishedAt: string;
  ratings: Array<{
    userId: string;
    before: number;
    after: number;
    delta: number;
  }>;
};

export type FinanceHistoryPage = {
  stats: FinancePlayerStatsView;
  games: FinanceGameView[];
  cursor?: string;
  orders: FinanceOrderView[];
  fills: FinanceFillView[];
  portfolioSnapshots: FinancePortfolioSnapshotView[];
};

export type FinanceSystemMetricsView = {
  matchmakingStarts: number;
  matchedPlayers: number;
  totalMatchWaitSeconds: number;
  completedMatches: number;
  totalStaleMarketSeconds: number;
  orderRejections: Record<string, number>;
  updatedAt: string;
};

export type TicTacToeMoveView = {
  round: number;
  cell: number;
  userId: string;
  symbol: "X" | "O";
  createdAt: string;
};

export type TicTacToeGameView = {
  gameId: string;
  communityId: string;
  kind: GroupKind;
  players: [string, string];
  winnerUserId: string;
  draw: boolean;
  moves: TicTacToeMoveView[];
  startedAt: string;
  finishedAt: string;
  finishReason: string;
  ratings: Array<{
    userId: string;
    before: number;
    after: number;
    delta: number;
  }>;
};

export type TicTacToePlayerStatsView = {
  userId: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  rating: number;
  ratingDelta: number;
  updatedAt: string;
};

export type TicTacToeHistoryPage = {
  games: TicTacToeGameView[];
  stats: TicTacToePlayerStatsView;
  cursor?: string;
};

// Nakama RPC response 的 payload 包裝型別。
export type RpcResponsePayload<T> = {
  payload?: T | string | object;
};

// submit_portfolio_score RPC 回傳的排行榜紀錄摘要。
export type LeaderboardRpcRecord = {
  ownerId: string;
  username: string;
  score?: number;
  subscore?: number;
  rank?: number;
};
