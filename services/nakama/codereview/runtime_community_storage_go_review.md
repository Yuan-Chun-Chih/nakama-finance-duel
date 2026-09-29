# runtime_community_storage.go 逐行 Code Review

本文件依 `runtime_community_storage.go` 的 function 順序編寫。每個程式片段以 `L1`、`L2` 標記；照著下方同編號說明即可逐行講解。單純的 `{`、`}`、`func` 與型別宣告不另行拆解，重點放在資料、判斷、權限與回傳值。

## 1. `listGuildJoinRequestsForGuild`

```go
// L1
requests := make([]guildJoinRequestRecord, 0)
// L2
prefix := guildID + ":"
// L3
cursor := ""
// L4
for len(requests) < guildStorageScanMaxRecords {
// L5
	objects, nextCursor, err := nk.StorageList(ctx, "", "", collectionGuildRequests, guildStorageScanPageSize, cursor)
// L6
	if err != nil { return nil, err }
// L7
	for _, object := range objects {
// L8
		if object == nil || !strings.HasPrefix(object.GetKey(), prefix) { continue }
// L9
		var request guildJoinRequestRecord
// L10
		if json.Unmarshal([]byte(object.GetValue()), &request) == nil { requests = append(requests, request) }
	}
// L11
	if nextCursor == "" { break }
// L12
	cursor = nextCursor
}
// L13
return requests, nil
```

- `L1`：建立空的 `requests` slice，最後只放入此 guild 的加入申請。
- `L2`：加入申請 key 的格式是 `<guildId>:<userId>`；此字串用來篩選指定 guild。
- `L3`：空 cursor 表示從 Nakama storage list 的第一頁開始讀取。
- `L4`：尚未達 `guildStorageScanMaxRecords` 安全上限時，才繼續掃描下一頁。
- `L5`：從全域 `collectionGuildRequests` 讀取一頁資料；空字串的 owner/user ID 表示讀全域 storage object。
- `L6`：storage list 失敗時立即回傳錯誤，不使用不完整的 request 集合。
- `L7`：逐一檢查本頁 Nakama storage object。
- `L8`：空 object 或 key 不以此 guild 前綴開頭時跳過；同 collection 的其他 guild request 不會混入。
- `L9`：準備把 storage JSON 解碼為 `guildJoinRequestRecord`。
- `L10`：JSON 可正常解析才 append；損壞的單筆舊資料不會使整個 guild detail 查詢失敗。
- `L11`：Nakama 回傳空 `nextCursor` 代表已沒有下一頁，結束迴圈。
- `L12`：保存下一頁 cursor，供下一輪 `StorageList` 使用。
- `L13`：回傳所有已篩選的 request；`nil` error 代表讀取成功。

## 2. `listGuildAuditLog`

```go
// L1
records := make([]guildAuditRecord, 0)
// L2
prefix := guildID + ":"
// L3
cursor := ""
// L4
for len(records) < guildStorageScanMaxRecords {
// L5
	objects, nextCursor, err := nk.StorageList(ctx, "", "", collectionGuildAudit, guildStorageScanPageSize, cursor)
// L6
	if err != nil { return nil, err }
// L7
	for _, object := range objects {
// L8
		if object == nil || !strings.HasPrefix(object.GetKey(), prefix) { continue }
// L9
		var record guildAuditRecord
// L10
		if json.Unmarshal([]byte(object.GetValue()), &record) == nil { records = append(records, record) }
	}
// L11
	if nextCursor == "" { break }
// L12
	cursor = nextCursor
}
// L13
sort.Slice(records, func(i, j int) bool { return records[i].CreatedAt > records[j].CreatedAt })
// L14
if limit > 0 && len(records) > limit { return records[:limit], nil }
// L15
return records, nil
```

