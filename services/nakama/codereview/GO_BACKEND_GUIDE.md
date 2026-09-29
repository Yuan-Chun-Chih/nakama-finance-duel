# Go 後端程式導讀與 Code Review

本文件直接引用目前 services/nakama 後端的重點 function，依檔案由上到下說明 Go 語法、Nakama 流程、QueueToken、storage、交易與可 review 的風險。

## 1. Go 檔案結構與基本語法

### package、import、func

~~~
package main

import (
    "context"
    "database/sql"
    "time"
)

func requireUserID(ctx context.Context) (string, error) {
    ...
}
~~~

- package main：同一個 Go package。拆成多個 .go 檔仍可直接共用同 package 的 type 和 function。
- import (...)：匯入套件。context.Context 管理 request 生命週期；database/sql 保留 Nakama handler 的 DB 參數；time 處理 UTC 時間。
- func：宣告函式。
- ctx context.Context：參數名稱在前、型別在後。
- (string, error)：多重回傳值；呼叫端通常先檢查 error。
- *T：pointer，指向 T。
- interface：例如 runtime.NakamaModule，代表可提供指定方法的介面。
- _：blank identifier，刻意忽略不使用的參數或回傳值。
- nil：pointer、map、slice、interface 或 error 的空值。

### 變數、條件與集合

~~~
now := time.Now().UTC()
value, ok := params[key]
if !ok {
    return ""
}
for _, entry := range entries {
    ...
}
~~~

- :=：function 內的短變數宣告；=：既有變數賦值。
- value, ok := map[key]：comma-ok pattern，分辨 key 是否存在。
- if 條件 {}：條件不需要括號。
- for：Go 唯一的迴圈語法；range 可逐一讀取 slice/map。
- append(slice, item)：追加 slice。
- map[string]bool：key 是 string，value 是 bool。
- return：結束函式並回傳指定值。

### struct 與 JSON tag

~~~
type financePortfolio struct {
    CashCents      int64 `json:"cashCents"`
    QuantityMicros int64 `json:"quantityMicros"`
}
~~~

- type ... struct：定義資料模型。
- int64：固定寬度整數，適合 cents 和 BTC micros，避免 float64 的金額誤差。
- JSON tag 將 Go 欄位對應到前後端使用的 JSON 名稱。
- 名稱首字母小寫是 package 內部使用；首字母大寫才會 exported。

## 2. runtime.go：Nakama 啟動入口

### InitModule

runtime.go 的 InitModule 是 Go runtime 啟動入口：

~~~
func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB,
    nk runtime.NakamaModule, initializer runtime.Initializer) error
~~~

它主要負責：

1. 建立或註冊 leaderboard。
2. 用 initializer.RegisterRpc 把 RPC 名稱連到 handler。
3. 用 initializer.RegisterMatch 把 finance_authoritative_match 連到 financeAuthoritativeMatch。
4. 將 runtime function 暴露給 Nakama，而不是讓前端直接呼叫 Go function。

Code review：新增 RPC 時要同時檢查 runtime_config.go 的名稱、InitModule registry、前端 RPC id 和部署環境設定。

### stringParam、stringSetParam

這兩個 helper 從 map[string]interface{} 讀取 match 建立參數。value.(string) 是 type assertion；第二個回傳值 ok 用來確認型別是否正確。stringSetParam 另將輸入轉成去重集合，避免同一個 player 或 group 重複處理。

## 3. runtime_config.go：規則與通訊契約

const (...) 集中保存不應任意變動的規則：

~~~
financeBTCScale                 = int64(1000000)
financeInitialCashCents         = int64(100000000)
financeRoundTicks               = int64(10)
financeMatchTicks               = int64(300)
financeCountdownTicks           = int64(3)
financeConfirmationTicks        = int64(30)
financePriceMaxAgeSeconds       = int64(30)
matchTakerFeeBps                = 8
matchTaxBps                     = 10
financeStatsCASRetries          = 4
financeIdempotencyRetention     = 24 * time.Hour
financeMetricsShardCount        = 16
~~~

