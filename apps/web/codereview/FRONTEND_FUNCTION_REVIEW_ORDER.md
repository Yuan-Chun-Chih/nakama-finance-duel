# 前端 Function Review 順序

本文件是前端 review 的快速索引，實際內容請依序閱讀 `FRONTEND_CODE_REVIEW.md` 與其下層文件。

## 1. 路由入口

1. `RootLayout()`：`app/layout.tsx`
2. `Home()`：`app/page.tsx`
3. `MatchesPage()`：`app/matches/page.tsx`
4. `CommunityMatchPage()`：`app/matches/[kind]/[id]/page.tsx`
5. `CommunityDetailPage()`：`app/communities/[id]/page.tsx`
6. `GuildDetailPage()`：`app/guilds/[id]/page.tsx`

## 2. Shell 與主要 feature

1. `MatchArenaClient()`：載入 arena bootstrap、community context、error retry。
2. `PhaseOneDashboard()`：首頁 auth、社群、好友、排行榜、聊天與 finance feature host。
3. `FinanceDuelMatchPanel()`：配對、確認、倒數、socket snapshot、下單、結算與歷史。
4. `FinanceMatchmakingPanel()`：顯示搜尋對手與等待時間。
5. `MobileArenaTabs()`：手機版市場、交易、portfolio、history 分頁。
6. `MarketPanel()`：K 線、成交量、技術指標與交易控制入口。
7. `FinanceRecordPanel()` / `ExchangeHistoryPanel()`：顯示後端 stats、orders、fills、snapshots。
8. `RealtimeChatPanel()`：channel、訊息、typing、unread 與 cursor pagination。
9. `CommunityDetailClient()` / `GuildDetailClient()`：社群 detail 與治理操作。

## 3. Finance 子元件與 hooks

1. `useFinanceMatchReconnect()`：斷線時單一 join、指數退避與 retry。
2. `MatchConfirmationDialog()`：雙方確認配對。
3. `GameStartCountdownDialog()`：顯示 server countdown。
4. `ActionConfirmDialog()`：resign/leave 確認。
5. `FinanceTradeTicket()`：手機 bottom sheet、數量 input/slider 與 order intent。
6. `buildIndicators()`：由 candles 衍生只讀行情指標。
7. `buildPortfolioPerformance()`：由 snapshots 衍生績效曲線與最大回撤。

## 4. Service layer

### Session 與 RPC context

1. `getNakamaClient()`
2. `getRuntimeContext()`
3. `restoreLiveSession()`
4. `requireLiveSession()`
5. `persistLiveSession()` / `clearLiveSession()`
6. `parseRpcPayload()` / `extractErrorMessage()`

### Dashboard RPC

1. `bootstrapPhaseOne()`
2. `registerWithEmail()` / `loginWithEmail()` / `logoutFromRuntime()`
3. `createCommunity()` / `joinCommunity()` / `leaveGroup()`
4. `requestGuildJoin()` / `approveGuildJoin()` / `rejectGuildJoin()`
5. `sendFriendInvite()` / `acceptFriend()` / `rejectFriend()` / `removeFriend()`
6. `fetchCommunityDetail()` / `fetchGuildDetail()`
7. `submitPortfolioScore()`

### Match 與 Finance socket

1. `createFinanceMatch()`
2. `updateFinanceMatchmaking()`
3. `startFinanceMatchmaking()` / `removeRelayedMatchmaker()`
4. `joinRelayedMatch()` / `leaveRelayedMatch()`
5. `sendRelayedMatchState()`
6. `subscribeToRelayedMatchData()` / `subscribeToRelayedMatchPresence()`
7. `subscribeToRealtimeConnection()`
8. `persistRelayedMatchResume()` / `restoreRelayedMatchResume()` / `clearRelayedMatchResume()`
9. `normalizeMatchData()` / `decodeMatchData()` / `parseMatchPayload()`
10. `guardRelayedMatchSend()`

### Chat socket

1. `buildChatTargets()`
2. `openChatSession()`
3. `loadOlderChatMessages()`
4. `sendChatMessage()` / `sendTypingSignal()`
5. `subscribeToChatChannel()`
6. `emitUnreadCounts()` / `emitRealtimeMeta()`

## 5. 外部流程與測試

1. `price-feed-worker.mjs:main()`：長駐行情流程。
2. `price-feed-worker.mjs:ingestOnce()`：一次行情 ingestion。
3. `integration-smoke.mjs:main()`：社群、好友、排行榜、聊天 smoke。
4. `finance-duel-smoke.mjs:waitForState()`：等待 authoritative snapshot。
5. `finance-duel-smoke.mjs:main()`：finance 對局 smoke。

## 6. 對應文件

- 路由與 shell：[01_ROUTING_AND_APP_SHELL_REVIEW.md](./01_ROUTING_AND_APP_SHELL_REVIEW.md)
- Finance：[02_FINANCE_DUEL_REVIEW.md](./02_FINANCE_DUEL_REVIEW.md)
- Nakama service：[03_NAKAMA_SERVICE_REVIEW.md](./03_NAKAMA_SERVICE_REVIEW.md)
- Dashboard/community/chat：[04_DASHBOARD_COMMUNITY_CHAT_REVIEW.md](./04_DASHBOARD_COMMUNITY_CHAT_REVIEW.md)
- UI/RWD：[05_SHARED_UI_AND_STYLING_REVIEW.md](./05_SHARED_UI_AND_STYLING_REVIEW.md)
- 設定與測試：[06_SCRIPTS_CONFIG_AND_TEST_REVIEW.md](./06_SCRIPTS_CONFIG_AND_TEST_REVIEW.md)