- `L1`：建立 audit record 的結果 slice。
- `L2`：audit key 以 guild ID 開頭，這個 prefix 將全域 audit collection 限縮為單一 guild。
- `L3`：從 storage list 第一頁開始。
- `L4`：掃描量同樣受最大 record 數限制。
- `L5`：讀取 `collectionGuildAudit` 的一頁全域 object。
- `L6`：讀取失敗時直接回傳 Nakama 錯誤。
- `L7`：逐一處理本頁 audit object。
- `L8`：排除空 object 與其他 guild 的 audit key。
- `L9`：建立承接 JSON 的 audit record 變數。
- `L10`：只將成功解析的 audit JSON 加入結果。
- `L11`：沒有下一頁 cursor 時停止分頁。
- `L12`：把下一頁 cursor 放回迴圈使用。
- `L13`：以 `CreatedAt` 由大到小排序；RFC3339 時間字串可依字典順序取得最新在前的順序。
- `L14`：`limit` 大於零且結果超量時，只回傳前 `limit` 筆最新 audit。
- `L15`：未超量時回傳全部已排序 records。

## 3. `listGuildMembers`

```go
// L1
users, _, err := nk.GroupUsersList(ctx, guildID, maxGuildMembers, nil, "")
// L2
return users, err
```

- `L1`：向 Nakama Group roster 查詢 guild 成員；`maxGuildMembers` 是每次讀取上限，`nil` state filter 代表不限制 roster state，空 cursor 代表第一頁。
- `L2`：將 Nakama roster 結果與讀取錯誤原樣交回 caller；roster 是 guild 身分與權限的 authoritative 來源。

## 4. `ensureUserHasNoGuild`

```go
// L1
membership, err := readGuildMembership(ctx, nk, userID)
// L2
if err != nil { return err }
// L3
if membership != nil && membership.GuildID != "" {
// L4
	groups, groupErr := nk.GroupsGetId(ctx, []string{membership.GuildID})
// L5
	if groupErr != nil { return groupErr }
// L6
	if len(groups) == 0 { return deleteGuildMembership(ctx, nk, userID) }
// L7
	members, rosterErr := listGuildMembers(ctx, nk, membership.GuildID)
// L8
	if rosterErr == nil && findGroupUserByID(members, userID) == nil { return deleteGuildMembership(ctx, nk, userID) }
// L9
	if rosterErr != nil { return rosterErr }
// L10
	return failedPrecondition("User already belongs to a guild.")
}
// L11
return nil
```

- `L1`：讀取玩家自己的 membership projection，快速得知他先前指向哪個 guild。
- `L2`：讀取 projection 失敗時不可繼續建立或加入 guild，避免在未知狀態下產生重複 membership。
- `L3`：只有 projection 存在且帶有 guild ID 時，才需要做 stale-data 驗證。
- `L4`：向 Nakama 查詢 projection 指向的 group 是否仍存在；ID 必須包成 `[]string`。
- `L5`：查 group 本身失敗時回傳錯誤，不能假定 guild 已消失。
- `L6`：找不到 group 代表 projection 已過期，刪除玩家的 membership 後回傳刪除結果。
- `L7`：group 存在時，再讀 roster 檢查玩家是否真的是成員。
- `L8`：roster 讀取成功但找不到玩家時，projection 與 authoritative roster 不一致，因此刪除 stale projection。
- `L9`：roster 查詢失敗時回傳錯誤；此時不能刪除 projection 以免暫時性錯誤錯放行。
- `L10`：guild 與 roster 都有效時，阻止玩家同時加入另一個 guild。
- `L11`：沒有 membership，或 stale membership 已成功清除時，回傳 `nil` 允許下一步操作。

## 5. `reconcileGuildMembershipProjections`

