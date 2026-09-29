# Finance 對局 Top-down Code Review

主要檔案：[components/finance-duel-match-panel.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/finance-duel-match-panel.tsx)

## 1. 元件入口與 authoritative 邊界

- `FinanceDuelMatchPanel({ snapshot, disabled, onDuelPresentationChange })`：finance feature 的最上層 client component。
- `snapshot`：由 dashboard bootstrap 提供 profile id 等 context，不是交易真相。
- `disabled`：arena shell 尚未完成載入或有錯誤時，禁止使用者開始配對。
- `onDuelPresentationChange`：通知 shell 隱藏或顯示 workspace title。
- `EMPTY_STATE`：前端初始空 state；不可把其中預設值當成後端比賽結果。
- `session`：目前 Nakama match session，包含 match id、self、presences。
- `game`：server authoritative finance snapshot；棋盤、portfolio、round、price、stale、winner 都從這裡來。
- `events`：前端保留最近稽核事件，供 Live Server Events 顯示，不取代 snapshot。
- `side`、`quantity`：使用者尚未送出的 order intent。
- `pendingOperation`：目前正在執行的 operation，區分 matchmaking、ready、order、resign、leave 等。
- `error` 與 `backgroundNotice`：分開顯示前景操作失敗與背景恢復失敗。
- `candles`、`history`：從後端 RPC 取得的行情與歷史 projection。

## 2. 初始與恢復 effects

- `restoreLiveSession()`：先恢復瀏覽器中的 Nakama session，避免未登入時立即呼叫 matchmaking/history RPC。
- `matchmakerTicket` + `searchStartedAt`：開始等待計時；計時只影響 UI 顯示，不影響後端配對期限。
- `immersiveDuel`：當 game status 是 `countdown` 或 `running` 時通知 arena shell。
- `listMatchCandles()` effect：由 authoritative `priceUpdatedAt` 觸發，避免另開前端價格計時器。
- `subscribeToRealtimeMatchmaker()`：只接受與目前 ticket 相同的配對通知，避免舊 ticket 汙染新狀態。
- `updateFinanceMatchmaking("status")`：刷新後向後端查詢 searching、matching、matched 或 running projection。
- `restoreRealtimeMatchResume()`：只有後端查詢沒有活躍 match 時才作為本地 resume fallback。

## 3. WebSocket snapshot 與事件

- `subscribeToRealtimeMatchData(activeMatchId, listener)`：註冊 match data listener。
- `FINANCE_MATCH_OP_CODES.state`：收到 state 時，先確認 payload 是合法 finance state。
- `stateVersion ?? serverTick`：用 server 版本判斷新舊；`latestStateVersion` 防止延遲封包倒退畫面。
- `setClockNow(Date.now())`：收到 authoritative snapshot 時校正前端顯示的 price age 與等待時間。
- `setGame(event.payload)`：把 server snapshot 設成唯一畫面狀態來源。
- `FINANCE_MATCH_OP_CODES.event`：事件只更新稽核列表與觸發 history refresh。
- `historyRefreshTimer`：多筆 order event 合併後再呼叫 history RPC，避免每筆 event 造成完整重抓。
- `subscribeToRealtimeMatchPresence()`：只更新連線 presence，不重建 data listener；listener 依 `activeMatchId` 而非整個 session object 綁定。
- `stateRequest`：加入 match 後要求最新 directed snapshot，支援刷新與重連。

## 4. 斷線與重連

子元件：[finance-duel/use-finance-match-reconnect.ts](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/finance-duel/use-finance-match-reconnect.ts)

- `useFinanceMatchReconnect({ matchId, connected, onReconnected })`：將 transport recovery 從主 panel 抽離。
- `inFlight`：避免同一時間建立多個 `joinRealtimeMatch()`。
- `currentAttempt`：計算目前重連次數。
- `MAX_RECONNECT_DELAY_MS`：退避上限，避免斷線時高頻打 Nakama。
- `1_000 * 2 ** ...`：以指數退避計算下一次嘗試時間。
- `Math.random() * 350`：加入少量 jitter，避免大量 client 同時重連。
- `onReconnected`：成功後重設 state version、更新 session 並讓主 panel 重新要求 snapshot。
- `retryNow`：提供 UI 手動重試入口。

## 5. Matchmaking 與確認

- `findOpponent()`：呼叫 `updateFinanceMatchmaking("begin")` 取得後端 queue projection，再呼叫 `startFinanceMatchmaking(queueToken)`。
- `cancelSearch()`：取消 native matchmaker ticket，再將後端 projection 更新為 cooldown。
- `MatchConfirmationDialog`：配對成功後顯示雙方確認狀態與 server countdown。
- `toggleReady()`：只送 `ready` intent；誰已確認、是否開始都由 snapshot 決定。
- `cancelMatchedGame()`：送 match cancel intent，再離開 socket；server 會決定對手是否回 queue。
- `GameStartCountdownDialog`：只顯示 server 給的 countdown，不在瀏覽器自行倒數決定開局。

## 6. 交易操作

子元件：[finance-duel/finance-trade-ticket.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/finance-duel/finance-trade-ticket.tsx)

- `FinanceTradeTicket`：只接收已由父層計算的可用資金、最大數量、price age 與提示。
- `side`：買或賣 intent。
- `quantity`：輸入欄位暫存值；slider、數字輸入與 25/50/75/100% 按鈕共用同一 state。
- `effectiveQuantity`：父層依 portfolio/open orders 計算後的實際預覽數量。
- `onSubmit()`：回到父層送出 server order intent。
- `clientOrderId`：父層送出的 idempotency key，後端用於避免重複訂單。
- `marketStale`：後端標記 stale 時，交易按鈕顯示原因並停止送單。
- 手機 bottom sheet：有遮罩、Escape 關閉、safe-area padding、body scroll lock 與固定 CTA。

## 7. 對局結束與歷史

- `resignMatch()`：只送 resign intent，不能由前端指定 winner。
- `leaveMatch()`：離開 socket 並清除本地 resume metadata。
- `ActionConfirmDialog`：投降與離場都需要明確確認，避免手機誤觸。
- `listFinanceHistory()` effect：依 match id、arena id 或 debounce revision 讀後端 projection。
- `loadMoreHistory()`：使用後端 cursor，並依 `arenaId` 去重。
- `FinanceRecordPanel`：顯示 rating、W/L/D 與歷史摘要。
- `ExchangeHistoryPanel`：顯示 orders、fills、portfolio snapshots。
- `LiveServerEvents`：顯示 append-only event view，不自行修改勝負。

## 8. 純 view helper

- `buildIndicators()`：由後端 candles 衍生 SMA、EMA、RSI、MACD、volatility、trend，只供行情 UI。
- `buildPortfolioPerformance()`：由 snapshots 建立 NAV、realized/unrealized P&L 曲線與最大回撤。
- `toMicros()` / `fromMicros()`：前端顯示與 payload 之間轉換 BTC micros；送出前仍須由後端重新驗證。
- `isFinanceState()` / `isFinanceEventEnvelope()`：runtime payload 的最小型別守門。
- `describeError()`：將未知錯誤轉成 UI 可讀訊息。

## 9. Review 結論

目前 finance UI 已將 socket recovery、dialog 與交易票券拆出，但主 panel 仍整合 matchmaking、market、history、portfolio 與 event view。下一步可再拆成 `useFinanceMatchState`、`useFinanceHistory`、`MarketPanel` 與 `FinanceRecordPanel` feature files，降低單檔變更風險。