- financeBTCScale：1 BTC = 1,000,000 micros。
- financeInitialCashCents：初始資金以 cents 儲存。
- 每秒一 tick；300 tick 是 5 分鐘，10 tick 是一回合，3 tick 是開局倒數。
- financeConfirmationTicks 是配對確認期限 30 秒。
- matchTakerFeeBps = 8：8 / 10000 = 0.08%。
- matchTaxBps = 10：10 / 10000 = 0.10%。
- CASRetries 限制並行更新的重試次數。
- idempotencyRetention 決定冪等記錄何時可清理。
- metricsShardCount 將高併發 metrics 拆成 16 個 shard，降低單一 hot key 競爭。

同一區也定義 finance RPC 名稱、WebSocket opcode 220 到 227，以及 finance_games、finance_orders、finance_fills 等 storage collection。

Code review：金額不要改成 float；不要在 function 裡新增未命名的 fee、tax 或 timeout magic number。

## 4. runtime_finance_models.go：server state

### financeAuthoritativeMatchState

這是 authoritative 對局的單一 server state：

~~~
type financeAuthoritativeMatchState struct {
    ArenaID            string
    Presences          map[string]runtime.Presence
    Players            []string
    Portfolios         map[string]*financePortfolio
    Orders             map[string]*financeOrder
    Ready              map[string]bool
    Tick               int64
    Round              int
    Status             string
    PriceCents         int64
    MarketStale        bool
    ConfirmationDeadline int64
    StateVersion       int64
}
~~~

- Presences：玩家 WebSocket 是否在線。
- Players：後端認可的對局玩家。
- Portfolios、Orders：server 內部交易狀態。
- Ready、Status、Round、Tick：只能由 server 更新。
- MarketStale：行情是否超過 freshness deadline。
- StateVersion：snapshot 版本，協助前端判斷新舊資料。
- map 必須先初始化才能寫入；nil map 寫入會 panic。
- &financeAuthoritativeMatchState{} 建立 pointer，讓 match handler 修改同一份 state。

### financeOrder、financeFillRecord、snapshot

- financeOrder：訂單 lifecycle，包含 open、filled、partial、canceled、rejected。
- financeFillRecord：成交明細，包含價格、數量、名目金額、fee、tax、slippage；成交後不應覆寫。
- financePortfolioSnapshotRecord：每回合 portfolio projection。
- financeGameRecord：最終對局、finish reason、winner 和 rating。
- projection 與 append-only event 分開：projection 方便查詢，event 用於稽核和 replay。

### QueueToken：配對版本識別碼

~~~
type financeMatchmakingRecord struct {
    UserID          string `json:"userId"`
    Status          string `json:"status"`
    MatchID         string `json:"matchId,omitempty"`
    QueueToken      string `json:"queueToken,omitempty"`
    SearchStartedAt string `json:"searchStartedAt,omitempty"`
    LeaseExpiresAt  string `json:"leaseExpiresAt,omitempty"`
}
~~~

begin 時通常用下式產生：

~~~
fmt.Sprintf("%s:%d", userID, now.UnixNano())
~~~

- %s 插入 userID；%d 插入 Unix nanoseconds；冒號只是分隔符。
- QueueToken 不是密碼，也不是 match ID。
- 它代表「這一次 begin request 的版本」。
- 若玩家取消後重新 begin，會有新 token；舊 matchmaker callback 的 token 就失效。
- claimFinanceMatchmaking 會比較 storage 中的 token，只有仍相同才准許 claim。
- 這是 compare-and-set 的版本檢查，避免 cancel、retry、matchmaker callback race 造成重複配對。
- LeaseExpiresAt 則限制 matched/running 狀態的最長生命週期，避免 crash 後永久卡住。

### metrics 與冪等模型

financeSystemMetrics 保存配對開始、匹配玩家、等待秒數、完成局數、stale 秒數和 order rejection map。

financeOrderIdempotencyRecord 保存：

- arenaID、userID、clientOrderID。
- 後端真正建立的 orderID。
- status 和 reason。
- ExpiresAt 和 UpdatedAt。

clientOrderID 讓同一筆前端意圖可安全重試；後端重送時應回傳既有結果，而不是再次成交。

