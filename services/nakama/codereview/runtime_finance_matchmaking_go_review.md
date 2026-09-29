# runtime_finance_matchmaking.go 逐行 Code Review

每段以 `L1`、`L2` 對照關鍵原始碼；可依編號講解 queue claim、確認期限、lease 與 CAS storage。

## 1. `financeMatchmakerMatched`

```go
// L1
if len(entries) != 2 { return "", nil }
// L2
for _, entry := range entries { if entry.GetProperties()["gameType"] != gameTypeFinance { return "", nil } }
// L3
sort.Slice(entries, func(i, j int) bool { return entries[i].GetCreateTime() < entries[j].GetCreateTime() })
// L4
expectedPlayers := []string{entries[0].GetPresence().GetUserId(), entries[1].GetPresence().GetUserId()}
// L5
if expectedPlayers[0] == expectedPlayers[1] { return "", failedPrecondition("A player cannot be matched against another session of the same account.") }
```

- `L1`：finance duel 只接受剛好兩名 matchmaker entry。
- `L2`：兩筆 entry 都必須宣告 finance game type。
- `L3`：依進入佇列時間排序，實作先按匹配者優先。
- `L4`：由 Nakama presence 取出兩位 authenticated user ID。
- `L5`：同帳號不同 session 不可互相配對。

```go
// L6
queueTokens := map[string]string{}
// L7
for _, entry := range entries { queueTokens[entry.GetPresence().GetUserId()], _ = entry.GetProperties()["queueToken"].(string) }
// L8
if err := claimFinanceMatchmaking(ctx, nk, expectedPlayers, queueTokens); err != nil { return "", err }
// L9
arenaID := fmt.Sprintf("finance-%d", time.Now().UTC().UnixNano())
// L10
matchID, err := nk.MatchCreate(ctx, financeAuthoritativeModule, map[string]interface{}{ "arenaId": arenaID, "name": "BTC ranked queue", "gameType": gameTypeFinance, "expectedPlayers": expectedPlayers, "matchmade": true })
// L11
if err != nil { financeSetMatchmakingStatus(ctx, logger, nk, expectedPlayers, "idle", "", ""); return "", err }
```

- `L6`：建立 user ID 對 queue token 的索引。
- `L7`：從 matchmaker properties 取 token；型別不符時得到空字串，後續 claim 會拒絕。
- `L8`：用 token 與 CAS 將兩位玩家從 `searching` 原子轉為 `matching`。
- `L9`：以 server UTC nanoseconds 建立 arena ID。
- `L10`：建立 Nakama authoritative finance match，並限制 expected players。
- `L11`：建房失敗時將被 claim 的玩家回復 idle，再回傳錯誤。

```go
// L12
for _, userID := range expectedPlayers {
	waitSeconds := int64(0)
	if current, readErr := readFinanceMatchmaking(ctx, nk, userID); readErr == nil { if startedAt, parseErr := time.Parse(time.RFC3339Nano, current.SearchStartedAt); parseErr == nil { waitSeconds = int64(time.Since(startedAt).Seconds()) } }
	now := time.Now().UTC()
	if err := writeFinanceMatchmaking(ctx, nk, financeMatchmakingRecord{UserID: userID, Status: "matched", MatchID: matchID, LeaseExpiresAt: now.Add(financeMatchmakingLease).Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano)}); err != nil { return "", err }
	financeUpdateMetrics(ctx, logger, nk, func(metrics *financeSystemMetrics) { metrics.MatchedPlayers++; metrics.TotalMatchWaitSeconds += waitSeconds })
}
// L13
return matchID, nil
```

- `L12`：逐位計算搜尋秒數、保存 `matched` 與 match ID、設定 lease，並累積營運 metrics。
- `L13`：將 authoritative match ID 交回 Nakama matchmaker。

## 2. `claimFinanceMatchmaking`

