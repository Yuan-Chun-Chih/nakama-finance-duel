package main

import "time"

// 用於 Nakama authoritative match 的常數定義，例如排行榜名稱、RPC 名稱、OpCode、資料庫集合名稱、比賽設定等。
const (
	leaderboardGlobal       = "portfolio_return_global"
	leaderboardWeekly       = "portfolio_return_weekly"
	leaderboardGuildAverage = "guild_average_return_weekly"

	rpcGetPhaseConfig        = "get_phase_config"
	rpcSubmitPortfolioScore  = "submit_portfolio_score"
	rpcCreateGuild           = "create_guild"
	rpcInviteGuildMember     = "invite_guild_member"
	rpcPromoteGuildAdmin     = "promote_guild_admin"
	rpcDemoteGuildAdmin      = "demote_guild_admin"
	rpcTransferGuildOwner    = "transfer_guild_owner"
	rpcRequestGuildJoin      = "request_guild_join"
	rpcApproveGuildJoin      = "approve_guild_join"
	rpcRejectGuildJoin       = "reject_guild_join"
	rpcLeaveGuild            = "leave_guild"
	rpcDisbandGuild          = "disband_guild"
	rpcKickGuildMember       = "kick_guild_member"
	rpcListGuildJoinRequests = "list_guild_join_requests"
	rpcGetGuildDetail        = "get_guild_detail"
	rpcUpdateGuildSettings   = "update_guild_settings"
	rpcSearchUsers           = "search_users"
	rpcIngestMatchCandles    = "ingest_match_candles"
	rpcListMatchCandles      = "list_match_candles"
	rpcCreateFinanceMatch    = "create_finance_match"
	rpcListFinanceHistory    = "list_finance_history"
	rpcGetFinanceMetrics     = "get_finance_metrics"
	rpcFinanceMatchmaking    = "finance_matchmaking"

	gameTypeFinance            = "finance"
	financeAuthoritativeModule = "finance_authoritative_match"
	financeReadyOpCode         = 220
	financeOrderOpCode         = 221
	financeCancelOpCode        = 222
	financeStateRequestOpCode  = 223
	financeStateOpCode         = 224
	financeEventOpCode         = 225
	financeResignOpCode        = 226
	financeMatchCancelOpCode   = 227

	collectionGuildMembership              = "guild_membership"
	collectionGuildRequests                = "guild_join_requests"
	collectionGuildConfig                  = "guild_config"
	collectionGuildAudit                   = "guild_audit_log"
	collectionGuildOperations              = "guild_operations"
	collectionPortfolioScores              = "portfolio_scores"
	collectionMatchPriceFeed               = "match_price_feed"
	collectionMatchCandles                 = "match_price_candles"
	collectionMarketIngestNonces           = "market_ingest_nonces"
	collectionFinanceGames                 = "finance_games"
	collectionFinanceEvents                = "finance_events"
	collectionFinanceSnapshots             = "finance_snapshots"
	collectionFinanceOrders                = "finance_orders"
	collectionFinanceFills                 = "finance_fills"
	collectionFinancePortfolios            = "finance_portfolio_snapshots"
	collectionFinanceStats                 = "finance_player_stats"
	collectionFinanceHistory               = "finance_player_history"
	collectionFinanceMatchmaking           = "finance_matchmaking"
	collectionFinanceMetrics               = "finance_system_metrics"
	collectionFinanceIdempotency           = "finance_order_idempotency"
	collectionFinanceArenaIndex            = "finance_arena_index"
	collectionFinanceMaintenance           = "finance_maintenance"
	collectionFinanceLeaderboardProjection = "finance_leaderboard_projection"
	marketCandleCollectionPrefix           = "market_candles_"

	guildMembershipKey              = "active"
	guildConfigKey                  = "config"
	portfolioScoreKey               = "latest"
	maxPortfolioScore               = 1000000000
	maxGuildMembers                 = 100
	scoreSubmissionCooldownMS       = 5000
	matchLobbyTTLMinutes            = 60
	matchTakerFeeBps                = 8
	matchTaxBps                     = 10
	matchMaxPosition                = 1000
	authoritativeMatchTickRate      = 1
	financeInitialCashCents         = int64(100000000)
	financeUSDScale                 = int64(100)
	financeBTCScale                 = int64(1000000)
	financeRoundTicks               = int64(10)
	financeMatchTicks               = int64(300)
	financeCountdownTicks           = int64(3)
	financeConfirmationTicks        = int64(30)
	financeReconnectGraceTicks      = int64(20)
	financePriceMaxAgeSeconds       = int64(30)
	financeInitialRating            = 1000
	financeRatingKFactor            = 32
	financeStatsCASRetries          = 4
	financeIdempotencyRetention     = 24 * time.Hour
	financeMaintenanceIntervalTicks = int64(60)
	financeMaintenanceLeaseDuration = 55 * time.Second
	financeCleanupBatchSize         = 100
	financeCancelCooldownSeconds    = int64(5)
	financeMatchmakingLease         = 90 * time.Second
	financeRunningLease             = 6 * time.Minute
	financeMetricsShardCount        = 16
	financeMutationMessagesPerTick  = 6
	financeStateRequestsPerTick     = 3
	marketCandleRetention           = 30 * 24 * time.Hour
	marketIngestNonceRetention      = 24 * time.Hour
	marketCleanupIntervalTicks      = int64(300)
	marketMaintenanceLeaseDuration  = 295 * time.Second
	marketCandleRetentionBatchSize  = 300
	guildStorageScanPageSize        = 100
	guildStorageScanMaxRecords      = 5000

	grpcInvalidArgument    = 3
	grpcNotFound           = 5
	grpcPermissionDenied   = 7
	grpcResourceExhausted  = 8
	grpcFailedPrecondition = 9
	grpcOutOfRange         = 11
	grpcUnauthenticated    = 16
)
