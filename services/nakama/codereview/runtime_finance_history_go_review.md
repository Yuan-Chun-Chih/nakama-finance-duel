# runtime_finance_history.go 逐行 Code Review

每段以 `L1`、`L2` 對照歷史、管理 metrics、arena 索引與行情 freshness 的關鍵行。

## 1. `rpcListFinanceHistoryHandler`
```go
// L1
userID, err := requireUserID(ctx); if err != nil { return "", err }
// L2
var input financeHistoryPayload; if err := parsePayload(payload, &input); err != nil { return "", err }
// L3
limit := clampInt(input.Limit, 1, financeHistoryPageSize)
// L4
records, cursor, err := nk.StorageList(ctx, userID, userID, collectionFinancePlayerHistory, limit, input.Cursor)
// L5
for _, record := range records { /* read completed game and project only this user's history */ }
// L6
return mustJSON(map[string]interface{}{ "stats": stats, "games": games, "cursor": cursor, "orders": orders, "fills": fills, "snapshots": snapshots }), nil
```
- `L1`：從 Nakama context 取得玩家 ID。
- `L2`：解析 cursor 與頁大小輸入。
- `L3`：將頁大小限制在後端範圍。
- `L4`：以 user-scoped player history collection 做 cursor pagination。
- `L5`：讀取完成對局並只投影該玩家可看的資料。
- `L6`：回傳 stats、分頁 games 與目前 arena 的 personal orders/fills/snapshots。

## 2. `rpcGetFinanceMetricsHandler`、`financeMetricsAdminAllowed`
```go
// L1
userID, err := requireUserID(ctx); if err != nil { return "", err }
// L2
if !financeMetricsAdminAllowed(userID) { return "", permissionDenied("Finance metrics access is restricted.") }
// L3
metrics, err := readFinanceMetrics(ctx, nk)
// L4
return mustJSON(map[string]interface{}{ "metrics": metrics }), nil
// L5
for _, adminID := range strings.Split(os.Getenv("FINANCE_METRICS_ADMIN_USER_IDS"), ",") { if strings.TrimSpace(adminID) == userID { return true } }; return false
```
- `L1`：取得呼叫管理 RPC 的 authenticated user。
- `L2`：非允許管理員直接拒絕，不讓 metrics 混入一般玩家 history。
- `L3`：聚合 metrics shards。
- `L4`：只回傳 metrics payload。
- `L5`：從環境變數逗號清單比對 user ID，空白會被清理。

## 3. `readFinanceArenaStatus`、filter helpers、`ensureFinanceArenaPlayer`
```go
// L1
snapshot, err := readFinanceSnapshot(ctx, nk, arenaID)
// L2
for _, order := range records { if order.UserID == userID { filtered = append(filtered, order) } }
// L3
if !financeHasPlayer(snapshot, userID) { return permissionDenied("You are not a player in this finance arena.") }
```
- `L1`：讀取 arena 最新 snapshot 取得狀態。
- `L2`：orders、fills、portfolio snapshots 都以同樣方式只保留 caller 自己的 record。
- `L3`：使用 snapshot players 驗證 caller 確實參與此 arena，防止猜測 arena ID 讀資料。

## 4. `financeAppendArenaIndex`、`appendUniqueStrings`、`readFinanceArenaIndex`
```go
// L1
index, err := readFinanceArenaIndex(ctx, nk, arenaID)
// L2
index.OrderIDs = appendUniqueStrings(index.OrderIDs, orderIDs)
// L3
index.FillIDs = appendUniqueStrings(index.FillIDs, fillIDs)
// L4
index.SnapshotKeys = appendUniqueStrings(index.SnapshotKeys, snapshotKeys)
// L5
nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceArenaIndex, Key: arenaID, UserID: "", Value: mustJSON(index), PermissionRead: 0, PermissionWrite: 0}})
```
- `L1`：讀目前 arena index。
- `L2`：加入新 order ID 並去重。
- `L3`：加入新 fill ID 並去重。
- `L4`：加入新 round snapshot key 並去重。
- `L5`：保存全域 server-only index，讓 history 不必掃描完整 collection。

## 5. `financeBackfillArenaIndex`、`listLegacyArenaKeys`
```go
// L1
keys, err := listLegacyArenaKeys(ctx, nk, collection, arenaID)
// L2
for _, key := range keys { /* classify order, fill, or snapshot key */ }
// L3
financeAppendArenaIndex(ctx, nil, nk, arenaID, orderIDs, fillIDs, snapshotKeys)
```
- `L1`：舊部署沒有 arena index 時，掃描 legacy collection 找該 arena key。
- `L2`：依 collection/key 將資料歸類成 order、fill 或 snapshot。
- `L3`：將回填結果保存成新 index，之後查詢不再重掃舊資料。

## 6. `readFinanceMaintenanceCursor`
```go
// L1
objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceMaintenance, Key: key, UserID: ""}})
// L2
if len(objects) == 0 || objects[0] == nil { return financeMaintenanceCursor{}, "", nil }
// L3
json.Unmarshal([]byte(objects[0].GetValue()), &cursor)
// L4
return cursor, objects[0].GetVersion(), nil
```
- `L1`：讀 maintenance cursor 全域 record。
- `L2`：不存在時回傳空 cursor 與空 version。
- `L3`：解碼保存的 cursor JSON。
- `L4`：回傳 cursor 與 version，供 cleanup CAS 寫入。

## 7. `listFinanceOrders`、`listFinanceFills`、`listFinancePortfolioSnapshots`
```go
// L1
index, err := readFinanceArenaIndex(ctx, nk, arenaID)
// L2
if index is empty { index, err = financeBackfillArenaIndex(ctx, nk, arenaID) }
// L3
objects, err := nk.StorageRead(ctx, readsBuiltFromIndex)
// L4
json.Unmarshal([]byte(object.GetValue()), &record)
```
- `L1`：先讀 arena index。
- `L2`：舊 arena 沒 index 時執行一次 backfill。
- `L3`：由 index key 批次精準讀取，不做全 collection scan。
- `L4`：將 storage JSON 還原為 order、fill 或 snapshot record。

## 8. `readFinanceBTCPrice`、`financePriceRecordIsStale`、`financePriceIsStale`
```go
// L1
record, err := readMatchPriceFeed(ctx, nk, "BTC/USDT")
// L2
return record, financePriceRecordIsStale(record), err
// L3
if record.Source == "bootstrap" { return true }
// L4
updatedAt, err := time.Parse(time.RFC3339, updatedAtString)
// L5
return err != nil || time.Since(updatedAt) > financeMarketStaleAfter
```
- `L1`：從後端 market price feed 讀 BTC/USDT。
- `L2`：同時回傳 record 與 stale 結果。
- `L3`：bootstrap 假行情永遠不可交易，即使時間很新。
- `L4`：解析 server 保存的更新時間。
- `L5`：無法解析或超過 stale 閾值都視為過期。
