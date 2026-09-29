# Week 5 開發紀錄與交易介面說明

本文件整理 2026-06-14 至 2026-06-20 的 match 功能整合進度。這週的實際範圍不只包含交易介面優化，也包含串接即時 / 準即時價格、正式買進賣出流程、後端 authoritative settlement、成交與投組資料保存，以及把對戰房間從 console 顯示 `Authoritative=false` 推進到 `Authoritative=true` 的重要里程碑。

---

## 1. 本週範圍更正

本週正確範圍應包含以下里程碑，這些內容先前有一部分誤植到 Week 4：

- 串接市場價格資料與 candle feed。
- 對戰中的買進 / 賣出流程正式接上後端 order submit 與 portfolio 回寫。
- 後端 authoritative settlement、成交明細與投組資料保存。
- 對戰房間由舊的 relayed / console `Authoritative=false` 演進到 authoritative match handler / console `Authoritative=true`。
- 在此基礎上，再進一步做交易介面滑桿化、視覺化、風控提示與欄位整理。

## 2. 本週主要開發

### 2.1 交易票券改為滑桿式操作

`components/realtime-match-panel.tsx` 的下單區從手動數值輸入，改成以滑桿控制：

- `Buy / Sell` 改成視覺化切換。
- `Quantity` 改成滑桿與 `25% / 50% / 75% / 100%` 快速按鈕。
- `Limit price` 改成以目前行情為中心的滑桿。
- 買入數量不能超過可用資金。
- 賣出數量不能超過目前持倉。
- `My cash`、`My P&L` 改成後端回傳的只讀結果，不再由前端手動輸入。

### 2.2 Market data 自動跟 round 同步

- `Market intelligence` 會在 round 變更時自動刷新。
- 參考價會使用最新 candle feed。
- 價格區間會圍繞最新行情自動生成，避免輸入不合理的 limit price。

### 2.3 移除無用測試操作

為了讓主畫面更像交易遊戲，已從主操作區移除：

- 手動 `Ping`
- 手動 `Emote`
- 手動 `Timer sync`
- 手動 `Sync state`
- 手動輸入 `order id` 的取消方式

這些仍可由底層 service / runtime 支援，但不再放在主交易票券區。

### 2.4 後端結算可視化

- 下單後，前端會用 runtime 回傳的 `portfolio` 更新 cash、P&L、score。
- `Stop & settle` 會呼叫 authoritative settlement，並把結果回寫到 UI。
- `Open orders` 區塊直接列出目前使用者的掛單，使用者可從清單中取消。

### 2.5 本週驗證

已確認：

- TypeScript compile 通過。
- ESLint 通過。
- relayed match smoke test 通過。

---

## 3. 對戰介面欄位說明

### 3.1 上方狀態列

- `Mode`：目前對戰模式。`authoritative` 代表由 Nakama authoritative match handler 建立的房間。
- `Players`：目前房間內的玩家數量。
- `Host`：目前 deterministic host 的名稱。
- `Latency`：Ping / Pong 測得的粗略 RTT。

### 3.2 交易進度列

- `Round`：目前回合數。
- `Timer`：目前回合剩餘秒數。若顯示 `not synced`，代表尚未收到有效 timer snapshot。
- `My cash`：自己目前可用現金。
- `My P&L`：自己目前損益。

### 3.3 持倉與報酬列

- `My NAV`：自己目前資產淨值。
- `Realized P&L`：已實現損益。
- `Unrealized P&L`：未實現損益。
- `Return`：目前報酬率。

### 3.4 對手與事件列

- `Opponent portfolio`：對手目前回傳的 cash / P&L / NAV 摘要。
- `Last action`：最近一筆交易或結算事件。
- `Last emote`：最近一筆表情或輕量訊號。

### 3.5 市場資訊區

- `Last price`：最新收盤價。
- `Trend`：價格趨勢文字。
- `SMA 5 / 20`：5 期與 20 期簡單移動平均。
- `RSI 14`：14 期 RSI。
- `MACD`：MACD 與 signal 線。
- 圖表：
  - K 線
  - 成交量
  - SMA 線
  - 趨勢線

### 3.6 Order ticket

- `symbol`：交易標的。
- `Side`：買入或賣出。
- `Type`：Limit 或 Market。
- `TIF`：Time in Force。
- `Limit price`：限價滑桿，只在 Limit 下單時使用。
- `Buy quantity` / `Sell quantity`：數量滑桿。
- `25% / 50% / 75% / 100%`：快速選擇可用額度比例。
- `Post-only`：若掛單會立即成交，則取消送單。
- `Reduce-only`：只允許減少部位。
- `Available cash`：可用資金。
- `Holding`：目前持倉。
- `Est. notional`：預估名目金額。
- `Reference price`：目前行情參考價。

### 3.7 Match control

