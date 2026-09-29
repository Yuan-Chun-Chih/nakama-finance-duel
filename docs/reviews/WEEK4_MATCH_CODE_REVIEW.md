# Week 4 Match Code Review Guide

本文件聚焦 Week 4 對 match 功能的實作：把原本只有數值或前端本地推算的功能，改成由 Nakama Go runtime 驗證、計算，並實際保存到 PostgreSQL 的 Nakama `storage` 表。

---

## 1. Review 重點

- [ROUND_DURATION_SECONDS](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:67)：每 10 秒一輪的前端回合長度設定。
- [handleSendTestAction()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:632)：建立結構化 order，正式 community match 會先進 `submit_match_order` RPC。
- [runtime portfolio 套用位置](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:679)：用 runtime 回傳的 portfolio 更新 `My cash / My P&L`。
- [handleSubmitResult()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:749)：送出結算請求，runtime 讀取 DB orders 後重算 settlement。
- [Runtime settlement panel](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1117)：顯示 score、fills、winners、participant portfolio 與 order status。
- [rpcSubmitMatchOrderHandler()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1511)：後端驗證 order、保存 order、即時計算並保存該玩家 portfolio。
- [rpcSubmitMatchResultHandler()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1644)：後端結算全場結果，保存 result、fills、participants portfolio。
- [rpcIngestMatchCandlesHandler()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1644)：ccxt 腳本寫入 BTC candles 的 runtime RPC。
- [rpcCancelMatchOrderHandler()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1610)：取消 open order，寫入 `match_order_book`。

---

## 2. Frontend Match Panel

### 2.1 回合與計時

- [handleStartRound()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:511)：host 在 all ready 後開始回合。
- [handleStopTimer()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:569)：host 停止 timer，送出 `match_end` 類型的 relayed event。
- [buildRoundPayload()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1350)：建立 round start payload，包含 `roundStartedAt` 與 `durationSeconds`。
- [getRoundRemainingSeconds()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1414)：用 `roundStartedAt + durationSeconds` 在前端顯示剩餘秒數。

### 2.2 Portfolio Sync

- [handleSyncPortfolio()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:584)：手動同步目前 cash / P&L 給對手，用於 relayed UI 狀態顯示。
- [buildPortfolioPayload()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1366)：建立 portfolio sync payload。
- [applyPortfolioPayload()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1398)：收到對手 portfolio sync 後，更新對手 cash / P&L 顯示。

### 2.3 Order Submission

- [handleSendTestAction()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:632)：建立 `MatchOrderPayload`，送到 runtime，並把 runtime 回傳的 portfolio 套回 UI。
- [MatchOrderPayload 建立位置](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:643)：包含 `id / userId / symbol / side / quantity / limitPrice / round / createdAt`。
- [submitRelayedMatchOrder() 呼叫位置](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:654)：正式 community match 的 order 入口，會傳 `initialCash` 給 runtime。
- [trade action broadcast](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:665)：order 被 runtime 接受後，才透過 relayed match broadcast 給對手。
- [runtime portfolio 套用位置](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:679)：用後端回傳的 `cash / pnl / score` 更新 UI，不再使用前端本地撮合。

### 2.4 Result Settlement

- [handleSubmitResult()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:749)：呼叫 `submit_match_result`，讓 runtime 讀 DB orders 並重算結果。
- [submitRelayedMatchResult() 呼叫位置](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:764)：送出 participants、ready users、event hash、initial cash。
- [Runtime settlement panel](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1117)：顯示 runtime 回傳的 score、fills、winner、participant cash / NAV / P&L。
- [Order status 顯示](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1137)：顯示 filled / partial / rejected / expired、fee、tax、slippage、reason。
- [Cancel order UI](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1091)：輸入 order id 後呼叫 runtime cancel RPC。
- [reduceClientMatchState()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1264)：把 round start、portfolio sync、trade action、match end reduce 成前端顯示狀態。

---

## 3. Frontend Service 與 Types