```go
// L1
reads := make([]*runtime.StorageRead, 0, len(userIDs))
// L2
for _, userID := range userIDs { reads = append(reads, &runtime.StorageRead{Collection: collectionFinanceMatchmaking, Key: userID, UserID: ""}) }
// L3
objects, err := nk.StorageRead(ctx, reads)
// L4
if err != nil || len(objects) != len(userIDs) { return failedPrecondition("Matchmaking state is unavailable.") }
```

- `L1`：建立兩位玩家的批次 storage read。
- `L2`：matchmaking record 是全域 object，key 是 user ID。
- `L3`：一次讀取兩人的目前 queue state。
- `L4`：讀取失敗或少任何一人時，不消耗配對資格。

```go
// L5
nowTime := time.Now().UTC()
// L6
writes := make([]*runtime.StorageWrite, 0, len(objects))
// L7
for _, object := range objects {
	if object == nil { return failedPrecondition("Player is no longer eligible for matchmaking.") }
	var record financeMatchmakingRecord
	if json.Unmarshal([]byte(object.GetValue()), &record) != nil || record.Status != "searching" || record.QueueToken == "" || record.QueueToken != queueTokens[record.UserID] { return failedPrecondition("Player is no longer eligible for matchmaking.") }
	record.Status = "matching"; record.LeaseExpiresAt = nowTime.Add(financeMatchmakingLease).Format(time.RFC3339Nano); record.UpdatedAt = nowTime.Format(time.RFC3339Nano)
	writes = append(writes, &runtime.StorageWrite{Collection: collectionFinanceMatchmaking, Key: record.UserID, UserID: "", Value: mustJSON(record), Version: object.GetVersion(), PermissionRead: 0, PermissionWrite: 0})
}
// L8
if _, err := nk.StorageWrite(ctx, writes); err != nil { return failedPrecondition("Matchmaking claim was already consumed.") }
// L9
return nil
```

- `L5`：取一次 server UTC 時間，確保兩人 lease 基準一致。
- `L6`：建立帶 version 的 CAS write 集合。
- `L7`：每位玩家必須有 object、狀態為 `searching`、帶 token 且 token 與 matchmaker entry 相同；通過後才轉為 `matching` 並以讀取到的 version 寫回。
- `L8`：任何另一個請求搶先改寫 record 都會使 CAS 失敗，表示 queue claim 已被消耗。
- `L9`：兩筆寫入成功才完成 claim。

## 3. `financeSetConfirmationOutcome`

```go
// L1
now := time.Now().UTC()
// L2
for _, userID := range state.Players {
	status := "searching"; cooldownUntil := ""; queueToken := fmt.Sprintf("%s:%d", userID, now.UnixNano())
	if userID == state.CanceledByUserID || (state.CanceledByUserID == "" && !state.Ready[userID]) { status = "cooldown"; queueToken = ""; cooldownUntil = now.Add(time.Duration(financeCancelCooldownSeconds) * time.Second).Format(time.RFC3339Nano) }
	searchStartedAt := ""; if status == "searching" { searchStartedAt = now.Format(time.RFC3339Nano) }
	if err := writeFinanceMatchmaking(ctx, nk, financeMatchmakingRecord{UserID: userID, Status: status, QueueToken: queueToken, SearchStartedAt: searchStartedAt, CooldownUntil: cooldownUntil, UpdatedAt: now.Format(time.RFC3339Nano)}); err != nil { logger.Error("Finance matchmaking outcome persistence failed user=%s: %v", userID, err) }
}
```

- `L1`：取得本次確認結果的共同 server 時間。
- `L2`：取消者或確認逾時時未 ready 的玩家進 cooldown；另一位得到新的 queue token 並回到 searching；寫入失敗只記錄錯誤，避免影響 match 結束。

## 4. `financeSetMatchmakingStatus`

