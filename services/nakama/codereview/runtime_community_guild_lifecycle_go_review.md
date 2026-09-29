# runtime_community_guild_lifecycle.go 逐行 Code Review

每段以 `L1`、`L2` 對照關鍵原始碼；可依編號逐行講解 guild 建立、離開與解散的 authoritative 流程。

## 1. `rpcCreateGuildHandler`

```go
// L1
userID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
if err := ensureUserHasNoGuild(ctx, nk, userID); err != nil { return "", err }
// L4
var input createGuildPayload
// L5
if err := parsePayload(payload, &input); err != nil { return "", err }
// L6
if strings.TrimSpace(input.Name) == "" { return "", invalidArgument("Guild name is required.") }
```

- `L1`：從 authenticated Nakama context 取得建立者 ID。
- `L2`：沒有有效登入身分時停止。
- `L3`：驗證建立者沒有其他有效 guild membership。
- `L4`：建立 payload 結構接收 client 輸入。
- `L5`：解析 JSON payload。
- `L6`：移除名稱前後空白後仍為空時拒絕建立。

```go
// L7
var group *api.Group
// L8
if strings.TrimSpace(input.GuildID) != "" {
	group, err = getGuildOrThrow(ctx, nk, input.GuildID)
	if err != nil { return "", err }
	members, err := listGuildMembers(ctx, nk, input.GuildID)
	if err != nil { return "", err }
	owner := findGroupUserByID(members, userID)
	if owner == nil || groupUserState(owner) != 0 { return "", permissionDenied("Only the guild owner can finalize guild initialization.") }
} else {
	group, err = nk.GroupCreate(ctx, userID, strings.TrimSpace(input.Name), userID, "guild", strings.TrimSpace(input.Description), "", false, map[string]interface{}{}, maxGuildMembers)
	if err != nil { return "", err }
}
```

- `L7`：宣告群組指標，兩種建立路徑最後都會產生它。
- `L8`：payload 有 guild ID 時使用既有 Nakama group，並驗證 caller 是 roster owner；沒有 guild ID 時才由 runtime 建立 private、`guild` tag、有人數上限的新 group。

```go
// L9
if err := writeGuildMembership(ctx, nk, userID, guildMembershipStorage{GuildID: group.GetId(), Role: "owner"}); err != nil { return "", err }
// L10
if err := writeGuildConfig(ctx, nk, group.GetId(), defaultGuildConfig(group.GetId(), userID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME))); err != nil { return "", err }
// L11
if err := appendGuildAudit(ctx, nk, newGuildAudit(group.GetId(), "guild_created", userID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), "", "", "Guild created.")); err != nil { return "", err }
// L12
logger.Info("Guild created by %s: %s", userID, group.GetId())
// L13
return mustJSON(map[string]interface{}{ "guildId": group.GetId(), "accepted": true }), nil
```

- `L9`：為 owner 建立 user-scoped membership projection。
- `L10`：建立 server 預設 guild config。
- `L11`：append-only 寫入 guild created audit。
- `L12`：寫入後端操作日誌。
- `L13`：只回傳接受結果與 server 產生的 guild ID。

## 2. `rpcLeaveGuildHandler`

```go
// L1
userID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
username := contextString(ctx, runtime.RUNTIME_CTX_USERNAME)
// L4
var input guildLeavePayload
// L5
if strings.TrimSpace(payload) != "" { if err := parsePayload(payload, &input); err != nil { return "", err } }
// L6
membership, err := readGuildMembership(ctx, nk, userID)
// L7
if err != nil { return "", err }
// L8
guildID := strings.TrimSpace(input.GuildID)
// L9
if membership != nil && membership.GuildID != "" { guildID = membership.GuildID }
// L10
if guildID == "" { return "", failedPrecondition("User does not belong to a guild.") }
```