## 5. runtime_rpc_helpers.go：RPC 共用安全層

### requireUserID

~~~
userID, err := requireUserID(ctx)
if err != nil {
    return "", err
}
~~~

Nakama 將登入身份放在 context。requireUserID 應優先於 payload userID；前端不能靠 payload 偽造另一個玩家。

### parsePayload[T any]

~~~
func parsePayload[T any](payload string, target *T) error
~~~

- [T any] 是 Go 泛型型別參數；T 可是任意型別。
- *T 表示 JSON 解析目標的 pointer。
- 空 payload 或 JSON 格式錯誤會回傳 error。

### 錯誤 helper

invalidArgument、notFound、permissionDenied、failedPrecondition、outOfRange、unauthenticated 將錯誤映射為 Nakama/gRPC status。前端可依 status 區分輸入錯誤、無權限、資源不存在和前置條件不成立。

## 6. Finance runtime：由上到下的主流程

Finance runtime 已拆分為五個同屬 `package main` 的檔案：`runtime_finance_matchmaking.go`、`runtime_finance_match.go`、`runtime_finance_orders.go`、`runtime_finance_persistence.go`、`runtime_finance_history.go`。以下依責任說明流程，完整實際 function 順序請以 [FUNCTION_REVIEW_ORDER.md](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/codereview/FUNCTION_REVIEW_ORDER.md) 為準。

### financeMatchmakerMatched

它接收 Nakama matchmaker 選出的 entries：

~~~
if len(entries) != 2 {
    return "", nil
}
sort.Slice(entries, func(i, j int) bool {
    return entries[i].GetCreateTime() < entries[j].GetCreateTime()
})
~~~

- len(entries) != 2：第一版只接受兩人。
- sort.Slice：依建立時間排序，實作先進先配。
- entry.GetPresence().GetUserId()：取得 Nakama presence 的 user ID。
- entry.GetProperties()：讀取 matchmaker ticket properties，例如 gameType、queueToken。
- claimFinanceMatchmaking：先用 token claim storage。
- nk.MatchCreate：建立 authoritative room。
- 成功後將雙方 status 寫成 matched，保存 matchID 和 lease。
- 任何建立失敗都應恢復 matchmaking record，避免使用者卡在 active 狀態。

### claimFinanceMatchmaking

它讀取兩位玩家的 finance_matchmaking records，確認：

1. record 存在。
2. Status 仍是 searching。
3. QueueToken 與 callback 內的 token 相同。
4. 使用 storage version 做 CAS 寫入。

CAS 的意思是「只有資料版本仍符合預期才寫入」。若另一個 request 先取消或已 claim，StorageWrite 會失敗，舊 callback 不能覆蓋新狀態。

### MatchInit

MatchInit 建立 financeAuthoritativeMatchState、expected players、空的 presences、portfolios、orders 和 ready map，讀取 server BTC price，再以 tick rate 啟動 MatchLoop。

~~~
state := &financeAuthoritativeMatchState{
    ArenaID: arenaID,
    Players: expectedPlayers,
    Presences: map[string]runtime.Presence{},
    Portfolios: map[string]*financePortfolio{},
    Status: "waiting",
}
~~~

& 是取址，map literal 建立可寫入的 map，冒號是 struct field initializer。

### MatchJoinAttempt、MatchJoin、MatchLeave

- MatchJoinAttempt：檢查 expected player、最多兩人與重連資格；回傳 state、allowed、reason。
- MatchJoin：將 runtime.Presence 放入 state.Presences；首次加入建立 portfolio，重連時 directed send snapshot。
- MatchLeave：移除 presence、保存 disconnect tick；running 對局保留 reconnect grace period，不立即判負。

### MatchLoop

MatchLoop 每秒執行，主要順序：

1. bounded cleanup：有限量清理 idempotency/candle records。
2. 消費 WebSocket messages。
3. financeRefreshPrice：重新讀取價格與 stale 狀態。
4. 處理雙方確認、開局 countdown 和 round timer。
5. 處理 open orders。
6. financePersistRoundPortfolios：保存每回合投組 snapshot。
7. 處理斷線 grace period。
8. 五分鐘到期時 financeFinish。
9. financeBroadcastState 廣播 projection。