- `Ready`：標記自己已準備好。
- `Start`：host 在雙方 ready 後開始回合。
- `Stop & settle`：host 結束對戰並進行結算。
- `Refresh orders`：重新抓取 backend order book 與 replay。

### 3.8 Open orders

- 顯示目前自己的 open / partial orders。
- `Cancel` 按鈕會直接對應該筆掛單做取消。

---

## 4. 本週關鍵程式註解補強

### 4.1 `components/realtime-match-panel.tsx`

- 補上 order ticket 的數量與價格限制註解。
- 補上 `reloadExchangeState()` 與 settlement preview 的註解。
- 補上 `handleSendTestAction()` 與 `handleCancelOpenOrder()` 的行為註解。
- 補上 `TradeSlider`、`buildRiskSummary()`、`buildLimitPriceBounds()` 的說明。

### 4.2 `lib/nakama/match.ts`

- 補上 relayed match op code、socket cache、presence cache、resume 與 listener registry 的中文註解。
- 修正 `submitRelayedMatchOrder()` 與 `submitRelayedMatchResult()` 周邊註解，讓 order / result 的責任邊界更清楚。
- 補上 directed send、matchmaker、payload encoding、sequence 與 send throttle 的中文說明。

---

## 5. 新增程式碼位置索引

以下列出本週和交易介面優化直接相關的主要程式碼片段、所在行數與用途。

### 5.1 交易節奏與主元件

- [ROUND_DURATION_SECONDS](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:74):74：每回合秒數，目前固定為 10 秒。
- [MAX_MATCH_ROUNDS](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:75):75：自動結算前的最大回合數。
- [RealtimeMatchPanel()](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:96):96：對戰主畫面元件，整合狀態列、market intelligence、order ticket、open orders 與 settlement 面板。

### 5.2 後端結算狀態與交易限制

- [latestSettlement](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:171):171：從 runtime settlement 中取出目前使用者的最新結算結果。
- [marketIndicators](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:195):195：將 candle feed 轉成 Last price、SMA、RSI、MACD 與 trend。
- [selfOpenOrders](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:230):230：目前使用者仍有效的 open / partial orders，用於 Open orders 面板。

### 5.3 市場資料與對戰資料刷新

- [reloadMarketData()](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:485):485：依目前 symbol 重新抓取 candle feed。
- [reloadExchangeState()](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:503):503：重新抓取 order book、trade tape、match events 與 authoritative settlement preview。

### 5.4 結算與停止流程

- [settleCurrentMatch()](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:743):743：呼叫 `submit_match_result`，把 authoritative settlement 寫回 UI。
- [handleStopTimer()](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:781):781：host 主動停止對戰並觸發結算。

### 5.5 下單與取消掛單

- [handleSendTestAction()](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:864):864：建立結構化 order，送到 Nakama runtime，並用 runtime 回傳的 portfolio 更新 cash / P&L / score。
- [handleCancelOpenOrder()](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:945):945：取消目前 open orders 面板中的指定掛單。

### 5.6 交易介面元件

- [MatchStat()](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1681):1681：上方統計卡片共用顯示元件。
- [TradeSlider()](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1690):1690：買賣數量與限價滑桿元件，會自動限制上下界。

### 5.7 風控與價格範圍

- [buildRiskSummary()](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:2042):2042：依 portfolio 與 open orders 計算現金佔用、部位佔用與掛單風險摘要。
- [buildLimitPriceBounds()](/C:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:2468):2468：依最新市場價格產生限價滑桿的上下界。

### 5.8 前端 service：從 UI 請求後端運算與保存

- [createCommunityMatchLobby()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:103):103：建立 community lobby，並由後端決定對應的 match 建立方式。
- [submitRelayedMatchOrder()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:141):141：前端不再自行計算成交與資產，而是把 order 送去 runtime 驗證、計算與保存。
- [cancelRelayedMatchOrder()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:159):159：透過 RPC 取消後端保存中的 open order。
- [listMatchCandles()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:177):177：從 runtime / storage 讀取 candle feed，讓市場資料不再依賴前端假資料。
- [listMatchOrderBook()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:188):188：讀取後端 order book 狀態，顯示 open / partial / filled / canceled 等結果。
- [submitRelayedMatchResult()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:219):219：把結算請求交給 runtime，由後端重算 score、P&L、winner 與 settlement。

### 5.9 後端 runtime：正式運算、保存與 authoritative match