- `L1`：取得實際登入玩家 ID。
- `L2`：未登入時中止。
- `L3`：取得 username，提供 Nakama 離開 roster API 使用。
- `L4`：建立可選 guild ID payload。
- `L5`：payload 有內容才解析，支援不帶 body 的離開請求。
- `L6`：讀取 authoritative workflow 使用的 membership projection。
- `L7`：讀取失敗時停止。
- `L8`：先取 payload guild ID 的清理後值。
- `L9`：存在 membership 時以 server projection 的 guild ID 覆蓋 payload，防止 client 指定別人的 guild。
- `L10`：最終沒有 guild ID 時拒絕離開。

```go
// L11
members, err := listGuildMembers(ctx, nk, guildID)
// L12
if err != nil { return "", err }
// L13
selfEntry := findGroupUserByID(members, userID)
// L14
if selfEntry == nil { return "", failedPrecondition("User does not belong to the specified guild.") }
// L15
if groupUserState(selfEntry) == 0 && len(members) > 1 { return "", failedPrecondition("Guild owner cannot leave while members remain.") }
// L16
if err := nk.GroupUserLeave(ctx, guildID, userID, username); err != nil { return "", err }
// L17
if err := deleteGuildMembership(ctx, nk, userID); err != nil { return "", err }
// L18
if _, err := updateGuildAverageLeaderboardForGuild(ctx, nk, guildID); err != nil { return "", err }
// L19
if err := appendGuildAudit(ctx, nk, newGuildAudit(guildID, "member_left", userID, username, "", "", "Left the guild.")); err != nil { return "", err }
// L20
return mustJSON(map[string]interface{}{ "accepted": true, "guildId": guildID }), nil
```

- `L11`：讀取 roster 作為最終成員驗證。
- `L12`：roster 失敗時停止。
- `L13`：找出 caller 自己的 roster entry。
- `L14`：projection 有資料但 roster 不含 caller 時拒絕，避免錯誤離開。
- `L15`：owner 且仍有其他成員時不能 leave，必須先 transfer owner 或 disband。
- `L16`：從 Nakama authoritative roster 移除玩家。
- `L17`：同步刪除 user-scoped membership projection。
- `L18`：成員數變動後重算 guild average leaderboard。
- `L19`：保存離開 audit。
- `L20`：回傳 server 確認的離開結果。

## 3. `rpcDisbandGuildHandler`

```go
// L1
ownerID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
var input guildJoinPayload
// L4
if err := parsePayload(payload, &input); err != nil { return "", err }
// L5
if strings.TrimSpace(input.GuildID) == "" { return "", invalidArgument("guildId is required.") }
// L6
if err := ensureUserOwnsGuild(ctx, nk, input.GuildID, ownerID); err != nil { return "", err }
```

- `L1`：取得執行解散者的 authenticated ID。
- `L2`：沒有登入身分時停止。
- `L3`：建立含 guild ID 的 payload。
- `L4`：解析 client JSON。
- `L5`：缺 guild ID 時拒絕。
- `L6`：從 roster 驗證 caller 是 guild owner。

```go
// L7
members, err := listGuildMembers(ctx, nk, input.GuildID)
// L8
if err != nil { return "", err }
// L9
memberIDs := make([]string, 0, len(members))
// L10
for _, member := range members { if member.GetUser() != nil && member.GetUser().GetId() != "" { memberIDs = append(memberIDs, member.GetUser().GetId()) } }
// L11
if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "guild_disbanded", ownerID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), "", "", "Guild disbanded by owner.")); err != nil { return "", err }
// L12
if err := nk.GroupDelete(ctx, input.GuildID); err != nil { return "", err }
// L13
for _, memberID := range memberIDs { if err := deleteGuildMembership(ctx, nk, memberID); err != nil { return "", err } }
// L14
return mustJSON(map[string]interface{}{ "accepted": true, "guildId": input.GuildID }), nil
```

- `L7`：在刪除 group 前先取得 roster。
- `L8`：roster 讀取失敗時不進行解散。
- `L9`：建立要清理 projection 的 member ID 清單。
- `L10`：只加入有有效 user ID 的 roster 成員。
- `L11`：先保存解散 audit；之後 group 不存在仍能追溯事件。
- `L12`：由 Nakama 刪除 authoritative group。
- `L13`：逐一刪除所有成員的 membership projection。
- `L14`：回傳解散確認。