Go 的 for _, message := range messages 會遍歷本 tick 的所有 message；_ 忽略 index。

### financeHandleMessage

依 message.GetOpCode() 將前端意圖分派到：

- financeReadyOpCode：Ready。
- financeOrderOpCode：下單。
- financeCancelOpCode：取消自己的訂單。
- financeStateRequestOpCode：要求 snapshot。
- financeResignOpCode：投降。
- financeMatchCancelOpCode：取消未完成對局。

未知 opcode 必須拒絕。前端只送 intent，不能送 cash、NAV、winner 或 fill 結果。

### financeAcceptOrder

它是下單的 authoritative validation boundary：

1. user 必須屬於對局。
2. status 必須允許交易。
3. MarketStale 不可下新單。
4. side、orderType、quantity、limitPrice 必須合法。
5. buy 不可超過可用現金；sell 不可超過可用 BTC。
6. 不能放空、槓桿或越過 position limit。
7. 檢查 clientOrderID 的 idempotency record。
8. 建立 server order ID，再交給 financeTryFillOrder。

前端的 slider 只改善體驗；真正安全檢查仍在這裡。

### financeTryFillOrder

成交計算使用整數：

~~~
notional = quantityMicros * priceCents / financeBTCScale
fee = ceil(notional * matchTakerFeeBps / 10000)
tax = sell side 時依 matchTaxBps 計算
~~~

實作會使用 calculateBpsCeil，避免 float rounding。

- Market 單以 server reference price 加滑價成交。
- Limit 單條件未到時保持 open。
- buy 更新 cash、quantity、average cost。
- sell 更新 cash、quantity、realized P&L。
- 建立 fill record，寫入 finance_fills。
- 更新 order lifecycle，寫入 finance_orders。
- 保存 idempotency 結果並廣播 state/event。

### financeRefreshPrice、financeMarkPortfolios

- financeRefreshPrice 讀取帶 UpdatedAt 的 match_price_feed，更新 PriceCents、MarketStale、StaleMarketSeconds。
- financePriceIsStale 在 timestamp 無效或超過 30 秒時回傳 true。
- financeMarkPortfolios 以 current price 重算 unrealized P&L、NAV、returnBps。
- NAV = cash + position market value；未實現損益尚未賣出，不能當作 realized P&L。

### financeBroadcastState

它把內部 state 轉成 player-specific projection：

- 自己收到完整 portfolio。
- 對手只收到名稱、連線狀態和模糊化領先狀態。
- 雙方收到 round、timer、server price、stale、StateVersion 和事件摘要。
- dispatcher.BroadcastMessage 將資料送到 match socket。

刷新頁面後前端會重新 join/reconnect，後端依目前 state 產生 snapshot，再透過 WebSocket 回傳。因此同步來源是 server，不是瀏覽器原本的 React state。

### financeFinish

對局結束時：

1. 關閉或取消未完成訂單。
2. 以 server price 固化 portfolio。
3. financeNAVWinners 比較 NAV，決定 winner 或 draw。
4. persistFinanceGameAndStats 保存 game、stats、rating、history。
5. 設定 finishReason。
6. 廣播 finished snapshot 和 event。

## 7. storage、projection、metrics

### financeAppendEvent

事件 key 使用 sequence：

~~~
fmt.Sprintf("%s:%06d", state.ArenaID, sequence)
~~~

- %06d 固定六位數，讓字典排序接近事件順序。
- 事件先寫 storage，再廣播。
- event 是 append-only audit log；game、order、fill、portfolio 是不同 projection。

### financePersistSnapshot、financePersistOrder、financePersistFill

- snapshot：保存單場最新 projection，供 reconnect/resume。
- order：覆寫一筆訂單的 lifecycle 最新狀態。
- fill：以唯一 fill ID 保存成交，不應覆寫。
- financeAppendArenaIndex：保存 arena 內 orders、fills、snapshots 的索引，history RPC 不必掃全庫。

