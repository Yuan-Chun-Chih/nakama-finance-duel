# Week 7 開發紀錄：Authoritative BTC 交易對決

本文件記錄 2026-06-28 至 2026-07-04 的對戰改版。Week 7 將主要遊戲從圈圈叉叉切回 BTC 現貨交易，並沿用 Week 6 的 authoritative state machine、即時 snapshot、reconnect resume 與 append-only event 經驗，避免回到 Week 5 的前後端雙重計算。

---

## 1. 遊戲規則

- 每場固定兩位玩家。
- 初始資金為 `$1,000,000`。
- 雙方 Ready 後由 server 進行 10 秒倒數，再自動開始。
- 每局 5 分鐘，共 30 回合，每回合 10 秒。
- 標的固定為 `BTC/USDT`，價格每回合由 Nakama storage 的即時 price feed 更新。
- 第一版僅支援現貨，不允許放空或槓桿。
- BTC 數量以 `1 BTC = 1,000,000 micros` 的整數精度保存，前端可下到 `0.000001 BTC`。
- 美元資產以 cents 保存；前端顯示時才轉回美元。
- 市場面板顯示後端 candles 產生的 K 線、成交量、SMA、EMA、RSI、MACD、signal、波動率與趨勢。
- Market 單依 server 參考價、滑價、手續費及賣出稅成交。
- Limit 單保留在 server order book，價格條件成立才成交。
- 結束時只比較雙方 NAV 報酬率；NAV 相同則為平手。
- 玩家斷線超過 20 秒或主動投降時，由 server 判定對手獲勝。
- 行情最後更新時間超過 30 秒時，server 將市場標記為 stale 並拒絕所有新訂單，直到 price feed 恢復。
- 每個回合都保存雙方 Portfolio Snapshot；每筆訂單與成交則分別保存完整狀態及費用明細。
- 對局結束後更新 Finance Elo Rating、勝敗和平手、累積報酬與個人歷史紀錄。

---

## 2. Authoritative 邊界

前端只允許送出以下意圖：

- Ready / Cancel ready。
- Market 或 Limit 買賣意圖。
- 取消自己的 open order。
- 請求最新 state snapshot。
- 投降。

以下資料只能由 Go runtime 產生：

- 玩家名單與等待室 Ready 狀態。
- 對局開始時間、回合與剩餘秒數。
- BTC 成交參考價。
- 訂單是否接受、成交、取消或拒絕。
- Cash、BTC 持倉、平均成本、已實現與未實現損益。
- NAV、報酬率、勝方與 finish reason。
- 行情是否過期、每回合投組快照、完整 order/fill 紀錄與 Finance Rating。

### 2.1 未實現損益

目前已具備未實現損益功能，而且 authoritative 真相來源位於後端：

- [UnrealizedPnLCents](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:371):371：finance portfolio 以整數美分保存未實現損益。
- [financeMarkPortfolios()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1850):1850：使用 `(server price - average cost) × BTC quantity` 計算未實現損益，並同步重算 NAV 與 returnBps。
- [FinancePortfolioView.unrealizedPnlCents](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:494):494：前端 authoritative snapshot 的未實現損益欄位。
- [Portfolio()](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:602):602：將後端 cents 轉成美元並顯示為 `Unrealized P&L`。

這個數值不是另一筆已完成收益。持倉尚未賣出時，它會隨 server BTC price 變化；賣出成交後，對應部分才會移入 `realizedPnlCents`。

### 2.2 Portfolio 績效與歷史分頁

- 前端依後端 `finance_portfolio_snapshots` 建立 NAV、已實現損益與未實現損益曲線。
- 最大回撤使用每回合 NAV 的歷史高點計算；這是只讀 projection，不參與 authoritative 勝負判定。
- Finance history 首次載入最近 10 局，再使用 Nakama storage cursor 讀取更早對局。
- 分頁結果依 `arenaId` 去重，避免 refresh 與 load-more 交錯時重複顯示。

### 2.3 行情 worker 可觀測性

- 成功 ingestion 會輸出 JSON heartbeat，包含 `lastSuccessAt` 與下次輪詢時間。
- 失敗分類為 `exchange_network`、`exchange_rejected`、`nakama_authentication`、`nakama_ingestion` 或 `worker_internal`。
- 連續失敗使用指數退避，預設最高等待 5 分鐘。
- 連續失敗達門檻會輸出結構化 alert；設定 `MATCH_PRICE_ALERT_WEBHOOK_URL` 後也會送到外部端點。

