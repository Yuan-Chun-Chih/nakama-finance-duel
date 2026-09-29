# Go Function Review Order

This index is generated from the current services/nakama/*.go files. Each function is listed in source order.

## runtime.go

- [InitModule](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime.go:11) - line 11
- [stringParam](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime.go:79) - line 79
- [stringSetParam](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime.go:87) - line 87
- [registerLeaderboards](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime.go:109) - line 109

## Community module

Top-down guide: [runtime_community_go_review.md](runtime_community_go_review.md).

### runtime_community_score.go

- [rpcGetPhaseConfigHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_score.go:17) - line 17
- [rpcSubmitPortfolioScoreHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_score.go:68) - line 68
- [updateGuildAverageLeaderboard](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_score.go:160) - line 160
- [updateGuildAverageLeaderboardForGuild](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_score.go:171) - line 171

### runtime_community_guild_lifecycle.go

- [rpcCreateGuildHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_lifecycle.go:15) - line 15
- [rpcLeaveGuildHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_lifecycle.go:97) - line 97
- [rpcDisbandGuildHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_lifecycle.go:161) - line 161

### runtime_community_guild_members.go

- [rpcInviteGuildMemberHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_members.go:16) - line 16
- [rpcRequestGuildJoinHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_members.go:83) - line 83
- [rpcApproveGuildJoinHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_members.go:149) - line 149
- [rpcRejectGuildJoinHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_members.go:203) - line 203
- [rpcKickGuildMemberHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_members.go:232) - line 232

### runtime_community_guild_governance.go

- [rpcPromoteGuildAdminHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_governance.go:16) - line 16
- [rpcDemoteGuildAdminHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_governance.go:65) - line 65
- [rpcTransferGuildOwnerHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_governance.go:112) - line 112
- [rpcUpdateGuildSettingsHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_governance.go:224) - line 224

### runtime_community_guild_queries.go

- [rpcListGuildJoinRequestsHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_queries.go:14) - line 14
- [rpcGetGuildDetailHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_queries.go:38) - line 38
- [rpcSearchUsersHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_guild_queries.go:97) - line 97

### runtime_community_storage.go

- [Community storage helpers](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_storage.go:17) - lines 17-379

### runtime_community_views.go

- [buildGuildMemberAndContributionViews](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_views.go:15) - line 15
- [toGuildAverageSummary](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_views.go:108) - line 108

## runtime_community_helpers.go

- [findGroupUserByID](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_helpers.go:14) - line 14
- [ensureCommunityMembership](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_helpers.go:25) - line 25
- [normalizeCommunityKind](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_helpers.go:47) - line 47
- [stateOf](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_helpers.go:55) - line 55
- [groupUserState](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_helpers.go:63) - line 63
- [enforceScoreSubmissionPolicy](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_helpers.go:68) - line 68
- [toRecordSummary](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_helpers.go:100) - line 100
- [validateScore](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_community_helpers.go:114) - line 114

## runtime_community_models.go

No function declarations.

## runtime_config.go

No function declarations.

## runtime_finance_history.go

- [rpcListFinanceHistoryHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:15) - line 15
- [rpcGetFinanceMetricsHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:79) - line 79
- [financeMetricsAdminAllowed](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:95) - line 95
- [readFinanceArenaStatus](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:105) - line 105
- [filterFinanceOrdersByUser](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:120) - line 120
- [filterFinanceFillsByUser](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:131) - line 131
- [filterFinancePortfolioSnapshotsByUser](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:142) - line 142
- [ensureFinanceArenaPlayer](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:153) - line 153
- [financeAppendArenaIndex](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:176) - line 176
- [appendUniqueStrings](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:212) - line 212
- [readFinanceArenaIndex](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:231) - line 231
- [financeBackfillArenaIndex](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:247) - line 247
- [listLegacyArenaKeys](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:276) - line 276
- [readFinanceMaintenanceCursor](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:297) - line 297
- [listFinanceOrders](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:313) - line 313
- [listFinanceFills](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:346) - line 346
- [listFinancePortfolioSnapshots](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:377) - line 377
- [readFinanceBTCPrice](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:413) - line 413
- [financePriceIsStale](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_history.go:429) - line 429

## runtime_finance_match.go

- [MatchInit](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_match.go:14) - line 14
- [MatchJoinAttempt](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_match.go:64) - line 64
- [MatchJoin](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_match.go:91) - line 91
- [MatchLeave](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_match.go:114) - line 114
- [MatchLoop](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_match.go:132) - line 132
- [financeFinish](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_match.go:232) - line 232
- [financeBroadcastState](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_match.go:259) - line 259
- [financeOpponentLeadStatus](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_match.go:318) - line 318
- [MatchTerminate](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_match.go:335) - line 335
- [MatchSignal](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_match.go:340) - line 340

## runtime_finance_matchmaking.go

- [financeMatchmakerMatched](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_matchmaking.go:16) - line 16
- [claimFinanceMatchmaking](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_matchmaking.go:67) - line 67
- [financeSetConfirmationOutcome](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_matchmaking.go:99) - line 99
- [financeSetMatchmakingStatus](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_matchmaking.go:121) - line 121
- [financeMatchmakingLeaseExpiry](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_matchmaking.go:138) - line 138
- [financeRecoverExpiredMatchmaking](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_matchmaking.go:150) - line 150
- [rpcCreateFinanceMatchHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_matchmaking.go:162) - line 162
- [rpcFinanceMatchmakingHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_matchmaking.go:183) - line 183
- [readFinanceMatchmaking](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_matchmaking.go:232) - line 232
- [writeFinanceMatchmaking](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_matchmaking.go:248) - line 248

## runtime_finance_math.go

- [calculateBpsCeil](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_math.go:6) - line 6

## runtime_finance_models.go

No function declarations.

## runtime_finance_orders.go

- [financeHandleMessage](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:15) - line 15
- [financeAcceptOrder](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:84) - line 84
- [financeTryFillOrder](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:167) - line 167
- [financeProcessOpenOrders](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:242) - line 242
- [financeRefreshPrice](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:254) - line 254
- [financeMarkPortfolios](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:270) - line 270
- [financeRejectIntent](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:279) - line 279
- [financeHasPlayer](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:287) - line 287
- [financeAllReady](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:297) - line 297
- [financeUserOnline](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:302) - line 302
- [financeAvailableSellQuantity](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:312) - line 312
- [financeReservedBuyNotional](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:326) - line 326
- [financeNotional](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:342) - line 342
- [financeAffordableBuyQuantity](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:347) - line 347
- [financeOtherPlayers](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:365) - line 365
- [financeNAVWinners](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_orders.go:376) - line 376

## runtime_finance_persistence.go

- [financeAppendEvent](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:15) - line 15
- [financePersistSnapshot](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:41) - line 41
- [financePersistOrder](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:53) - line 53
- [financeOrderIdempotencyKey](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:67) - line 67
- [readFinanceOrderIdempotency](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:72) - line 72
- [financePersistOrderIdempotency](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:92) - line 92
- [financeCleanupExpiredIdempotency](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:109) - line 109
- [financeIdempotencyCleanupPage](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:135) - line 135
- [financeUpdateMetrics](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:162) - line 162
- [readFinanceMetrics](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:199) - line 199
- [financeMetricsShardKey](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:224) - line 224
- [financeMergeMetrics](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:229) - line 229
- [financePersistFill](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:247) - line 247
- [financePersistRoundPortfolios](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:256) - line 256
- [persistFinanceGameAndStats](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:284) - line 284
- [financeUpdatedPlayerStats](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:317) - line 317
- [financeHistoryKey](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:383) - line 383
- [readFinancePlayerStats](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_persistence.go:392) - line 392

## runtime_finance_test.go

- [TestFinanceNotionalPreservesBTCMicrosPrecision](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_test.go:10) - line 10
- [TestFinanceFeesAndSlippageUseBasisPoints](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_test.go:31) - line 31
- [TestFinancePriceFreshness](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_test.go:47) - line 47
- [TestFinanceIdempotencyCleanupPageExpiresOnlyInvalidOrPastRecords](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_test.go:62) - line 62
- [TestMarketCandleIndexUsesSymbolCollectionAndNewestFirstKey](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_test.go:87) - line 87
- [TestFinanceMatchmakingLeaseRecovery](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_test.go:99) - line 99
- [TestFinanceMetricsMergeAggregatesShards](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_finance_test.go:113) - line 113

## runtime_market.go

- [rpcIngestMatchCandlesHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_market.go:18) - line 18
- [rpcListMatchCandlesHandler](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_market.go:70) - line 70
- [listMarketCandles](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_market.go:107) - line 107
- [listLegacyMarketCandles](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_market.go:127) - line 127
- [seedDefaultMatchPriceFeed](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_market.go:157) - line 157
- [writeDefaultBTCPrice](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_market.go:170) - line 170
- [storageWriteOne](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_market.go:177) - line 177
- [validateMatchCandle](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_market.go:183) - line 183
- [buildMatchCandleKey](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_market.go:194) - line 194
- [marketCandleCollection](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_market.go:199) - line 199
- [cleanupMarketCandleRetention](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_market.go:206) - line 206
- [defaultMatchPrices](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_market.go:243) - line 243
- [applyMatchSlippage](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_market.go:248) - line 248
- [maxInt64](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_market.go:260) - line 260

## runtime_market_models.go

No function declarations.

## runtime_rpc_helpers.go

- [requireUserID](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_rpc_helpers.go:12) - line 12
- [contextString](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_rpc_helpers.go:21) - line 21
- [parsePayload](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_rpc_helpers.go:27) - line 27
- [defaultString](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_rpc_helpers.go:38) - line 38
- [mustJSON](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_rpc_helpers.go:46) - line 46
- [invalidArgument](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_rpc_helpers.go:55) - line 55
- [outOfRange](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_rpc_helpers.go:60) - line 60
- [notFound](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_rpc_helpers.go:65) - line 65
- [permissionDenied](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_rpc_helpers.go:70) - line 70
- [failedPrecondition](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_rpc_helpers.go:75) - line 75
- [unauthenticated](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/runtime_rpc_helpers.go:80) - line 80

Total functions: 161.