### persistFinanceGameAndStats

以 CAS retry 更新：

- games、wins、losses、draws。
- Finance rating 和 rating delta。
- 累積與最佳 return。
- completed game record。
- 個人 history index。

若 CAS 失敗要重讀最新 projection，而不是直接覆蓋其他對局的結果。

### financeUpdateMetrics、rpcGetFinanceMetricsHandler

financeUpdateMetrics 將資料寫到 16 個 metrics shards；readFinanceMetrics 讀出後由 financeMergeMetrics 合併。

rpcGetFinanceMetricsHandler：

1. requireUserID 取得登入身份。
2. financeMetricsAdminAllowed 檢查 allowlist。
3. 非管理員回傳 PERMISSION_DENIED。
4. 管理員取得等待時間、stale 秒數、完成局數和 order rejection distribution。

正式環境的 allowlist 應由 environment/secret 注入，不應把 admin ID 寫死在 source。

## 8. runtime_market.go：行情流程

### rpcIngestMatchCandlesHandler

這是 server-to-server 行情入口：

1. 驗證 ingestion secret。
2. parsePayload。
3. validateMatchCandle 驗證 OHLCV、volume、timestamp。
4. marketCandleCollection 依 symbol 選 collection。
5. buildMatchCandleKey 建立可排序 key。
6. storageWriteOne 寫入 candle 和最新 price feed。
7. bounded retention cleanup。

### rpcListMatchCandlesHandler、listMarketCandles

前端只能透過 RPC 讀 server storage，不能直接連交易所。listMarketCandles 依 symbol collection 和時間 key 讀取最近 candles；legacy helper 只保留給舊資料遷移。

### applyMatchSlippage

~~~
executedPrice, slippage := applyMatchSlippage(price, side)
~~~

:= 同時宣告兩個回傳變數；multiple return 可一次回傳成交價與滑價。買賣方向決定滑價正負，但實際費用仍由後端常數與整數運算決定。

## 9. 完整 function 順序索引

本文件前面的章節以核心流程為主，並非逐一展開所有 function。完整的目前 source function 清單、檔案順序、行號、宣告與責任摘要，請參閱 [FUNCTION_REVIEW_ORDER.md](/C:/Users/kdsam/Documents/nakama-duel/services/nakama/codereview/FUNCTION_REVIEW_ORDER.md)。該文件會涵蓋 `services/nakama` 所有 Go 檔案，包含 community、market、RPC helper、finance、models 與 test。

Code review 應先依該索引由上到下確認每個 function，再回到本文件閱讀語法、資料邊界與安全性說明。

## 10. 測試與 Code Review

runtime_finance_test.go 直接驗證：

- BTC micros precision。
- fee、tax、slippage basis points。
- price freshness。
- idempotency retention cleanup。
- candle collection/index key。
- matchmaking lease recovery。
- metrics shard merge。

建議每次修改後執行：

~~~
cd C:\Users\kdsam\Documents\nakama-duel\services\nakama
gofmt -w runtime*.go
go test ./...
go vet ./...
~~~

Review 清單：

1. RPC 是否用 requireUserID，而不是相信 payload user ID？
2. 金額是否使用 cents/micros 整數？
3. retry 是否具備 idempotency？
4. Storage list 是否有 cursor 與上限？
5. client 是否只能提交 intent？
6. 對手資訊是否經過 player-specific projection？
7. metrics、audit、game record 是否分離？
8. QueueToken、lease、CAS 是否測試 cancel/match callback race？
9. 新增 function 是否在宣告前有中文註解？
10. retention、secret、admin permission 是否有明確 policy？

## 11. 後續架構建議

1. 持續檢查五個 finance runtime 檔案的責任邊界，必要時再拆出獨立 admin RPC 與 maintenance worker。
2. 集中 storage collection/key helper，避免字串散落。
3. 為 event、order、fill、stats 增加 schema version。
4. 將 maintenance 從 match tick 移到獨立 worker，避免 cleanup 影響每秒 loop。
5. 為 admin metrics 加 audit event，記錄誰在何時讀取營運資料。
