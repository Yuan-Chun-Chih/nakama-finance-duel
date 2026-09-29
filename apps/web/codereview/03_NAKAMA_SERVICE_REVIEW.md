# Nakama 前端 Service Top-down Code Review

## 1. Service facade

檔案：[lib/nakama/service.ts](/C:/Users/kdsam/Documents/nakama-duel/apps/web/lib/nakama/service.ts)

- `export * from "./types"`：對外提供前端 view model 與 payload 型別。
- `export * from "./dashboard"`：對外提供 auth、community、guild、friend、leaderboard API。
- `export * from "./chat"`：對外提供 chat socket 與 unread API。
- `export * from "./match"`：對外提供 match、finance、resume、presence API。

component 只應從 `@/lib/nakama/service` 取得整合功能；這樣 component 不需要知道檔案拆分與 Nakama SDK 細節。

## 2. client.ts：身份與 runtime context

檔案：[lib/nakama/client.ts](/C:/Users/kdsam/Documents/nakama-duel/apps/web/lib/nakama/client.ts)

- `getNakamaClient()`：建立或取得 Nakama JS client；host、port、server key、SSL 來自 env。
- `getRuntimeContext()`：集中解析 RPC id 與 runtime 設定，避免元件硬編 RPC 名稱。
- `restoreLiveSession()`：從 safe storage 取 session，再檢查 token 是否可使用。
- `requireLiveSession()`：沒有有效 session 時拒絕需要登入的操作。
- `persistLiveSession()`：把 Nakama session metadata 保存到 browser storage。
- `clearLiveSession()`：登出時清除 local session。
- `validateAuthPayload()`：檢查 email、password、username 等 auth 欄位。
- `parseRpcPayload<T>()`：把 RPC response JSON 解成指定型別；型別只是前端編譯保護，不能取代 backend validation。
- `toLiveModeError()`：將 Nakama error 轉成可辨識的前端錯誤。
- `emptySnapshot()`：提供尚未登入或資料不存在時的 dashboard 空 view model。
- `safeStorageGet/Set/Remove()`：封裝 localStorage 例外，避免 privacy mode 或 SSR 造成頁面崩潰。
- `cryptoFallbackId()`：在瀏覽器 crypto 不可用時產生 fallback id；不能拿來當安全身份。
- `extractErrorMessage()`：從 unknown error 取得可讀訊息。

## 3. dashboard.ts：HTTP RPC workflow

檔案：[lib/nakama/dashboard.ts](/C:/Users/kdsam/Documents/nakama-duel/apps/web/lib/nakama/dashboard.ts)

- `bootstrapPhaseOne()`：登入後載入 dashboard 基礎資料，供首頁和 arena shell 使用。
- `registerWithEmail()` / `loginWithEmail()`：auth RPC wrapper，成功後保存 session 並重新載入 snapshot。
- `logoutFromRuntime()`：呼叫 backend logout，再清理前端 session。
- `sendFriendInvite()`、`acceptFriend()`、`rejectFriend()`、`removeFriend()`：好友意圖的 HTTP RPC wrapper。
- `searchUsersForFriendInvite()`：查找可邀請使用者，不把搜尋結果當成 membership 真相。
- `createCommunity()`、`joinCommunity()`、`leaveGroup()`：社群建立與 membership 操作。
- `requestGuildJoin()`、`approveGuildJoin()`、`rejectGuildJoin()`：公會申請 workflow。
- `promoteCommunityMember()`、`demoteCommunityMember()`、`transferCommunityOwnership()`：治理意圖，權限由 backend 再驗證。
- `fetchGuildDetail()`、`fetchCommunityDetail()`：detail page 的 read RPC。
- `submitPortfolioScore()`：向 leaderboard 提交 score；前端的 score input 不是 authoritative finance result。
- `loadLiveDashboard()`：把多個 Nakama API response 組合成 DashboardSnapshot。
- `mapLiveFriend()`、`mapLiveCommunity()`、`mapLeaderboardRecords()`：SDK model 到前端 view model 的轉換層。
- `mergeSubmittedLeaderboardRecords()`：將本次送出的 leaderboard response 與現有列表合併。
- `isGuildAlreadyLeftError()`：把可忽略的重複離開錯誤收斂成 UI 可接受結果。

## 4. match.ts：match、finance 與 socket

檔案：[lib/nakama/match.ts](/C:/Users/kdsam/Documents/nakama-duel/apps/web/lib/nakama/match.ts)

### 4.1 合約常數