```go
// L1
writes := make([]*runtime.StorageWrite, 0, len(members))
// L2
for _, member := range members {
// L3
	if member == nil || member.GetUser() == nil || member.GetUser().GetId() == "" || groupUserState(member) == 3 { continue }
// L4
	writes = append(writes, &runtime.StorageWrite{
// L5
		Collection: collectionGuildMembership, Key: guildMembershipKey, UserID: member.GetUser().GetId(),
// L6
		Value: mustJSON(guildMembershipStorage{GuildID: guildID, Role: mapGuildStateToRole(groupUserState(member))}),
// L7
		PermissionRead: 0, PermissionWrite: 0,
	})
}
// L8
if len(writes) == 0 { return nil }
// L9
_, err := nk.StorageWrite(ctx, writes)
// L10
return err
```

- `L1`：建立批次 storage write slice，預留 roster 成員數量的容量。
- `L2`：逐一把 Nakama roster 成員轉成 user-scoped membership projection。
- `L3`：跳過空 member、缺 user、缺 user ID，以及 state `3` 的 pending request；pending 申請者不是真正成員。
- `L4`：建立一筆 membership storage write，暫時累積而不立刻送出。
- `L5`：collection 固定為 membership collection；key 固定為 membership key；`UserID` 使用該成員 ID，使資料由該玩家 scope 持有。
- `L6`：寫入 guild ID 與從 roster state 推導的文字 role，不信任舊 projection 的 role。
- `L7`：讀寫權限皆為 `0`，代表 client 不能透過 storage API 直接讀寫或竄改 projection。
- `L8`：沒有有效 roster 成員時不送空的 StorageWrite。
- `L9`：一次批次寫入所有有效成員 projection。
- `L10`：回傳 Nakama 寫入錯誤；成功時為 `nil`。

## 6. `ensureUserCanManageGuild`

```go
// L1
users, err := listGuildMembers(ctx, nk, guildID)
// L2
if err != nil { return err }
// L3
mine := findGroupUserByID(users, userID)
// L4
if mine == nil || !guildStateCanManage(groupUserState(mine)) {
	return permissionDenied("Guild admin privileges required.")
}
// L5
return nil
```

- `L1`：讀取 authoritative roster，而非讀取前端提交的 role。
- `L2`：roster 無法讀取時停止操作。
- `L3`：從 roster 尋找目前 caller 的成員資料。
- `L4`：找不到 caller 或其 state 不是可管理 guild 的 state 時，回傳權限錯誤；helper 會接受 owner/admin。
- `L5`：只有通過 roster 權限檢查才回傳成功。

## 7. `ensureUserOwnsGuild`

```go
// L1
users, err := listGuildMembers(ctx, nk, guildID)
// L2
if err != nil { return err }
// L3
mine := findGroupUserByID(users, userID)
// L4
if mine == nil || !guildStateIsOwner(groupUserState(mine)) {
	return permissionDenied("Guild owner privileges required.")
}
// L5
return nil
```

- `L1`：讀取 guild roster，取得不可由 client 偽造的成員 state。
- `L2`：roster 讀取失敗時回傳錯誤。
- `L3`：查找呼叫者自己的 roster entry。
- `L4`：呼叫者不存在，或 helper 判定他不是 owner 時，拒絕 owner-only 操作。
- `L5`：只有 owner 通過此驗證。

## 8. `buildGuildOperationKey`

```go
// L1
identity := strings.TrimSpace(operationID)
// L2
if identity == "" {
	identity = fmt.Sprintf("%s:%s", actorUserID, targetUserID)
}
// L3
return fmt.Sprintf("%s:%s:%s", guildID, action, identity)
```

- `L1`：去除 client operation ID 前後空白，避免空白差異建立不同冪等鍵。
- `L2`：client 未提供 operation ID 時，以操作者與目標玩家建立 fallback identity。
- `L3`：最終 key 組成 `<guildId>:<action>:<identity>`；同 guild 的不同動作不會互相覆蓋 operation record。

## 9. `readGuildOperation`

```go
// L1
objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionGuildOperations, Key: key, UserID: ""}})
// L2
if err != nil { return nil, "", err }
// L3
if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" { return nil, "", nil }
// L4
var record guildOperationRecord
// L5
if err := json.Unmarshal([]byte(objects[0].GetValue()), &record); err != nil { return nil, "", err }
// L6
return &record, objects[0].GetVersion(), nil
```