```go
// L1
nowTime := time.Now().UTC()
// L2
for _, userID := range userIDs {
	resolvedMatchID := matchID
	if resolvedMatchID == "" && (status == "matched" || status == "running") { if current, err := readFinanceMatchmaking(ctx, nk, userID); err == nil { resolvedMatchID = current.MatchID } }
	if err := writeFinanceMatchmaking(ctx, nk, financeMatchmakingRecord{UserID: userID, Status: status, MatchID: resolvedMatchID, CooldownUntil: cooldownUntil, LeaseExpiresAt: financeMatchmakingLeaseExpiry(status, nowTime), UpdatedAt: nowTime.Format(time.RFC3339Nano)}); err != nil { logger.Error("Finance matchmaking status persistence failed user=%s status=%s: %v", userID, status, err) }
}
```

- `L1`：統一此次狀態更新的 UTC 時間。
- `L2`：逐位更新 status；matched/running 未傳 match ID 時讀舊 record 保留它；依 status 產生 lease，失敗只記 logger。

## 5. `financeMatchmakingLeaseExpiry`

```go
// L1
switch status { case "matching", "matched": return now.Add(financeMatchmakingLease).Format(time.RFC3339Nano); case "running": return now.Add(financeRunningLease).Format(time.RFC3339Nano); default: return "" }
```

- `L1`：matching/matched 使用短 lease；running 使用對局 lease；idle、searching、cooldown 不保存 lease。

## 6. `financeRecoverExpiredMatchmaking`

```go
// L1
if record.Status != "matching" && record.Status != "matched" && record.Status != "running" { return record, false }
// L2
deadline, err := time.Parse(time.RFC3339Nano, record.LeaseExpiresAt)
// L3
if err == nil && deadline.After(now) { return record, false }
// L4
return financeMatchmakingRecord{UserID: record.UserID, Status: "idle", UpdatedAt: now.Format(time.RFC3339Nano)}, true
```

- `L1`：只有會持有 lease 的狀態可能過期。
- `L2`：解析保存的 lease deadline。
- `L3`：deadline 有效且仍未到期時不改狀態。
- `L4`：缺 lease、無效時間或已到期時回收為 idle，第二個回傳值表示需要保存。

## 7. `rpcCreateFinanceMatchHandler`

```go
// L1
userID, err := requireUserID(ctx); if err != nil { return "", err }
// L2
var input matchLobbyPayload; if err := parsePayload(payload, &input); err != nil { return "", err }
// L3
arenaID := fmt.Sprintf("finance-%d", time.Now().UTC().UnixNano())
// L4
matchID, err := nk.MatchCreate(ctx, financeAuthoritativeModule, map[string]interface{}{ "arenaId": arenaID, "communityId": "", "kind": "group", "name": defaultString(strings.TrimSpace(input.Name), "BTC trading duel"), "hostUserId": userID, "gameType": gameTypeFinance })
// L5
if err != nil { return "", err }
// L6
return mustJSON(map[string]interface{}{ "matchId": matchID, "arenaId": arenaID }), nil
```

- `L1`：取得建立者 ID。
- `L2`：解析可選 lobby 名稱。
- `L3`：建立 server arena ID。
- `L4`：建立非 queue 的 authoritative finance match，host ID 來自 context。
- `L5`：建房失敗時回傳錯誤。
- `L6`：回傳 Nakama match ID 與 arena ID。

## 8. `rpcFinanceMatchmakingHandler`

```go
// L1
userID, err := requireUserID(ctx); if err != nil { return "", err }
// L2
var input financeMatchmakingPayload; if err := parsePayload(payload, &input); err != nil { return "", err }
// L3
action := strings.ToLower(strings.TrimSpace(input.Action))
// L4
record, err := readFinanceMatchmaking(ctx, nk, userID); if err != nil { return "", err }
// L5
now := time.Now().UTC()
// L6
if recovered, changed := financeRecoverExpiredMatchmaking(record, now); changed { record = recovered; if err := writeFinanceMatchmaking(ctx, nk, record); err != nil { return "", err } }
```