- [submitMatchOrderRpcId](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/client.ts:64)：`.env.local` 可覆寫的 `submit_match_order` RPC id。
- [submitRelayedMatchOrder()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:128)：呼叫 runtime order RPC，回傳 `order` 與 `portfolio`。
- [cancelRelayedMatchOrder()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:146)：呼叫 runtime cancel RPC，標記 order book record 為 canceled。
- [submitRelayedMatchResult()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:146)：呼叫 runtime result RPC，回傳 authoritative settlement。
- [MatchOrderPayload](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:332)：結構化 order 型別。
- [MatchOrderSubmissionView](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:353)：order RPC 回傳型別，包含被接受的 order 與後端 portfolio。
- [MatchSettlementView.orders](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:377)：result settlement 的 order 狀態列表。
- [MatchOrderBookView](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:359)：取消掛單與 order book 狀態的前端型別。

---

## 4. Go Runtime

### 4.1 Storage Collections

- [collectionMatchPriceFeed](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:62)：server-side price feed storage。
- [collectionMatchCandles](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:63)：每輪 OHLCV candle storage。
- [collectionMatchOrders](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:64)：保存每筆 runtime 驗證過的 order。
- [collectionMatchOrderBook](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:65)：保存 open / filled / partial / rejected / expired / canceled 狀態。
- [collectionMatchPortfolios](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:66)：保存每位玩家最新 portfolio。
- [collectionMatchFills](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:67)：保存 settlement 產生的成交紀錄。
- [collectionMatchResults](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:68)：保存最終 match result 與 settlement。

### 4.2 Trading Rules

- [matchFeeBps](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:74)：成交手續費，單位 bps。
- [matchTaxBps](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:75)：賣出交易稅，單位 bps。
- [matchSlippageBps](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:76)：買賣滑價，單位 bps。
- [matchMaxPosition](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:77)：單一 symbol 最大持倉。
- [matchMaxTradesPerUser](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:78)：每位玩家每場最大成交次數。
- [matchOrderExpiryRounds](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:79)：order 超過幾輪後視為 expired。

### 4.3 Price Feed

- [seedDefaultMatchPriceFeed()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1946)：Nakama 啟動時補齊預設 price feed，不覆寫已存在價格。
- [readMatchPriceFeed()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1979)：order / settlement 從 `match_price_feed` 讀價格。
- [readMatchCandles()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2320)：讀取 `match_price_candles`，供 order round 對應 candle。
- [defaultMatchPrices()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2015)：當 storage 沒有資料時的 fallback seed price。
- [scripts/ingest-btc-candles.mjs](c:/Users/kdsam/Documents/nakamafrontend/scripts/ingest-btc-candles.mjs:1)：使用 ccxt 抓 BTC/USDT candles 並呼叫 `ingest_match_candles`。

### 4.4 Order 驗證、撮合與保存

- [rpcSubmitMatchOrderHandler()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1511)：驗證登入、community membership、lobby kind、order payload。
- [normalizeMatchOrder()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1905)：驗證 symbol、side、quantity、limitPrice、round，並做正規化。
- [match_orders 寫入位置](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1572)：把驗證後的 order 寫進 Nakama storage。
- [order 後 portfolio settlement](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1594)：讀取該玩家 server-side orders，重算目前 portfolio。
- [writeMatchPortfolio()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2285)：把玩家最新 portfolio 寫入 `match_portfolios`。

### 4.5 Settlement Engine

- [settleMatchOrders()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1730)：依 orders 計算 fills、order statuses、cash、positions、NAV、P&L、score、winner。
- [order expiry 判斷](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1779)：超過 `matchOrderExpiryRounds` 會標記為 expired。
- [trade limit 判斷](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1785)：超過 `matchMaxTradesPerUser` 會 rejected。
- [position limit 判斷](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1800)：買進不能超過單一 symbol 最大持倉。
- [partial fill by cash](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1807)：現金不足時依可負擔數量 partial fill。
- [sell partial fill](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1829)：持倉不足時依可賣數量 partial fill。
- [open order 判斷](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1793)：limit 尚未被 candle low/high 觸發時保持 open。
- [canceled order 判斷](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1779)：被取消的 order 不再成交。
- [fee / tax 計算](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1814)：買賣收 fee，賣出額外收 tax。
- [applyMatchSlippage()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2033)：買進提高 execution price，賣出降低 execution price。
- [affordableBuyQuantity()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2045)：依現金與 fee 計算可買數量。
- [calculateBpsCeil()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2063)：bps 費用向上取整。

### 4.6 Result 保存

