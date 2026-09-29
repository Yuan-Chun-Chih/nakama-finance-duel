# runtime_maintenance.go 逐段 Code Review

本檔負責 Finance 後端的背景維護協調。它不保存玩家對局 state，也不直接決定交易結果；它只確保「同一份可重試／可清理的工作」不會被多個 match 或多個 Nakama 節點同時大量執行。

## 1. 什麼是全域 Storage lease

全域 Storage lease 是一筆保存在 Nakama Storage 的短期租約 record。它的範圍是整個 Nakama backend，不屬於某一名玩家，也不屬於某一場 arena：

```text
collection: finance_maintenance
user ID:    ""
key:        lease:<maintenance task key>
value:      { "leaseUntil": "...", "updatedAt": "..." }
```

`UserID: ""` 代表全域 server record。因此不論有多少 finance match、多少玩家，甚至未來有多少 Nakama 節點，都會讀寫同一筆 lease key。

以 `idempotency_cleanup` 為例：

```text
Match A 到第 60 tick
  -> 嘗試寫 lease:idempotency_cleanup

Match B 同時到第 60 tick
  -> 同樣嘗試寫 lease:idempotency_cleanup

Storage CAS
  -> 只有一方寫入成功，取得 55 秒 lease
  -> 另一方讀到有效 lease 或 CAS version 衝突，不執行清理

取得 lease 的執行者
  -> 清理一小批已過期 idempotency records
```

這不是永久 mutex。持有者在租約到期後，即使它因 crash、網路錯誤或 process 終止而沒有釋放，其他執行者仍可接手，避免背景工作永久卡住。

目前 lease 相關常數位於：[runtime_config.go](../runtime_config.go:75)

```go
financeMaintenanceIntervalTicks = int64(60)
financeMaintenanceLeaseDuration = 55 * time.Second
```

- 每 60 個 tick 才嘗試一次，避免每秒都掃 Storage。
- match tick rate 是每秒一次，因此正常情況約每分鐘執行一次。
- lease 是 55 秒，略短於 60 秒間隔；正常執行者還持有租約時，不會被下一輪例行維護重複取得。

## 2. import

```go
// L1
import "context"
// L2
import "encoding/json"
// L3
import "time"
// L4
import "github.com/heroiclabs/nakama-common/runtime"
```

- `L1`：`context.Context` 攜帶 Nakama request／match 的生命週期；工作若被取消，Storage API 可停止。
- `L2`：將 lease record 與 pending leaderboard projection 的 JSON 還原成 Go struct。
- `L3`：建立 UTC 現在時間、計算租約期限與使用 `time.Duration`。
- `L4`：使用 Nakama 的 `StorageRead`、`StorageWrite`、`StorageList` 型別與 `NakamaModule` API。

## 3. `financeMaintenanceLeaseRecord`

```go
// L1
type financeMaintenanceLeaseRecord struct {
// L2
    LeaseUntil string `json:"leaseUntil"`
// L3
    UpdatedAt  string `json:"updatedAt"`
// L4
}
```

- `L1`：定義要保存到 `finance_maintenance` collection 的 lease JSON 結構。
- `L2`：`LeaseUntil` 是 RFC3339Nano UTC 字串；其他執行者會解析它，判斷目前租約是否仍有效。
- `L3`：`UpdatedAt` 記錄本次寫入時間，主要用於稽核、debug 與判讀 maintenance 是否持續運作。
- `L4`：struct 結束。這個 record 不包含「持有者 ID」，因為目前需求只需要排他執行，不需要 owner renew/release protocol。

## 4. `financeRunMaintenanceTask`

```go
// L1
func financeRunMaintenanceTask(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, key string, leaseDuration time.Duration, task func()) {
// L2
    acquired, err := financeTryAcquireMaintenanceLease(ctx, nk, key, leaseDuration, time.Now().UTC())
// L3
    if err != nil {
// L4
        logger.Warn("Finance maintenance lease failed task=%s: %v", key, err)
// L5
        return
// L6
    }
// L7
    if acquired {
// L8
        task()
// L9
    }
// L10
}
```

- `L1`：這是所有維護工作的共用入口；呼叫者傳入工作 key、租約長度與真正要執行的 `task`。
- `L2`：使用目前 UTC 時間競爭 lease。回傳 `acquired` 表示目前執行者是否成為唯一持有者。
- `L3`：Storage read/write 發生錯誤時進入錯誤處理。
- `L4`：只記錄 warning，不讓 maintenance 錯誤中斷正在執行的 finance match。
- `L5`：無法確定是否取得 lease 時，採安全策略：不執行 task。
- `L6`：錯誤處理結束。
- `L7`：只有 `acquired == true` 才可進入真正工作。
- `L8`：執行小批次清理或 outbox retry。其他競爭者會直接跳過這一步。
- `L9`：未取得 lease 時沒有 else；這是正常競爭結果，不需要寫錯誤。
- `L10`：函式結束。

