# Week 4 開發紀錄：Match 後端交易引擎

本文件整理 Week 4 的 Nakama match 原型階段進度。這一週的主軸應該是 relayed match、round/timer/ready/state sync 與交易資料模型鋪底；至於即時價格串接、正式買賣撮合、後端 settlement 保存，以及 `Authoritative=true` 的演進，已改歸入 Week 5。

---

## 1. 範圍修正註記

Week 4 應主要描述以下階段：

- relayed / match 功能從聊天式事件傳輸，進入可承載交易對戰的原型。
- timer、round、ready、基本 state sync 與對戰資料結構建立。
- 初步的 order / portfolio / settlement 設計方向與 runtime 資料模型鋪底。

以下若出現即時價格串接、正式買賣撮合、後端結算保存、Authoritative=true 等內容，應視為 Week 5 延伸成果。

## 2. 本週主要開發

### 1.1 每 10 秒一輪與前端狀態同步

- host 可在雙方 ready 後開始遊戲。
- 前端以 `roundStartedAt + durationSeconds` 顯示倒數。
- 新增 stop timer / end settlement 操作入口。
- 新增 portfolio sync relayed event，用於讓對手看到目前 cash / P&L。
- `portfolio sync` 仍只負責 UI 即時顯示，最終結果以 runtime settlement 為準。

### 1.2 Server-side Price Feed 與 ccxt BTC candles

新增 `match_price_feed` storage collection：

- Nakama 啟動時由 `seedDefaultMatchPriceFeed()` 補齊預設價格。
- 如果 DB 已有某個 symbol 的價格，不會被 seed 覆寫。
- `submit_match_order` 與 `submit_match_result` 都從 `match_price_feed` 讀最新價格。
- 新增 `match_price_candles` storage，保存每輪 OHLCV candle。
- 新增 `ingest_match_candles` RPC，用 secret 保護 candle ingestion。
- 新增 `scripts/ingest-btc-candles.mjs`，透過 `ccxt` 抓 Binance `BTC/USDT` 1m OHLCV 後寫入 Nakama runtime。
- storage 沒有資料時才 fallback 到 default seed price。

目前預設 symbol：

```text
TPE:2330
TPE:2317
TPE:2454
NASDAQ:AAPL
NASDAQ:NVDA
```

相關檔案：

- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:62)
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1644)
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1946)
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1979)
- [scripts/ingest-btc-candles.mjs](c:/Users/kdsam/Documents/nakamafrontend/scripts/ingest-btc-candles.mjs:1)

### 1.3 結構化 Order

原本 `limit-order: buy 10 shares` 只是字串，本週改成結構化 order：

```text
id
userId
symbol
side: buy | sell
quantity
limitPrice
round
createdAt
```

正式 community match 的 order 會先送到 `submit_match_order` RPC，runtime 驗證成功後才 broadcast 給 match 內玩家。

相關檔案：

- [components/realtime-match-panel.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:632)
- [lib/nakama/match.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:128)
- [lib/nakama/types.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:332)

### 1.4 後端 Order 驗證、撮合與保存

Go runtime 的 `submit_match_order` 現在會：

- 驗證使用者已登入。
- 驗證使用者屬於該 community。
- 驗證 lobby 存在且 kind 一致。
- 驗證 order symbol、side、quantity、limit price、round。
- 從 `match_price_feed` 讀取價格。
- 將驗證後的 order 寫入 `match_orders` storage。
- 讀取該玩家在該 match 的 server-side orders，重新計算 portfolio。
- 將最新 portfolio 寫入 `match_portfolios` storage。
- 回傳 runtime 計算出的 portfolio 給前端 UI。

相關檔案：

- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1511)
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1594)
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2285)

### 1.5 Order Book 與撮合規則

目前 settlement engine 支援：

- `filled`：完整成交。
- `partial`：因 cash、position 或 position limit 只能部分成交。
- `rejected`：因 limit price、現金、持倉、交易次數限制等原因拒絕。
- `expired`：order 超過 `matchOrderExpiryRounds` 後過期。
- `open`：limit order 尚未被 candle high/low 觸發，會保留在 `match_order_book`。
- `canceled`：玩家可用 `cancel_match_order` 取消自己的掛單。
- 每筆 order book record 會保存 requested / filled / remaining quantity。
- Limit order 會依 order round 對應的 candle high/low 判斷是否觸價。
- 買進滑價：execution price 高於 price feed。
- 賣出滑價：execution price 低於 price feed。
- 買賣手續費 fee。
- 賣出交易稅 tax。
- 單一 symbol position limit。
- 每位玩家每場 trade count limit。

相關檔案：

- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1730)
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1610)
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1779)
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1785)
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1800)
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2033)

### 1.6 後端 Settlement 與成交保存

Go runtime 的 `submit_match_result` 現在會：

- 驗證 participants / ready users / event hash。
- 從 `match_orders` storage 讀取所有 server-side orders。
- 用 `match_price_feed` 的價格計算 fills、order statuses、cash、positions、NAV、P&L、score、winner。
- 保存最終 result 到 `match_results`。
- 保存每位 participant 最新 portfolio 到 `match_portfolios`。
- 保存成交紀錄到 `match_fills`。

相關檔案：

- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1644)
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1730)
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2256)

### 1.7 前端移除本地計算

前端不再用本地價格表自行投影 cash / P&L。送出 order 後：

- 前端呼叫 `submit_match_order`。
- runtime 回傳 accepted order 與 portfolio。
- UI 使用 runtime portfolio 更新 `My cash`、`My P&L`、result score。
- relayed match 只負責把已接受 order 與 portfolio state 轉送給其他玩家。
- Settlement panel 顯示 filled / partial / rejected / expired、fee、tax、slippage、reason。