- `L1`：讀取全域 guild operation storage object；operation 不屬於某一個 user scope，因此 `UserID` 為空字串。
- `L2`：Nakama storage read 失敗時，回傳空 record、空 version 與錯誤。
- `L3`：找不到 object 不視為錯誤；回傳 `nil, "", nil` 表示 handler 可建立新的 operation。
- `L4`：準備承接 operation JSON。
- `L5`：JSON 解碼失敗時回傳錯誤，避免使用不完整的 operation 狀態。
- `L6`：回傳 record 指標、Nakama object version 與成功結果；version 供後續 CAS write 使用。

## 10. `writeGuildOperation`

```go
// L1
record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
// L2
if record.CreatedAt == "" { record.CreatedAt = record.UpdatedAt }
// L3
if version == "" { version = "*" }
// L4
writes, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
	Collection: collectionGuildOperations, Key: record.ID, UserID: "", Value: mustJSON(record), Version: version,
	PermissionRead: 0, PermissionWrite: 0,
}})
// L5
if err != nil { return "", err }
// L6
if len(writes) == 0 || writes[0] == nil { return "", failedPrecondition("Guild operation persistence returned no acknowledgement.") }
// L7
return writes[0].GetVersion(), nil
```

- `L1`：每次保存都由 server 產生最新 UTC 高精度更新時間。
- `L2`：初次建立 operation 時補上建立時間；既有 operation retry 不覆蓋原始建立時間。
- `L3`：沒有既有 version 時使用 `"*"`，要求 Nakama 只允許 create；若 key 已存在會產生衝突。
- `L4`：寫入全域 operation record，並把 version 帶給 Nakama 進行 create-only 或 compare-and-set 驗證；權限 `0` 禁止 client 直接操作。
- `L5`：CAS 衝突或 storage 錯誤時交由上層 retry 或回傳錯誤。
- `L6`：Nakama 未回傳 write acknowledgement 視為異常，不把 operation 當成已保存。
- `L7`：回傳最新 version，供下一次更新此 operation 時做 CAS。

## 11. `writeGuildMembership`

```go
// L1
_, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
	Collection: collectionGuildMembership,
	Key: guildMembershipKey,
	UserID: userID,
	Value: mustJSON(membership),
	PermissionRead: 0,
	PermissionWrite: 0,
}})
// L2
return err
```

- `L1`：將 membership 寫入 user-scoped object；固定 key 加上 `userID` 使每位玩家只有一筆 membership projection；JSON 由 server 產生且 client 無讀寫權。
- `L2`：把 storage 寫入結果交回 caller。

## 12. `writeGuildConfig`

```go
// L1
_, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
	Collection: collectionGuildConfig,
	Key: buildGuildConfigKey(guildID),
	UserID: "",
	Value: mustJSON(config),
	PermissionRead: 0,
	PermissionWrite: 0,
}})
// L2
return err
```

- `L1`：guild config 使用全域 object；key 由 guild ID 建立，並以 server-only permission 保存公告與加入政策。
- `L2`：回傳 Nakama 寫入結果。

## 13. `deleteGuildMembership`

```go
// L1
return nk.StorageDelete(ctx, []*runtime.StorageDelete{{
	Collection: collectionGuildMembership,
	Key: guildMembershipKey,
	UserID: userID,
}})
```

- `L1`：依 membership collection、固定 key 與玩家 user ID 刪除該玩家 projection；用於 leave、kick、disband 與 stale-projection 清理。

## 14. `readGuildMembership`

```go
// L1
objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionGuildMembership, Key: guildMembershipKey, UserID: userID}})
// L2
if err != nil { return nil, err }
// L3
if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" { return nil, nil }
// L4
var membership guildMembershipStorage
// L5
if err := json.Unmarshal([]byte(objects[0].GetValue()), &membership); err != nil { return nil, err }
// L6
return &membership, nil
```