---

## 3. 主要程式碼位置

### 3.1 Go authoritative runtime

- [finance opcodes](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:66):66：定義 Ready、Order、Cancel、State、Event 與 Resign 的 WebSocket contract。
- [financeUSDScale](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:134):134：金額以美分保存，避免極小 BTC 訂單被截斷成免費成交。
- [financeBTCScale](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:135):135：定義 BTC micros 精度，所有資金運算維持 `int64`。
- [financeAuthoritativeMatchState](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:329):329：保存等待室、玩家、投組、掛單、成交、價格 freshness、倒數與勝負的單一 server state。
- [MatchInit()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1446):1446：建立一百萬初始資金規則，並讀取帶更新時間的 BTC price feed。
- [MatchJoin()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1511):1511：限制兩位玩家、初始化 portfolio、保存等待室 snapshot。
- [MatchLoop()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1554):1554：每秒處理訊息、行情 freshness、10 秒換回合、回合快照、5 分鐘結算與斷線判負。
- [financeHandleMessage()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1627):1627：接收並分派前端交易意圖，前端不能直接覆寫 server state。
- [financeAcceptOrder()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1686):1686：先拒絕 stale market，再驗證現貨資金、持倉、方向、類型、數量與限價。
- [financeTryFillOrder()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1747):1747：依即時 BTC 價格成交，計算滑價、費用、稅、cash 與 position，並保存 fill。
- [financeRefreshPrice()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1834):1834：每回合讀取 price record 及更新時間，判斷市場是否過期。
- [financeFinish()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1859):1859：依 NAV 決定勝方，保存 final game 並更新 Rating/stats。
- [financeBroadcastState()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1880):1880：每秒或狀態改變時推送包含 `marketStale` 的 authoritative snapshot。
- [financeAppendEvent()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1912):1912：把加入、Ready、倒數、下單、成交、拒絕與結束事件 append-only 保存並即時廣播。
- [financePersistSnapshot()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1927):1927：保存等待室與對局最新 projection。
- [financePersistOrder()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1939):1939：保存訂單由 open 到 filled、partial、canceled 或 rejected 的最新完整狀態。
- [financePersistFill()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1950):1950：以不可重複的 fill id 保存成交價、數量、名目金額、費用、稅與滑價。
- [financePersistRoundPortfolios()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1957):1957：每回合為每位玩家保存 cash、BTC、NAV、損益與報酬快照。
- [persistFinanceGameAndStats()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2086):2086：以 CAS retry 保存完成對局、Elo Rating、戰績 projection 與個人歷史索引。
- [financeNotional()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2037):2037：將 BTC micros 與價格 cents 換算為整數美分名目金額。
- [rpcCreateFinanceMatchHandler()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3248):3248：建立不依賴 community 的 authoritative finance 房間。
- [rpcListFinanceHistoryHandler()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3269):3269：回傳個人 stats、歷史對局、當前 arena orders、fills 與 round snapshots。
- [financePriceIsStale()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:4875):4875：以 30 秒 freshness deadline 判斷行情是否可交易。
- [MATCH_PRICE_POLL_INTERVAL_MS](/C:/Users/kdsam/Documents/nakamafrontend/nakama/docker-compose.yml:72):72：行情 worker 每 10 秒更新 BTC candle，與遊戲回合週期一致。

### 3.2 前端即時同步