相關檔案：

- [components/realtime-match-panel.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:654)
- [components/realtime-match-panel.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:679)
- [components/realtime-match-panel.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1137)

---

## 3. Storage Collections

`match_price_feed`

- 保存 server-side match price feed。
- runtime 啟動時會補預設價格，但不覆寫已存在價格。

`match_orders`

- 保存 runtime 驗證過的 order。
- key 使用 community id、match id hash、order id hash 組成。

`match_portfolios`

- 保存每位玩家在 match 中的最新 portfolio。
- order submit 後會更新該玩家 portfolio。
- result settlement 後會更新所有 participants portfolio。

`match_fills`

- 保存 runtime settlement 產生的成交紀錄。
- 包含 quantity、execution price、notional、fee、tax、slippage。

`match_results`

- 保存最終 result、score、summary、participants、ready users、event hash、settlement。
- 前端送來的 score 不是真相，runtime 會用 server-side orders 重算 score。

`match_price_candles`

- 保存 ccxt ingestion 寫入的 BTC/USDT OHLCV candles。
- Settlement 會用 order round 對應 candle 判斷 limit 是否觸發。

`match_order_book`

- 保存 open、filled、partial、rejected、expired、canceled order 狀態。
- 用於跨 round 掛單、取消與到期。

---

## 3. 驗證紀錄

本次已執行：

```powershell
cmd /c npx tsc --noEmit
cmd /c npm run lint
docker compose build nakama
docker compose up -d nakama
cmd /c npm run price-feed:btc
cmd /c npm run test:relayed-match
```

結果：

- TypeScript compile 通過。
- ESLint 通過。
- Nakama Go plugin build 通過。
- `price-feed:btc` 已透過 ccxt 寫入 60 根 BTC/USDT candles。
- relayed match smoke test 通過。
- smoke test 已驗證 `submit_match_order` 回傳 runtime portfolio。
- smoke test 已驗證 fee / slippage 會影響 P&L 與 winner。
- smoke test 已驗證 settlement 回傳 order status。

DB 驗證：

```sql
select collection, count(*)
from storage
where collection in ('match_price_feed','match_orders','match_portfolios','match_fills','match_results')
group by collection
order by collection;
```

本機測試已看到：

```text
match_fills
match_order_book
match_orders
match_portfolios
match_price_candles
match_price_feed
match_results
```

---

## 5. 目前限制

- 這仍是 relayed match，不是 Nakama authoritative match loop；即時資料轉送仍由 client 發送。
- Price feed 已改成 server-side storage，並可透過 ccxt ingestion 寫入 BTC/USDT candles。
- 目前 order book 是 storage-backed v1，尚未支援真正買賣雙方撮合，只是用 candle high/low 判斷 limit 是否觸價。
- 已支援 partial / rejected / expired / open / canceled，並保存 order book 狀態。
- 尚未實作 average cost、realized / unrealized P&L 分拆。
- 尚未實作 result idempotency 與 anti replay。

---

## 5. 下一步建議

1. 將 ccxt ingestion 變成排程服務。
   - 目前是手動 `npm run price-feed:btc`。
   - 下一步可用 cron / worker / Docker service 固定寫入 candles。

2. 補真正 order book matching。
   - 目前是 candle trigger execution。
   - 下一步可撮合玩家買賣單，支援 bid/ask、maker/taker、partial fill queue priority。

3. 完整 accounting。
   - average cost。
   - realized / unrealized P&L。
   - fees / tax 分項報表。
   - position exposure 與風控指標。

4. 防作弊與冪等。
   - result idempotency key。
   - round id / match nonce。
   - submit result 防 replay。
   - order event hash 由 server-side orders 重建。

5. 補 e2e。
   - 兩帳號 create lobby -> join -> ready -> start -> buy/sell -> partial/rejected case -> end & settle。
   - 驗證 DB 中 `match_price_feed / match_orders / match_portfolios / match_fills / match_results` 都有資料。

---

## 6. 目前狀態總結

截至本文件更新，match 功能已從「relayed realtime demo」推進到「relayed UI + Go runtime trading engine v1」：

- 前端可建立 / 加入 match、ready、start、每 10 秒一輪、送出 order、同步 portfolio、結算。
- Go runtime 從 server-side price feed / candles 讀價格。
- Go runtime 驗證並保存 order。
- Go runtime 支援 open / partial / rejected / expired / canceled。
- Go runtime 計算 fee、tax、slippage、portfolio。
- Go runtime 根據 DB orders 產生 fills、NAV、P&L、score、winner。
- 最終結果保存到 `match_results`，成交保存到 `match_fills`，portfolio 保存到 `match_portfolios`。

## 補充：Market Intelligence

新增 match 交易資訊面板，讓玩家可以在送出 order 前讀取後端 candle feed 並查看交易指標。

- Go runtime 新增 `list_match_candles` RPC，從 `match_price_candles` storage 回傳指定 symbol 的最近 candles。
- 前端 service 新增 `listMatchCandles()`，透過 Nakama RPC 讀取後端 candle feed。
- Match panel 新增 `Market intelligence` 區塊，顯示 Last price、Trend、SMA 5/20、RSI 14、MACD 與 SVG 迷你圖。
- 指標只作為交易輔助資訊；成交、partial fill、rejected、expired、fee、tax、slippage、NAV、P&L、winner 仍由 Go runtime authoritative settlement 計算。