- `L1`：讀取指定玩家 scope 下的 membership object。
- `L2`：storage read 失敗時回傳錯誤。
- `L3`：沒有 membership 不是錯誤，回傳 `nil, nil` 表示此玩家目前沒有 projection。
- `L4`：建立 membership 結構承接 JSON。
- `L5`：JSON 無法解析時回傳錯誤，避免把損壞資料誤判為有效 guild。
- `L6`：回傳已解碼的 membership 指標。

## 15. `readGuildConfig`

```go
// L1
objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionGuildConfig, Key: buildGuildConfigKey(guildID), UserID: ""}})
// L2
if err != nil { return nil, err }
// L3
if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" { return defaultGuildConfig(guildID, "", ""), nil }
// L4
var config guildConfigStorage
// L5
if err := json.Unmarshal([]byte(objects[0].GetValue()), &config); err != nil { return nil, err }
// L6
if config.JoinPolicy == "" { config.JoinPolicy = "request" }
// L7
return &config, nil
```

- `L1`：以 guild ID 建立 config key，讀取全域 guild config object。
- `L2`：讀取 Nakama storage 失敗時回傳錯誤。
- `L3`：舊 guild 尚未有 config 時建立預設設定，維持舊資料相容。
- `L4`：建立 config 結構承接 storage JSON。
- `L5`：解碼失敗時回傳錯誤，不使用不可信設定。
- `L6`：舊 record 若缺少 `JoinPolicy`，補為安全的 `request` 預設值。
- `L7`：回傳有效的 config 指標。

## 16. `buildGuildConfigKey`

```go
// L1
return fmt.Sprintf("%s:%s", guildID, guildConfigKey)
```

- `L1`：回傳 `<guildId>:config`，讓每個 guild 在 config collection 中有固定且唯一的 key。

## 17. `getGuildJoinRequestOrThrow`

```go
// L1
objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionGuildRequests, Key: buildGuildJoinRequestKey(guildID, userID), UserID: ""}})
// L2
if err != nil { return nil, err }
// L3
if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" { return nil, notFound("Guild join request not found.") }
// L4
var request guildJoinRequestRecord
// L5
if err := json.Unmarshal([]byte(objects[0].GetValue()), &request); err != nil { return nil, err }
// L6
return &request, nil
```

- `L1`：用 guild ID 和申請者 user ID 建立 request key，從全域 request collection 讀取。
- `L2`：storage read 錯誤直接回傳。
- `L3`：approve/reject 所需 request 不存在時回傳 `notFound`，不是一般的空結果。
- `L4`：建立 request record 接收 JSON。
- `L5`：JSON 解碼失敗時中止操作。
- `L6`：回傳存在且有效的 pending request。

## 18. `deleteGuildJoinRequestIfExists`

```go
// L1
objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionGuildRequests, Key: buildGuildJoinRequestKey(guildID, userID), UserID: ""}})
// L2
if err != nil { return err }
// L3
if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" { return nil }
// L4
return deleteGuildJoinRequest(ctx, nk, guildID, userID)
```

- `L1`：先確認指定的 pending request 是否存在。
- `L2`：讀取失敗時回傳錯誤。
- `L3`：request 已不存在時視為刪除完成，使重複 invite 或清理操作保持冪等。
- `L4`：確認存在後才呼叫真正的刪除函式。

## 19. `deleteGuildJoinRequest`

```go
// L1
return nk.StorageDelete(ctx, []*runtime.StorageDelete{{
	Collection: collectionGuildRequests,
	Key: buildGuildJoinRequestKey(guildID, userID),
	UserID: "",
}})
```

- `L1`：刪除該 guild 與該玩家組成的全域 pending request；approve、reject 與 invite 覆蓋 request 都會使用這個操作。

## 20. `getGuildOrThrow`