- [FinanceDuelMatchPanel()](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:56):56：完整交易對決畫面。
- [server-triggered candle refresh](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:102):102：只有 authoritative round/price snapshot 更新時才重新讀取後端 candles。
- [lobby polling](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:121):121：開始前每 3 秒向後端更新 community finance rooms。
- [refresh resume](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:134):134：頁面刷新後以中性 realtime API 重新加入同一場 finance match。
- [WebSocket snapshot listener](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:144):144：接收 server state/event，等待室、倒數和遊戲中都使用同一條即時同步路徑。
- [loadMoreHistory()](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:185):185：使用後端 cursor 載入更早對局並依 arena id 去重。
- [toggleReady()](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:251):251：只送 Ready 意圖，倒數與開始由後端判斷。
- [submitOrder()](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:256):256：將小數 BTC 轉成 quantityMicros、美元轉成 cents，只傳交易意圖。
- [resignMatch()](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:272):272：送出投降意圖，由 server 決定勝方。
- [history refresh](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:172):172：依 server event 重新讀取後端 history RPC，不在前端自行累加戰績。
- [MarketPanel()](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:387):387：顯示 K 線、技術指標、server price 更新時間與 stale 停盤狀態。
- [FinanceRecordPanel()](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:468):468：顯示 Rating、勝敗和平手、近期結果與 cursor 載入按鈕。
- [ExchangeHistoryPanel()](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:507):507：顯示完整訂單、成交費用、Portfolio Snapshot 與績效摘要。
- [buildPortfolioPerformance()](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:558):558：從 round snapshots 計算曲線資料與最大回撤。
- [PortfolioPerformanceChart()](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:584):584：繪製 NAV、已實現及未實現損益曲線。
- [toMicros()](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:622):622：送單前將 BTC 小數轉為整數 micros。
- [buildIndicators()](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:643):643：由後端 candles 計算 SMA、EMA、RSI、MACD、signal、波動率與趨勢。
- [FINANCE_MATCH_OP_CODES](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:60):60：前後端共用的 finance WebSocket opcode。
- [createFinanceMatch()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:128):128：透過 RPC 建立 authoritative finance room 後加入 socket match。
- [listFinanceHistory()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:138):138：讀取後端戰績、orders、fills 與 snapshots。
- [realtime match aliases](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:795):795：提供 `joinRealtimeMatch` 等中性名稱；舊 relayed export 僅作相容層。
- [FinanceMatchStateView](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:514):514：前端 authoritative snapshot 型別，包含 `marketStale`。

### 3.3 端到端測試

- [waitForState()](/C:/Users/kdsam/Documents/nakamafrontend/scripts/finance-duel-smoke.mjs:44):44：等待符合條件的 server snapshot，避免以前端延遲猜測結果。
- [main()](/C:/Users/kdsam/Documents/nakamafrontend/scripts/finance-duel-smoke.mjs:57):57：驗證雙帳號加入、fresh market、成交、round snapshot、結算、Rating 與 history RPC。

### 3.4 沿用但關鍵的後端－前端連接框架

以下程式並非全部在 Week 7 新增，但 Week 7 的 authoritative finance 流程依賴它們。少了其中任一層，前端就無法建立房間、加入 WebSocket、接收 snapshot 或取得行情。

#### Runtime 註冊與遊戲路由

- [InitModule()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:755):755：Go plugin 啟動入口，註冊 RPC 與 authoritative match handlers。
- [RegisterMatch(finance)](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:773):773：把 `finance_authoritative_match` module 掛入 Nakama。
- [matchGameDefinitionFor()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1429):1429：依 `gameType` 選擇 finance 或 tic-tac-toe handler，保留多遊戲擴充能力。
- [rpcCreateMatchLobbyHandler()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3409):3409：驗證 community membership、建立 authoritative match，並保存可查詢的 lobby record。

#### 前端 RPC 與 WebSocket service

- [getRuntimeContext()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/client.ts:35):35：集中定義 runtime RPC id，避免 component 硬編後端名稱。
- [createCommunityMatchLobby()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:144):144：呼叫 lobby RPC，取得 match id 後加入 authoritative room。
- [joinRelayedMatch()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:300):300：舊相容實作；Finance 已改用 `joinRealtimeMatch` 中性入口。
- [subscribeToRelayedMatchData()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:481):481：依 match id 註冊資料 listener，供 finance panel 接收 state/event opcode。
- [persistRelayedMatchResume()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:531):531：保存目前 match id，支援頁面刷新後重連。
- [restoreRelayedMatchResume()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:536):536：讀取本地 resume metadata，再由 socket 向後端要求最新 snapshot。
- [ensureRelayedMatchSocket()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:574):574：建立或重用 Nakama WebSocket，統一接收 match data、presence 與 notification。
- [normalizeMatchData()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:650):650：將 Nakama SDK 的 binary match data 解碼為前端事件模型。

#### 行情 ingestion 與讀取

