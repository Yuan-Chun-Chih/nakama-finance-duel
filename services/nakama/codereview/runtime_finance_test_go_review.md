# runtime_finance_test.go 逐段 Code Review

每段以 `L1`、`L2` 對照 `runtime_finance_test.go` 由上到下的測試程式。這些測試直接呼叫純函式或建立最小 state，不需要啟動 Nakama、PostgreSQL 或 Docker。

## 1. import

```go
// L1
import "github.com/heroiclabs/nakama-common/api"
// L2
import "testing"
// L3
import "time"
```

- `L1`：使用 `api.StorageObject` 模擬 Nakama Storage 讀出的 idempotency records。
- `L2`：Go 標準測試套件，提供 `t.Run`、`t.Fatal` 與 `t.Fatalf`。
- `L3`：建立固定或相對時間，測試行情 freshness、lease 與到期清理。

## 2. `TestFinanceNotionalPreservesBTCMicrosPrecision`

```go
// L1
tests := []struct { name string; quantity int64; price int64; want int64 }{ ... }
// L2
{name: "one BTC at cents price", quantity: financeBTCScale, price: 6_264_729, want: 6_264_729}
// L3
{name: "fractional BTC rounds down to cents", quantity: 15_914_707, price: 6_264_729, want: 99_701_326}
// L4
for _, test := range tests { t.Run(test.name, func(t *testing.T) { ... }) }
// L5
if got := financeNotional(test.quantity, test.price); got != test.want { t.Fatalf(...) }
```

- `L1`：建立 table-driven test；每筆資料包含 BTC micros 數量、cents 價格與預期名目金額。
- `L2`：`financeBTCScale` 代表一整顆 BTC，乘上 cents 價格後仍應得到相同 cents 價格。
- `L3`：驗證小數 BTC 換算 cents 時依整數除法截去不足一 cent 的部分，而不是使用浮點數。
- `L4`：逐筆建立有名稱的子測試，失敗時可直接辨識是哪個情境。
- `L5`：呼叫 authoritative 金額公式；結果不同就終止該子測試並輸出實際值與預期值。

## 3. `TestFinanceAllowMessage`

```go
// L1
state := &financeAuthoritativeMatchState{Tick: 10, MessageRateWindows: map[string]financeMessageRateWindow{}}
// L2
for index := 0; index < financeMutationMessagesPerTick; index++ { if !financeAllowMessage(state, "user", financeOrderOpCode) { ... } }
// L3
if financeAllowMessage(state, "user", financeOrderOpCode) { t.Fatal(...) }
// L4
state.Tick++
// L5
if !financeAllowMessage(state, "user", financeOrderOpCode) { t.Fatal(...) }
```

- `L1`：建立最小 match state；`Tick: 10` 代表目前 server tick，map 保存各玩家的訊息計數窗。
- `L2`：在單一 tick 內，剛好送到 `financeMutationMessagesPerTick` 上限的 order intent 都必須被接受。
- `L3`：再多送一筆時必須被拒絕，防止玩家在同一秒大量送出交易意圖。
- `L4`：模擬 authoritative match 進入下一個 tick。
- `L5`：下一個 tick 應建立新的計數窗，因此同一玩家又能正常送一筆訊息。

## 4. `TestFinanceFeesAndSlippageUseBasisPoints`

```go
// L1
if got := calculateBpsCeil(99_701_326, matchTakerFeeBps); got != 79_762 { t.Fatalf(...) }
// L2
if got := calculateBpsCeil(99_701_326, matchTaxBps); got != 99_702 { t.Fatalf(...) }
// L3
if got, _ := applyMatchSlippage(6_264_729, "buy"); got <= 6_264_729 { t.Fatalf(...) }
// L4
if got, _ := applyMatchSlippage(6_264_729, "sell"); got >= 6_264_729 { t.Fatalf(...) }
```

- `L1`：以名目金額和 taker fee basis points 計算費用，並驗證向上取整後的 cents 結果。
- `L2`：以相同公式驗證賣出稅；fee 與 tax 都必須由 server constants 決定。
- `L3`：買入滑價後的成交價必須高於參考價，否則買方反而取得不合理優惠。
- `L4`：賣出滑價後的成交價必須低於參考價，形成對稱的成交成本。

## 5. `TestFinancePriceFreshness`