此函式本身不會釋放 lease。租約以時間自然失效，避免持有者在 crash 後留下永久鎖。

呼叫位置：

- [MatchLoop](../runtime_finance_match.go:132)：定期觸發 idempotency cleanup 與 leaderboard outbox retry。
- [cleanupMarketIngestNonces](../runtime_market.go:162)：使用同樣概念協調市場 nonce cleanup。

## 5. `financeTryAcquireMaintenanceLease`

```go
// L1
func financeTryAcquireMaintenanceLease(ctx context.Context, nk runtime.NakamaModule, key string, duration time.Duration, now time.Time) (bool, error) {
// L2
    storageKey := "lease:" + key
// L3
    objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceMaintenance, Key: storageKey, UserID: ""}})
// L4
    if err != nil { return false, err }
// L5
    version := "*"
// L6
    if len(objects) > 0 && objects[0] != nil && objects[0].GetValue() != "" { ... }
// L7
    record := financeMaintenanceLeaseRecord{LeaseUntil: now.Add(duration).Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano)}
// L8
    if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceMaintenance, Key: storageKey, UserID: "", Value: mustJSON(record), Version: version, PermissionRead: 0, PermissionWrite: 0}}); err != nil { return false, err }
// L9
    return true, nil
// L10
}
```

- `L1`：嘗試取得指定 maintenance task 的 lease；成功回傳 `true`，已有有效持有者回傳 `false, nil`，Storage 失敗才回傳 error。
- `L2`：以 `lease:` 前綴和 task 名稱組成 key，例如 `lease:idempotency_cleanup`。它與同 collection 的 cursor key 分開，避免互相覆寫。
- `L3`：讀取全域 Storage record。`UserID: ""` 表示這不是某位玩家私有資料，所有 backend node 都看同一筆資料。
- `L4`：讀取失敗不猜測狀態，交給外層安全地跳過本次 task。
- `L5`：預設 version 為 `"*"`，代表預期這筆 lease record 尚不存在，嘗試以 create-only CAS 寫入。
- `L6`：如果 record 已存在，改用目前 Storage version 進行 compare-and-swap；這是競爭安全的關鍵。
- `L7`：建立新的 lease，到期時間等於 `now + duration`。所有時間都格式化為 RFC3339Nano，保留足夠精度。
- `L8`：以剛讀到的 version 寫入。若兩個節點都讀到同一舊 version，只有第一個成功寫入；另一個會收到 version conflict error。
- `L9`：寫入成功代表目前執行者正式取得 lease。
- `L10`：函式結束。

### 5.1 已存在 record 時的有效租約判定

```go
// L1
version = objects[0].GetVersion()
// L2
var record financeMaintenanceLeaseRecord
// L3
if json.Unmarshal([]byte(objects[0].GetValue()), &record) == nil {
// L4
    if leaseUntil, parseErr := time.Parse(time.RFC3339Nano, record.LeaseUntil); parseErr == nil && leaseUntil.After(now) {
// L5
        return false, nil
// L6
    }
// L7
}
```

- `L1`：取得目前 record 的 Storage version。後續寫入只能在 version 尚未變動時成功。
- `L2`：建立接收 JSON 的 lease record 變數。
- `L3`：如果 JSON 可解析，才檢查它的期限。
- `L4`：解析 `LeaseUntil`；只有「格式正確且晚於 now」才代表 lease 有效。
- `L5`：已有其他執行者持有未到期 lease，所以本次不做工作。這不是錯誤，故 error 為 `nil`。
- `L6`：若 lease 已到期，程式繼續往下建立新 lease。
- `L7`：若 JSON 無法解析，也不永久阻塞；後續 CAS 寫入會嘗試取代壞 record。

### 5.2 競爭情境

```text
Node A 與 Node B 同時讀到 version = v10、lease 已過期
  A 寫入 Version: v10 -> 成功，Storage version 變 v11
  B 寫入 Version: v10 -> 失敗，因為目前已是 v11
  A 執行 task
  B 回傳 error，由外層記錄 warning 並跳過 task
```

因此 lease 的排他性不是靠 Go 記憶體 map，而是由 Nakama Storage 的 version CAS 保證。這也是它能跨多場 match、跨 process、跨 node 生效的原因。