```go
// L1
groups, err := nk.GroupsGetId(ctx, []string{guildID})
// L2
if err != nil { return nil, err }
// L3
if len(groups) == 0 { return nil, notFound("Guild does not exist.") }
// L4
guild := groups[0]
// L5
if guild.GetLangTag() != "guild" { return nil, invalidArgument("Target group is not a guild.") }
// L6
return guild, nil
```

- `L1`：向 Nakama Group API 查詢指定 ID；API 接收 string slice，因此傳入單一元素 slice。
- `L2`：Group API 失敗時回傳錯誤。
- `L3`：沒有查到 group 時回傳 `notFound`。
- `L4`：取得查詢到的唯一 group。
- `L5`：本專案以 `LangTag == "guild"` 辨認 guild，防止一般 Nakama group 使用 guild-only RPC。
- `L6`：回傳已驗證為 guild 的 group。

## 21. `buildGuildJoinRequestKey`

```go
// L1
return fmt.Sprintf("%s:%s", guildID, userID)
```

- `L1`：回傳 `<guildId>:<userId>`；同一玩家對同一 guild 固定使用同一 key，因此不能同時保存重複 pending request。

## 22. `buildGuildAuditKey`

```go
// L1
return fmt.Sprintf("%s:%s:%s:%s", guildID, now.UTC().Format(time.RFC3339Nano), action, defaultString(actorID, "system"))
```

- `L1`：建立 `<guildId>:<UTC timestamp>:<action>:<actor>` 的 audit key；高精度 UTC 時間讓事件可排序，actor 空白時以 `system` 補值。

## 23. `defaultGuildConfig`

```go
// L1
return &guildConfigStorage{
	GuildID: guildID,
	Announcement: "",
	JoinPolicy: "request",
	UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	UpdatedBy: updatedBy,
	UpdatedByName: updatedByName,
}
```

- `L1`：建立預設 config 指標；`JoinPolicy` 預設為 `request`，公告為空，更新時間一律由 server 產生 UTC RFC3339 格式，並保留更新者 ID 與名稱。

## 24. `newGuildAudit`

```go
// L1
now := time.Now().UTC()
// L2
return guildAuditRecord{
	ID: buildGuildAuditKey(guildID, action, actorID, now),
	GuildID: guildID,
	Action: action,
	ActorID: actorID,
	ActorName: actorName,
	TargetUserID: targetUserID,
	TargetName: targetName,
	Summary: summary,
	CreatedAt: now.Format(time.RFC3339),
}
```

- `L1`：一次取得 UTC 時間，供 audit ID 與 `CreatedAt` 共用，避免兩者時間不一致。
- `L2`：建立完整 audit record；ID 使用 guild、action、actor 與 `now`；其餘欄位保存操作者、目標、摘要與顯示名稱，供 audit log 顯示。

## 25. `appendGuildAudit`

```go
// L1
_, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
	Collection: collectionGuildAudit,
	Key: record.ID,
	UserID: "",
	Value: mustJSON(record),
	PermissionRead: 0,
	PermissionWrite: 0,
}})
// L2
return err
```

- `L1`：以新建立的 `record.ID` 寫入全域 audit collection；每筆 audit 使用不同 key，因此這是 append-only 寫入；權限 `0` 防止 client 偽造紀錄。
- `L2`：回傳 storage write 的成功或錯誤結果。

## 26. `mapGuildStateToRole`

```go
// L1
switch state {
// L2
case 0: return "owner"
// L3
case 1: return "admin"
// L4
case 3: return "requested"
// L5
default: return "member"
}
```

- `L1`：依 Nakama Group roster 的整數 state 選擇前端與 projection 使用的角色字串。
- `L2`：state `0` 對應 guild owner。
- `L3`：state `1` 對應 guild admin。
- `L4`：state `3` 對應尚未核准的 join request。
- `L5`：其他有效或未知 state 統一以一般 member 表示，避免把 Nakama 內部數字直接暴露到 view。