```go
// L1
fresh := time.Now().UTC().Add(-time.Second).Format(time.RFC3339)
// L2
stale := time.Now().UTC().Add(-time.Duration(financePriceMaxAgeSeconds+1) * time.Second).Format(time.RFC3339)
// L3
if financePriceIsStale(fresh) { t.Fatal("fresh price marked stale") }
// L4
if !financePriceIsStale(stale) { t.Fatal("expired price marked fresh") }
// L5
if !financePriceIsStale("not-a-timestamp") { t.Fatal("invalid timestamp marked fresh") }
```

- `L1`：建立一秒前的 UTC 時間，這筆行情應仍在允許交易的 freshness 範圍內。
- `L2`：建立比 `financePriceMaxAgeSeconds` 多一秒的舊時間，確保剛超過邊界就被視為 stale。
- `L3`：新鮮行情不應被錯誤停盤。
- `L4`：過期行情必須被停盤，避免使用歷史價格成交。
- `L5`：無法解析的時間字串採 fail closed 策略，也就是一律視為 stale。

## 6. `TestBootstrapMarketDataIsNeverTradable`

```go
// L1
fresh := time.Now().UTC().Format(time.RFC3339)
// L2
if !financePriceRecordIsStale(matchPriceRecord{Price: 65000, UpdatedAt: fresh, Source: "bootstrap"}) { t.Fatal(...) }
// L3
if financePriceRecordIsStale(matchPriceRecord{Price: 65000, UpdatedAt: fresh, Source: "ccxt"}) { t.Fatal(...) }
```

- `L1`：建立目前時間，排除單純因時間太舊導致 stale 的影響。
- `L2`：即使 bootstrap 假行情有新時間，`Source: "bootstrap"` 仍必須強制視為不可交易。
- `L3`：同樣新鮮、但來源是正式 CCXT worker 的價格，應可正常通過 freshness 判定。

## 7. `TestMarketBootstrapRequiresExplicitEnvironmentFlag`

```go
// L1
t.Setenv("MATCH_PRICE_ALLOW_BOOTSTRAP", "")
// L2
if marketBootstrapEnabled() { t.Fatal(...) }
// L3
t.Setenv("MATCH_PRICE_ALLOW_BOOTSTRAP", "false")
// L4
if marketBootstrapEnabled() { t.Fatal(...) }
// L5
t.Setenv("MATCH_PRICE_ALLOW_BOOTSTRAP", "true")
// L6
if !marketBootstrapEnabled() { t.Fatal(...) }
```

- `L1`：在此測試 process 暫時清空環境變數；測試結束後 Go 會自動還原。
- `L2`：未設定時預設禁止 bootstrap，避免正式環境意外使用假行情。
- `L3`：將值明確設為字串 `false`。
- `L4`：明確關閉時同樣必須禁止 bootstrap。
- `L5`：只有明確 opt-in 的 `true` 才允許建立測試行情。
- `L6`：驗證這個 opt-in 行為確實生效，讓隔離測試環境仍能使用預設資料。

## 8. `TestFinanceIdempotencyCleanupPageExpiresOnlyInvalidOrPastRecords`

```go
// L1
now := time.Date(2026, time.July, 13, 12, 0, 0, 0, time.UTC)
// L2
objects := []*api.StorageObject{expired, fresh, invalid, malformed}
// L3
deletes, cursor := financeIdempotencyCleanupPage(objects, "next-page", now)
// L4
if len(deletes) != 2 { t.Fatalf(...) }
// L5
if deletes[0].Key != "expired" || deletes[0].Version != "v1" { t.Fatalf(...) }
// L6
if deletes[1].Key != "invalid" || deletes[1].Version != "v3" { t.Fatalf(...) }
// L7
if cursor.Cursor != "next-page" || cursor.UpdatedAt != now.Format(time.RFC3339Nano) { t.Fatalf(...) }
```

- `L1`：使用固定時間，讓到期判定和 cursor 更新時間可重現，不依賴測試執行當下時間。
- `L2`：模擬四種 Storage 資料：已到期、尚未到期、無效到期時間、完全無法解析 JSON。
- `L3`：只測試一頁資料的清理決策；實際 Storage delete 與 cursor 寫入由外層 maintenance 處理。
- `L4`：預期只刪除 `expired` 和 `invalid`；新鮮資料與 malformed JSON 不應被這個測試定義為可安全刪除。
- `L5`：刪除物件必須保留 Storage version `v1`，讓實際刪除可用 CAS 避免誤刪更新後的 record。
- `L6`：無效 expiry 的 record 也保留其 version `v3`。
- `L7`：回傳下一頁 cursor 和固定更新時間，讓下一輪清理能從正確位置接續。