- `RELAYED_MATCH_OP_CODES`：舊 relayed match opcodes。
- `FINANCE_MATCH_OP_CODES`：finance authoritative state、event、ready、order、cancel、resign、state request 的 socket opcode。
- `createFinanceMatch()`：呼叫 create finance match RPC 後加入 match。
- `listFinanceHistory()`：呼叫 history RPC，取得 stats、games、orders、fills、snapshots 與 cursor。
- `listMatchCandles()`：呼叫 candles RPC，前端不直接連交易所。

### 4.2 Socket 操作

- `joinRelayedMatch()`：以 match id 加入 Nakama socket，並正規化 session。
- `leaveRelayedMatch()`：離開 socket match，清理 client side cache。
- `sendRelayedMatchState()`：將 payload encode 後送到指定 match。
- `sendRelayedMatchStateToPresenceIds()`：只送給特定 session/presence。
- `sendRelayedReadyState()`、`sendRelayedInitialStateRequest()`：舊流程的 ready/state request wrapper。
- `addRelayedMatchmaker()`：加入 native matchmaker。
- `updateFinanceMatchmaking()`：呼叫後端 matchmaking HTTP RPC，處理 begin/cancel/status projection。
- `startFinanceMatchmaking()`：用後端 queue token 建立 native matchmaker ticket。
- `removeRelayedMatchmaker()`：取消 ticket。

### 4.3 Listener registry

- `subscribeToRelayedMatchData()`：註冊依 match id 的 data listener，回傳 unsubscribe function。
- `subscribeToRelayedMatchPresence()`：註冊 presence listener。
- `subscribeToRelayedMatchmaker()`：註冊 matchmaker matched listener。
- `subscribeToRealtimeConnection()`：監聽 socket open/close，供 reconnect hook 使用。
- `subscribeToMatchExchangeNotifications()`：接收 exchange notification。

### 4.4 Resume 與 cache

- `persistRelayedMatchResume()`：保存 match id、game type、savedAt。
- `restoreRelayedMatchResume()`：讀取 refresh 後的 resume metadata。
- `clearRelayedMatchResume()`：離場或完成對局後清除 resume。
- `clearRelayedMatchLocalState()`：清除指定 match 的 sequence/cache。

### 4.5 Normalize 與送出防護

- `ensureRelayedMatchSocket()`：建立或重用 Nakama WebSocket。
- `cacheAndNormalizeMatch()`：將 SDK match 轉成前端 session view。
- `normalizeMatchPresenceEvent()`：標準化 presence 加入/離開事件。
- `normalizeMatchData()`：把 binary match data 轉成 `RelayedMatchEvent`。
- `decodeMatchData()`：解碼 Uint8Array payload。
- `parseMatchPayload()`：解析 JSON payload。
- `encodeRelayedMatchPayload()`：把 match id 與 payload 組成送出格式。
- `nextMatchSequence()`：取得本地送出序號，協助排序與去重。
- `guardRelayedMatchSend()`：檢查 socket、match cache 與 send throttle。

### 4.6 中性 alias

`joinRealtimeMatch`、`sendRealtimeMatchData`、`subscribeToRealtimeMatchData` 等 alias 讓 finance 使用中性命名；目前仍由 `joinRelayedMatch` 等舊實作提供。長期應先把所有 caller 遷移完成，再刪除 deprecated alias。

## 5. types.ts：資料合約

檔案：[lib/nakama/types.ts](/C:/Users/kdsam/Documents/nakama-duel/apps/web/lib/nakama/types.ts)

- `RuntimeContext`：RPC ids 與 runtime 設定。
- `DashboardSnapshot`：首頁與 arena shell 的總覽 view model。
- `ChatSession`、`ChatPage`、`ChatMessageView`：chat view model。
- `RelayedMatchSession`、`RelayedMatchPayload`、`RelayedMatchEvent`：socket match 基礎合約。
- `FinanceMatchStateView`：finance snapshot，包含 round、price、portfolios、stale、winner、opponentLeadStatus。
- `FinanceMatchmakingView`：後端配對 projection，包含 status、queueToken、matchId、cooldown。
- `FinanceMatchEventView`：append-only finance event view。
- `FinanceOrderView`、`FinanceFillView`、`FinancePortfolioSnapshotView`：歷史交易資料。
- `FinancePlayerStatsView`、`FinanceGameView`、`FinanceHistoryPage`：rating、戰績、完成對局與 cursor page。
- `FinanceSystemMetricsView`：管理員 metrics view，不應無條件暴露給一般玩家。

## 6. Review 結論

前端 service 已有清楚的 facade 與 model layer。最大維護問題是 `match.ts` 同時包含舊 relayed、finance、socket registry、resume 與 normalize；後續可拆成 `match-socket.ts`、`match-resume.ts`、`finance-api.ts`、`matchmaker-api.ts`，但必須先維持既有 export contract。