- `L1`：取得 authenticated 玩家 ID。
- `L2`：解析 action payload。
- `L3`：清理 action 並轉成小寫。
- `L4`：讀取此玩家目前 matchmaking record。
- `L5`：取 server UTC 時間作所有 deadline 基準。
- `L6`：請求進來時順便回收過期 lease，並保存回收結果。

```go
// L7
switch action {
case "begin":
	if record.Status == "searching" || record.Status == "matching" || record.Status == "matched" || record.Status == "running" { return "", failedPrecondition("Player already has an active finance match.") }
	if deadline, parseErr := time.Parse(time.RFC3339Nano, record.CooldownUntil); parseErr == nil && deadline.After(now) { return "", failedPrecondition(fmt.Sprintf("Matchmaking cooldown active until %s.", deadline.Format(time.RFC3339))) }
	record = financeMatchmakingRecord{UserID: userID, Status: "searching", QueueToken: fmt.Sprintf("%s:%d", userID, now.UnixNano()), SearchStartedAt: now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano)}
	if err := writeFinanceMatchmaking(ctx, nk, record); err != nil { return "", err }
	financeUpdateMetrics(ctx, nil, nk, func(metrics *financeSystemMetrics) { metrics.MatchmakingStarts++ })
case "cancel":
	record = financeMatchmakingRecord{UserID: userID, Status: "cooldown", CooldownUntil: now.Add(time.Duration(financeCancelCooldownSeconds) * time.Second).Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano)}
	if err := writeFinanceMatchmaking(ctx, nk, record); err != nil { return "", err }
case "status", "":
default: return "", invalidArgument("action must be begin, cancel, or status.")
}
// L8
return mustJSON(map[string]interface{}{ "matchmaking": record }), nil
```

- `L7`：`begin` 拒絕 active status 與 cooldown，建立 searching record 和不可預測 queue token，保存並累積開始指標；`cancel` 進入 server 計算的 cooldown；`status` 只讀；其他 action 被拒絕。
- `L8`：回傳目前由後端保存的 matchmaking record。

## 9. `readFinanceMatchmaking`

```go
// L1
objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceMatchmaking, Key: userID, UserID: ""}})
// L2
if err != nil { return financeMatchmakingRecord{}, err }
// L3
if len(objects) == 0 || objects[0] == nil { return financeMatchmakingRecord{UserID: userID, Status: "idle"}, nil }
// L4
var record financeMatchmakingRecord
// L5
if err := json.Unmarshal([]byte(objects[0].GetValue()), &record); err != nil { return financeMatchmakingRecord{}, err }
// L6
return record, nil
```

- `L1`：讀取 user ID 為 key 的全域 matchmaking record。
- `L2`：storage 錯誤時回傳空 record 與錯誤。
- `L3`：不存在 record 時以 idle 作預設狀態。
- `L4`：建立承接 JSON 的 record。
- `L5`：JSON 損壞時回傳錯誤。
- `L6`：回傳已保存狀態。

## 10. `writeFinanceMatchmaking`

```go
// L1
for attempt := 0; attempt < financeStatsCASRetries; attempt++ {
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceMatchmaking, Key: record.UserID, UserID: ""}})
	if err != nil { return err }
	version := "*"; if len(objects) > 0 && objects[0] != nil { version = objects[0].GetVersion() }
	_, lastErr = nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceMatchmaking, Key: record.UserID, UserID: "", Value: mustJSON(record), Version: version, PermissionRead: 0, PermissionWrite: 0}})
	if lastErr == nil { return nil }
}
// L2
return lastErr
```

- `L1`：最多重試設定次數：先讀目前 version；不存在使用 `*` create-only，存在使用 version CAS 寫入；成功立即結束，衝突則下一輪重讀。
- `L2`：所有 CAS retry 都失敗時回傳最後一次錯誤。