## 9. `TestMarketCandleIndexUsesSymbolCollectionAndNewestFirstKey`

```go
// L1
if got := marketCandleCollection("BTC/USDT"); got != "market_candles_btc_usdt" { t.Fatalf(...) }
// L2
older := buildMatchCandleKey("BTC/USDT", 1_000)
// L3
newer := buildMatchCandleKey("BTC/USDT", 2_000)
// L4
if newer >= older { t.Fatalf(...) }
```

- `L1`：驗證交易標的會轉成獨立、可安全當作 collection 名稱的 key，避免不同 symbol 混在同一資料集。
- `L2`：建立較舊 timestamp 的 candle key。
- `L3`：建立較新 timestamp 的 candle key。
- `L4`：新 key 必須在字典排序上小於舊 key，因此 StorageList 預設由前往後讀時可先取得最新 candles。

## 10. `TestFinanceMatchmakingLeaseRecovery`

```go
// L1
now := time.Date(2026, time.July, 13, 12, 0, 0, 0, 0, time.UTC)
// L2
active := financeMatchmakingRecord{UserID: "user", Status: "matched", LeaseExpiresAt: now.Add(time.Minute).Format(time.RFC3339Nano)}
// L3
if _, changed := financeRecoverExpiredMatchmaking(active, now); changed { t.Fatal(...) }
// L4
expired := financeMatchmakingRecord{UserID: "user", Status: "matching", LeaseExpiresAt: now.Add(-time.Second).Format(time.RFC3339Nano)}
// L5
recovered, changed := financeRecoverExpiredMatchmaking(expired, now)
// L6
if !changed || recovered.Status != "idle" || recovered.UserID != "user" { t.Fatalf(...) }
```

- `L1`：固定現在時間，讓 lease 是否到期有明確基準。
- `L2`：建立仍有效一分鐘的 `matched` record。
- `L3`：有效 lease 不應被 recovery 提早清掉，否則已配對玩家可能被錯誤移出確認流程。
- `L4`：建立一秒前到期的 `matching` record。
- `L5`：呼叫 recovery，取得更新後 record 與是否真的變更的旗標。
- `L6`：過期 record 必須回到 `idle`，保留原始 user ID，並回報 `changed = true`。

## 11. `TestFinanceMetricsMergeAggregatesShards`

```go
// L1
total := financeSystemMetrics{OrderRejections: map[string]int64{}}
// L2
financeMergeMetrics(&total, financeSystemMetrics{MatchmakingStarts: 2, OrderRejections: map[string]int64{"market_stale": 1}, UpdatedAt: "2026-07-13T12:00:00Z"})
// L3
financeMergeMetrics(&total, financeSystemMetrics{MatchmakingStarts: 3, OrderRejections: map[string]int64{"market_stale": 2, "insufficient_cash": 1}, UpdatedAt: "2026-07-13T12:01:00Z"})
// L4
if total.MatchmakingStarts != 5 || total.OrderRejections["market_stale"] != 3 || total.OrderRejections["insufficient_cash"] != 1 { t.Fatalf(...) }
```

- `L1`：建立總計 metrics，並初始化拒單原因 map，避免合併時寫入 nil map。
- `L2`：加入第一個時間 shard：兩次配對開始、一次 `market_stale` 拒單。
- `L3`：加入第二個 shard：三次配對開始、兩次 stale 與一次現金不足拒單。
- `L4`：驗證數值加總與依原因的 map 合併都正確；這是管理員 metrics RPC 顯示統計的基礎。

## 12. 覆蓋範圍與限制

本檔測試財務精度、訊息上限、費率、行情 freshness、bootstrap 防護、idempotency 清理、market key、配對 lease 與 metrics 合併。它不會啟動真實 Nakama match、Socket、Storage 或 PostgreSQL；雙玩家流程、重新連線、實際 RPC 權限與 Docker plugin 載入仍需由 smoke/integration test 驗證。
