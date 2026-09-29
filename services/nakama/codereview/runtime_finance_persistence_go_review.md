# runtime_finance_persistence.go 逐行 Code Review

每段以 `L1`、`L2` 對照持久化關鍵行；此檔負責 event、snapshot、冪等鍵、metrics、fill、round snapshot、戰績與 rating projection。

## 1. `financeAppendEvent`
```go
// L1
state.EventSequence++
// L2
record := financeEventRecord{ArenaID: state.ArenaID, Sequence: state.EventSequence, Type: eventType, ActorUserID: actorUserID, Detail: detail, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
// L3
nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceEvents, Key: fmt.Sprintf("%s:%06d", state.ArenaID, record.Sequence), UserID: "", Value: mustJSON(record), PermissionRead: 0, PermissionWrite: 0}})
// L4
dispatcher.BroadcastMessage(financeEventOpCode, []byte(mustJSON(map[string]interface{}{ "kind": "finance_event", "event": record })), nil, nil, true)
```
- `L1`：增加 arena 內單調遞增 event sequence。
- `L2`：建立含 server UTC 時間的 append-only event record。
- `L3`：以 arena 加零補齊 sequence 作唯一全域 storage key，禁止 client 讀寫。
- `L4`：將同一 event 即時廣播給 match 內玩家。

## 2. `financePersistSnapshot`、`financePersistOrder`、`financePersistFill`
```go
// L1
nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceSnapshots, Key: state.ArenaID, UserID: "", Value: mustJSON(state), PermissionRead: 0, PermissionWrite: 0}})
// L2
nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceOrders, Key: order.ID, UserID: "", Value: mustJSON(map[string]interface{}{ "arenaId": arenaID, "order": order }), PermissionRead: 0, PermissionWrite: 0}})
// L3
nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceFills, Key: fill.ID, UserID: "", Value: mustJSON(fill), PermissionRead: 0, PermissionWrite: 0}})
```
- `L1`：以 arena ID 覆寫最新 authoritative match snapshot，供 resume/history 查詢。
- `L2`：以 order ID 覆寫訂單最新狀態，保留 arena 關聯。
- `L3`：以 fill ID 寫入成交明細；fill 是不可變紀錄。

## 3. `financeOrderIdempotencyKey`、`readFinanceOrderIdempotency`、`financePersistOrderIdempotency`
```go
// L1
return fmt.Sprintf("%s:%s:%s", arenaID, userID, strings.TrimSpace(clientOrderID))
// L2
objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceOrderIdempotency, Key: key, UserID: ""}})
// L3
nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceOrderIdempotency, Key: key, UserID: "", Value: mustJSON(record), PermissionRead: 0, PermissionWrite: 0}})
```
- `L1`：冪等 key 綁定 arena、authenticated user 與 client order ID，避免跨玩家重複使用。
- `L2`：下單前讀取既有結果；存在時回傳原 order outcome 而非再成交。
- `L3`：將最近 order 結果與過期時間保存為 server-only record。

## 4. `financeCleanupExpiredIdempotency`、`financeIdempotencyCleanupPage`
```go
// L1
objects, nextCursor, err := nk.StorageList(ctx, "", "", collectionFinanceOrderIdempotency, financeIdempotencyCleanupPageSize, cursor)
// L2
deletes, next := financeIdempotencyCleanupPage(objects, nextCursor, now)
// L3
nk.StorageDelete(ctx, deletes)
// L4
nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceMaintenance, Key: financeIdempotencyMaintenanceKey, UserID: "", Value: mustJSON(next), PermissionRead: 0, PermissionWrite: 0}})
```
- `L1`：以 cursor 有界分頁讀取 idempotency collection，不一次掃完整歷史。
- `L2`：挑出 JSON 無效或 `ExpiresAt` 已到期的 key，並產生下一輪 cursor。
- `L3`：批次刪除過期 record。
- `L4`：保存 maintenance cursor，使下次 cleanup 從未掃完位置繼續。

## 5. `financeUpdateMetrics`、`readFinanceMetrics`、`financeMetricsShardKey`、`financeMergeMetrics`
```go
// L1
shardKey := financeMetricsShardKey(time.Now().UTC())
// L2
mutate(&metrics)
// L3
nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceMetrics, Key: shardKey, UserID: "", Value: mustJSON(metrics), Version: version, PermissionRead: 0, PermissionWrite: 0}})
// L4
total.MatchmakingStarts += shard.MatchmakingStarts
```
- `L1`：依 UTC 時間選擇 metrics shard，分散高頻寫入競爭。
- `L2`：由呼叫端傳入 closure，只改需要的指標欄位。
- `L3`：使用 version CAS 寫回 shard，衝突時 retry。
- `L4`：管理員讀取時把多個 shard 聚合成總數。

## 6. `financePersistRoundPortfolios`
```go
// L1
for userID, portfolio := range state.Portfolios {
	record := financePortfolioSnapshotRecord{ArenaID: state.ArenaID, UserID: userID, Round: state.Round, Portfolio: *portfolio, RecordedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinancePortfolioSnapshots, Key: fmt.Sprintf("%s:%06d:%s", state.ArenaID, state.Round, userID), UserID: "", Value: mustJSON(record), PermissionRead: 0, PermissionWrite: 0}})
}
```
- `L1`：每回合為每位玩家保存 cash、BTC、NAV、PnL 與報酬率快照；key 綁定 arena、round、user。

## 7. `persistFinanceGameAndStats`
```go
// L1
stats, versions, ratingChanges, err := financeUpdatedPlayerStats(ctx, nk, state, finishedAt)
// L2
writes := append(gameWrite, statsWrites...)
// L3
_, err = nk.StorageWrite(ctx, writes)
```
- `L1`：先由完成對局狀態計算兩位玩家的新 stats、CAS versions 與 rating 變動。
- `L2`：將 completed game、player stats 與 player history index 合併成同一批寫入。
- `L3`：批次寫入失敗時由外層 CAS retry 重讀與重算，避免覆蓋同玩家其他對局結果。

## 8. `financeUpdatedPlayerStats`、`financeHistoryKey`、`readFinancePlayerStats`
```go
// L1
current, err := readFinancePlayerStats(ctx, nk, userID)
// L2
expected := 1.0 / (1.0 + math.Pow(10, float64(opponent.Rating-current.Rating)/400.0))
// L3
next.Rating = current.Rating + int64(math.Round(financeEloK*(actual-expected)))
// L4
return fmt.Sprintf("%s:%s", finishedAt, arenaID)
```
- `L1`：讀取玩家既有 stats projection。
- `L2`：依 Elo 公式計算預期勝率。
- `L3`：以實際結果減預期結果乘 K 值更新 rating，並同步勝敗和累積報酬。
- `L4`：歷史 key 以完成時間與 arena 組成，支援由新到舊 cursor 分頁。