## 6. `financeRetryPendingLeaderboardProjections`

```go
// L1
func financeRetryPendingLeaderboardProjections(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule) {
// L2
    objects, _, err := nk.StorageList(ctx, "", "", collectionFinanceLeaderboardProjection, 20, "")
// L3
    if err != nil { logger.Warn("Finance leaderboard projection list failed: %v", err); return }
// L4
    for _, object := range objects {
// L5
        if object == nil || object.GetValue() == "" { continue }
// L6
        var projection financeLeaderboardProjectionRecord
// L7
        if json.Unmarshal([]byte(object.GetValue()), &projection) != nil || projection.ArenaID == "" { logger.Warn(...); continue }
// L8
        if err := projectFinanceLeaderboardRecord(ctx, nk, projection); err != nil { logger.Warn(...) }
// L9
    }
// L10
}
```

- `L1`：定義 outbox retry 工作；它只處理上次結算已保存、但排行榜投影尚未成功的資料。
- `L2`：從 `finance_leaderboard_projection` 全域 collection 讀取最多 20 筆 pending records。固定小批次避免 maintenance 一次佔用過多 Storage／CPU。
- `L3`：列出失敗時記錄 warning 並結束本輪；outbox record 保留，因此下次 lease 成功時還會重試。
- `L4`：逐筆處理 pending projection。
- `L5`：空物件或沒有 JSON value 的 record 直接略過，避免 nil pointer 或無意義反序列化。
- `L6`：建立 Go struct 接收 projection JSON。
- `L7`：JSON 不合法或缺少 `ArenaID` 時記錄 warning 並跳過該筆，避免壞資料阻塞同一批其他有效資料。
- `L8`：呼叫真正的 leaderboard projection。失敗時只記 warning，不刪除 outbox，因此可在下一輪重試。
- `L9`：結束迴圈。
- `L10`：函式結束。

相關位置：

- [financeLeaderboardProjectionRecord](../runtime_finance_models.go:256)：outbox 資料結構。
- [persistFinanceGameAndStats](../runtime_finance_persistence.go:284)：結算時同批寫入 game、stats、history 與 outbox。
- [projectFinanceLeaderboardRecord](../runtime_community_score.go:181)：實際寫入 Nakama leaderboard，成功後刪除 outbox record。

## 7. lease 的範圍、優點與限制

### 它保證什麼

- 同一 task key 在有效 lease 期間，正常情況只有一個執行者會開始工作。
- 持有者 crash 後，租約到期可被其他執行者接手。
- `UserID: ""` 加上固定 collection/key，使 lease 對所有玩家與所有 arena 共用。
- CAS 防止兩個節點同時讀到「可用」狀態後都成功取得 lease。

### 它不保證什麼

- 它不是分散式 transaction，不能讓 Storage delete、cursor write、leaderboard API 寫入變成同一筆原子操作。
- 它沒有 owner ID 或 renew 機制；task 若執行超過 lease duration，另一個執行者理論上可能在租約到期後接手。
- 它不會自動補償 task 內部的部分成功。這就是 cleanup cursor、Storage version、outbox 與冪等 projection 仍然存在的原因。
- 它目前只保護「maintenance task」；玩家下單與 match state 仍由單一 authoritative match handler 順序處理。

目前 task 都採小批次，例如 leaderboard retry 每次最多 20 筆、idempotency cleanup 有 batch size，因此正常執行時間應遠小於 55 秒。若未來工作量提高，應採以下其中一種改善：縮小 batch、延長 lease、加入 owner token + lease renewal，或把工作移到獨立 worker。

## 8. 關聯的清理流程

```text
MatchLoop 每 60 ticks
  -> financeRunMaintenanceTask("idempotency_cleanup", 55 秒, cleanup task)
  -> financeRunMaintenanceTask("leaderboard_projection_retry", 55 秒, retry task)

取得 lease 的唯一執行者
  -> 讀取 cursor / outbox 小批次
  -> 執行 Storage delete 或 leaderboard projection
  -> 保存下一頁 cursor，或保留失敗 outbox

未取得 lease 的其他 match/node
  -> 不做任何維護寫入
  -> 等下一個 maintenance interval 再嘗試
```

關聯程式位置：

- [MatchLoop maintenance trigger](../runtime_finance_match.go:141)
- [financeCleanupExpiredIdempotency](../runtime_finance_persistence.go:109)
- [financeIdempotencyCleanupPage](../runtime_finance_persistence.go:135)
- [cleanupMarketIngestNonces](../runtime_market.go:162)
- [financeRetryPendingLeaderboardProjections](../runtime_maintenance.go:91)