- [PriceFeedError](/C:/Users/kdsam/Documents/nakamafrontend/scripts/price-feed-worker.mjs:65):65：攜帶故障分類，區分交易所、Nakama 與 worker 內部錯誤。
- [sendAlert()](/C:/Users/kdsam/Documents/nakamafrontend/scripts/price-feed-worker.mjs:87):87：輸出結構化告警並選擇性呼叫 webhook。
- [ingestOnce()](/C:/Users/kdsam/Documents/nakamafrontend/scripts/price-feed-worker.mjs:121):121：分階段抓取 OHLCV、驗證登入並送入 protected Nakama RPC。
- [price worker main()](/C:/Users/kdsam/Documents/nakamafrontend/scripts/price-feed-worker.mjs:162):162：成功輸出 heartbeat；失敗採分類告警與指數退避。
- [price-feed monitoring env](/C:/Users/kdsam/Documents/nakamafrontend/nakama/docker-compose.yml:74):74：設定最大退避、告警門檻與選配 webhook。
- [rpcIngestMatchCandlesHandler()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3788):3788：驗證 ingestion secret 與 candle 欄位，寫入 candle/price storage。
- [rpcListMatchCandlesHandler()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3859):3859：從 Nakama storage 回傳後端 candles 給 K 線與技術指標面板。
- [readMatchPriceFeed()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:4847):4847：authoritative match 每回合讀取 BTC server price；沒有資料時才補預設價格。
- [listMatchCandles()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:225):225：前端 candle RPC wrapper，不直接連交易所或資料庫。

---

## 4. PostgreSQL 查詢

```powershell
cd C:\Users\kdsam\Documents\nakamafrontend\nakama
docker compose exec postgres psql -U postgres -d nakama
```

查看最新等待室或遊戲 snapshot：

```sql
select key, value, update_time at time zone 'Asia/Taipei' as updated_at_taipei
from storage
where collection = 'finance_snapshots'
order by update_time desc
limit 10;
```

查看 append-only 交易事件：

```sql
select key, value, update_time at time zone 'Asia/Taipei' as created_at_taipei
from storage
where collection = 'finance_events'
order by update_time desc
limit 100;
```

查看已完成對局：

```sql
select key, value, update_time at time zone 'Asia/Taipei' as finished_at_taipei
from storage
where collection = 'finance_games'
order by update_time desc;
```

查看完整訂單與成交紀錄：

```sql
select collection, key, value,
       update_time at time zone 'Asia/Taipei' as updated_at_taipei
from storage
where collection in ('finance_orders', 'finance_fills')
order by update_time desc;
```

查看每回合 Portfolio Snapshot：

```sql
select key, value,
       update_time at time zone 'Asia/Taipei' as updated_at_taipei
from storage
where collection = 'finance_portfolio_snapshots'
order by update_time desc;
```

查看 Finance Rating、戰績與玩家歷史索引：

```sql
select collection, key, value,
       update_time at time zone 'Asia/Taipei' as updated_at_taipei
from storage
where collection in ('finance_player_stats', 'finance_player_history')
order by update_time desc;
```

快速確認各類資料筆數：

```sql
select collection, count(*)
from storage
where collection in (
  'finance_games', 'finance_orders', 'finance_fills',
  'finance_portfolio_snapshots', 'finance_player_stats',
  'finance_player_history'
)
group by collection
order by collection;
```

---

## 5. 驗證方式

```powershell
cmd /c npx tsc --noEmit
cmd /c npm run lint
cd nakama
go test ./...
cd ..
cmd /c npm run test:finance-duel
```

目前 TypeScript、ESLint、Next.js build、Go compile、Docker runtime 重建與 `test:finance-duel` 均已通過。Smoke test 已驗證 fresh market、雙方成交、Portfolio Snapshot、結算、Rating 與個人 history；PostgreSQL 也確認已寫入 `finance_orders`、`finance_fills`、`finance_portfolio_snapshots`、`finance_player_stats`、`finance_player_history` 與 `finance_games`。

測試時必須保持 `price-feed` service 運行：

```powershell
cd nakama
docker compose up -d price-feed
docker compose logs price-feed --tail=20
```

若行情超過 30 秒沒有更新，後端會按設計拒絕下單，而不是使用過期價格繼續成交。

---

## 6. 下一步

1. 增加完整 replay 畫面，依 orders、fills、round snapshots 與 events 重播整場交易決策。
2. 將最大回撤與風險指標保存成後端 stats projection，支援排行榜與跨裝置查詢。
3. 為 price-feed webhook 加入簽章、告警恢復通知與 Prometheus/OpenTelemetry metrics。
4. 完成圈圈叉叉與舊交易面板的中性 realtime API 遷移後，再刪除 deprecated relayed aliases。