- [MatchJoinAttempt()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:558):558：authoritative match 的進房檢查入口。
- [MatchJoin()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:571):571：玩家加入 authoritative match 後初始化狀態與 snapshot。
- [MatchLoop()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:600):600：authoritative match 的主事件迴圈，這是 console 變成 `Authoritative=true` 的核心。
- [rpcSubmitMatchOrderHandler()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1764):1764：後端驗證 order、計算 portfolio、寫入 order 與 order book。
- [rpcIngestMatchCandlesHandler()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1986):1986：接收外部 candle ingestion，把行情資料寫入 storage。
- [rpcListMatchCandlesHandler()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2056):2056：把後端保存的 candle feed 提供給前端圖表與市場資訊區。
- [rpcSubmitMatchResultHandler()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2147):2147：後端重算 settlement、winner、score，並保存最終結果。
- [seedDefaultMatchPriceFeed()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2953):2953：在沒有外部行情資料時建立預設 price feed，避免市場資料完全空白。
- [writeMatchOrderBookRecords()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3508):3508：把 order settlement 結果批次保存到 storage。
- [writeMatchOrderBookRecord()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3836):3836：保存單筆 order / fill 狀態快照。
- [writeMatchPortfolio()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3852):3852：把每位玩家的 cash、positions、NAV、P&L 寫回後端 storage。

### 5.10 scripts：行情串接與驗證腳本

- [relayed-match-smoke.mjs](/C:/Users/kdsam/Documents/nakamafrontend/scripts/relayed-match-smoke.mjs:7):7：端到端驗證 authoritative match、order submit、settlement 與 replay。
- [identity()](/C:/Users/kdsam/Documents/nakamafrontend/scripts/relayed-match-smoke.mjs:45):45：建立一次性測試帳號，讓 smoke test 可重複執行。
- [lobbyResponse 建立段](/C:/Users/kdsam/Documents/nakamafrontend/scripts/relayed-match-smoke.mjs:118):118：驗證 lobby 建出來的是 authoritative match。
- [orderResponse 提交段](/C:/Users/kdsam/Documents/nakamafrontend/scripts/relayed-match-smoke.mjs:141):141：驗證下單後由 runtime 回傳 portfolio 與 accepted order。
- [resultResponse 結算段](/C:/Users/kdsam/Documents/nakamafrontend/scripts/relayed-match-smoke.mjs:192):192：驗證 settlement 會忽略 client score，改用後端計算結果。
- [price-feed-worker.mjs](/C:/Users/kdsam/Documents/nakamafrontend/scripts/price-feed-worker.mjs:7):7：長駐行情 worker，持續輪詢交易所並把 candles 推進 Nakama。
- [getSession()](/C:/Users/kdsam/Documents/nakamafrontend/scripts/price-feed-worker.mjs:61):61：重用 device session，避免每輪輪詢都重建登入。
- [ingestOnce()](/C:/Users/kdsam/Documents/nakamafrontend/scripts/price-feed-worker.mjs:70):70：抓一批 OHLCV 後呼叫 ingest RPC 寫進後端。
- [main()](/C:/Users/kdsam/Documents/nakamafrontend/scripts/price-feed-worker.mjs:94):94：以 polling loop 模式運作，可視為本地排程服務。
- [integration-smoke.mjs](/C:/Users/kdsam/Documents/nakamafrontend/scripts/integration-smoke.mjs:7):7：驗證好友、公會、排行榜與群聊基礎功能，確保 match 依賴的 community context 正常。
- [waitForMessage()](/C:/Users/kdsam/Documents/nakamafrontend/scripts/integration-smoke.mjs:63):63：驗證 guild chat 訊息真的能跨帳號送達。
- [createGuildResponse 建立段](/C:/Users/kdsam/Documents/nakamafrontend/scripts/integration-smoke.mjs:110):110：驗證 guild 建立與治理上下文完整。
- [ingest-btc-candles.mjs](/C:/Users/kdsam/Documents/nakamafrontend/scripts/ingest-btc-candles.mjs:7):7：一次性把 BTC candle 匯入 Nakama，適合手動 bootstrap。
- [main()](/C:/Users/kdsam/Documents/nakamafrontend/scripts/ingest-btc-candles.mjs:48):48：抓取單批 BTC/USDT OHLCV 並透過 protected RPC 寫入 storage。

## 6. 目前專案狀態

本週完成後，match 功能已從單純 relayed UI demo，推進到含市場價格、後端下單、authoritative settlement、成交保存與 authoritative room 的交易對戰基礎版本：

- 市場價格與 candle feed 已接上對戰流程。
- 買進與賣出已經接上後端 order submit 與 portfolio 回寫。
- Settlement、成交與投組資料已由後端計算並保存。
- 對戰房間已從 `Authoritative=false` 演進到 `Authoritative=true`。
- 在這個基礎上，前端再補上滑桿下單、視覺化欄位與風控摘要。

仍保留的下一步空間：

- 更完整的撮合規則顯示，例如部分成交、未成交原因、撤單原因。
- 更細的風控提示，例如風險敞口、最大回撤、單筆下單風險。
- 更完整的績效視圖，例如成交明細與 round by round 損益。