- [rpcSubmitMatchResultHandler()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1644)：驗證 participants、ready users、event hash，觸發 authoritative settlement。
- [listMatchOrdersForMatch()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2230)：從 `match_orders` storage 讀取全場 server-side orders。
- [match_results 寫入位置](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1699)：保存最終 result。
- [writeMatchSettlementStorage()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2256)：結算後保存所有 participant portfolios 與 fills。
- [writeMatchOrderBookRecords()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2285)：保存 order book 狀態。
- [buildMatchPortfolioKey()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2360)：產生 `match_portfolios` storage key。
- [buildMatchFillKey()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2364)：產生 `match_fills` storage key。

---

## 5. Smoke Test

- [order RPC call](c:/Users/kdsam/Documents/nakamafrontend/scripts/relayed-match-smoke.mjs:136)：實際呼叫 `submit_match_order`。
- [submittedPortfolio assertions](c:/Users/kdsam/Documents/nakamafrontend/scripts/relayed-match-smoke.mjs:152)：驗證 runtime 回傳 cash、pnl、positions。
- [settlement order status assertion](c:/Users/kdsam/Documents/nakamafrontend/scripts/relayed-match-smoke.mjs:203)：驗證 settlement 回傳 order status。
- [winner assertion](c:/Users/kdsam/Documents/nakamafrontend/scripts/relayed-match-smoke.mjs:204)：驗證 fee / slippage 影響勝負。

執行：

```powershell
cmd /c npm run test:relayed-match
cmd /c npm run price-feed:btc
```

確認 DB storage：

```powershell
cd C:\Users\kdsam\Documents\nakamafrontend\nakama
docker compose exec -T postgres psql -U postgres -d nakama -c "select collection, count(*) from storage where collection in ('match_price_feed','match_price_candles','match_orders','match_order_book','match_portfolios','match_fills','match_results') group by collection order by collection;"
```

---

## 6. Review Checklist

- `submit_match_order` 是正式 community match 的唯一 order 入口。
- 前端不再用本地價格表計算 cash / P&L。
- price 由 `match_price_feed` storage 提供。
- candles 由 `match_price_candles` storage 提供。
- BTC/USDT candles 可用 `npm run price-feed:btc` 透過 ccxt 匯入。
- order 被 runtime 接受後才 broadcast trade action。
- open order 可用 `cancel_match_order` 取消。
- order RPC 回傳的 portfolio 會更新 `My cash / My P&L`。
- settlement 會產出 open / filled / partial / rejected / expired / canceled order status。
- settlement 會計算 fee、tax、slippage。
- `submit_match_result` 不信任前端 score，會讀 `match_orders` 重算 settlement。
- `match_portfolios` 會保存每位玩家最新 portfolio。
- `match_fills` 會保存結算成交紀錄。
- `match_results` 會保存最終 score、winner、settlement。

## 7. Market Intelligence 新增程式碼索引

- [listMatchCandlesRpcId](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/client.ts:67)：前端 runtime context 新增 `list_match_candles` RPC id。
- [NEXT_PUBLIC_NAKAMA_LIST_MATCH_CANDLES_RPC_ID](c:/Users/kdsam/Documents/nakamafrontend/.env.example:29)：提供 `.env.local` 可覆寫的 candle 查詢 RPC 設定。
- [listMatchCandles()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:165)：前端呼叫 Go runtime，讀取後端 `match_price_candles`。
- [rpcListMatchCandlesHandler()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1794)：後端從 Nakama storage 讀取指定 symbol 的 candles 並回傳最近 N 筆。
- [marketIndicators](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:175)：用後端 candles 計算交易指標。
- [reloadMarketData()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:418)：依目前 symbol 從後端重新載入 candles。
- [Market intelligence UI](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1073)：顯示最新價、趨勢、SMA、RSI、MACD 與圖表。
- [buildMarketIndicators()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1353)：計算 latest price、change、SMA 5/20、RSI 14、MACD 與 trend。
- [MarketMiniChart()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1385)：用 SVG 顯示 Close、SMA 5、SMA 20、Trend 線。
- [calculateRsi()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1448)：計算 RSI 14。
- [calculateMacd()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1469)：計算 MACD 12/26 與 signal 9。

Review 重點：

- 指標只用於輔助交易判斷，不是結算真相來源。
- Candle 必須來自 Go runtime / Nakama storage，不應回退到前端固定價格表。
- 下單、成交、portfolio、NAV、P&L、winner 仍必須由 Go runtime 計算。
