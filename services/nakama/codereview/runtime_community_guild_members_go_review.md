# runtime_community_guild_members.go 逐行 Code Review

每段以 `L1`、`L2` 對照關鍵原始碼；可依編號逐行講解 invitation、join request、核准、拒絕與踢除。

## 1. `rpcInviteGuildMemberHandler`

```go
// L1
managerID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
var input guildInvitePayload
// L4
if err := parsePayload(payload, &input); err != nil { return "", err }
// L5
if input.GuildID == "" || strings.TrimSpace(input.Username) == "" { return "", invalidArgument("guildId and username are required.") }
// L6
if err := ensureUserCanManageGuild(ctx, nk, input.GuildID, managerID); err != nil { return "", err }
// L7
users, err := nk.UsersGetUsername(ctx, []string{strings.TrimSpace(input.Username)})
// L8
if err != nil { return "", err }
// L9
if len(users) == 0 || users[0].GetId() == "" { return "", notFound("Target username not found.") }
```

- `L1`：取得發出邀請的 authenticated manager ID。
- `L2`：未登入時停止。
- `L3`：建立邀請 payload。
- `L4`：解析 JSON。
- `L5`：guild ID 或 username 缺少時拒絕。
- `L6`：從 roster 驗證 caller 為 owner/admin。
- `L7`：以清理後的 username 向 Nakama 查詢目標 user。
- `L8`：查詢失敗時停止。
- `L9`：找不到目標 user 時回傳 not found。

```go
// L10
targetUser := users[0]
// L11
targetUserID := targetUser.GetId()
// L12
if err := ensureUserHasNoGuild(ctx, nk, targetUserID); err != nil { return "", err }
// L13
members, err := listGuildMembers(ctx, nk, input.GuildID)
// L14
if err != nil { return "", err }
// L15
if findGroupUserByID(members, targetUserID) != nil { return "", failedPrecondition("User already belongs to this guild.") }
// L16
if err := nk.GroupUsersAdd(ctx, managerID, input.GuildID, []string{targetUserID}); err != nil { return "", err }
// L17
if err := writeGuildMembership(ctx, nk, targetUserID, guildMembershipStorage{GuildID: input.GuildID, Role: "member"}); err != nil { return "", err }
// L18
if err := deleteGuildJoinRequestIfExists(ctx, nk, input.GuildID, targetUserID); err != nil { return "", err }
// L19
if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "member_invited", managerID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), targetUserID, targetUser.GetUsername(), fmt.Sprintf("Invited @%s into the guild.", targetUser.GetUsername()))); err != nil { return "", err }
// L20
return mustJSON(map[string]interface{}{ "accepted": true, "userId": targetUserID, "username": targetUser.GetUsername() }), nil
```

- `L10`：取出唯一目標 user。
- `L11`：保存目標 user ID。
- `L12`：確認目標沒有其他 guild。
- `L13`：讀取目標 guild roster。
- `L14`：roster 失敗時停止。
- `L15`：目標已在同 guild 時拒絕重複加入。
- `L16`：由 Nakama 將目標加入 authoritative roster。
- `L17`：同步建立 target 的 membership projection。
- `L18`：若目標原有 pending join request，清除它以避免重複狀態。
- `L19`：追加 member invited audit。
- `L20`：回傳邀請完成結果與 target 身分。

## 2. `rpcRequestGuildJoinHandler`

```go
// L1
userID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
if err := ensureUserHasNoGuild(ctx, nk, userID); err != nil { return "", err }
// L4
var input guildJoinPayload
// L5
if err := parsePayload(payload, &input); err != nil { return "", err }
// L6
guild, err := getGuildOrThrow(ctx, nk, input.GuildID)
// L7
if err != nil { return "", err }
// L8
members, err := listGuildMembers(ctx, nk, input.GuildID)
// L9
if err != nil { return "", err }
// L10
if findGroupUserByID(members, userID) != nil { return "", invalidArgument("User already belongs to this guild.") }
```

- `L1`：取得申請者 ID。
- `L2`：未登入時停止。
- `L3`：先確認申請者未加入其他 guild。
- `L4`：建立 join payload。
- `L5`：解析 JSON。
- `L6`：確認目標存在且確為 guild。
- `L7`：查 guild 失敗時停止。
- `L8`：讀取目標 roster。
- `L9`：roster 失敗時停止。
- `L10`：已在目標 guild 時拒絕建立 request。

```go
// L11
request := guildJoinRequestRecord{GuildID: input.GuildID, UserID: userID, Username: contextString(ctx, runtime.RUNTIME_CTX_USERNAME), RequestedAt: time.Now().UTC().Format(time.RFC3339), Status: "pending"}
// L12
config, err := readGuildConfig(ctx, nk, input.GuildID)
// L13
if err != nil { return "", err }
// L14
if config.JoinPolicy == "invite_only" { return "", failedPrecondition("This guild is currently invite only.") }
// L15
if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionGuildRequests, Key: buildGuildJoinRequestKey(input.GuildID, userID), UserID: "", Value: mustJSON(request), PermissionRead: 0, PermissionWrite: 0}}); err != nil { return "", err }
// L16
if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "join_requested", userID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), "", "", "Submitted a guild join request.")); err != nil { return "", err }
// L17
return mustJSON(map[string]interface{}{ "accepted": true, "guildId": guild.GetId() }), nil
```

- `L11`：由 server 建立 pending request，時間與 username 都來自 authenticated context/server clock。
- `L12`：讀取 guild config。
- `L13`：設定讀取失敗時停止。
- `L14`：invite-only guild 拒絕公開 request。
- `L15`：以 `<guildId>:<userId>` 寫入全域 request object，權限為 server-only。
- `L16`：追加 join requested audit。
- `L17`：回傳接受與已驗證的 guild ID。

## 3. `rpcApproveGuildJoinHandler`

```go
// L1
approverID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
var input guildMemberPayload
// L4
if err := parsePayload(payload, &input); err != nil { return "", err }
// L5
if err := ensureUserCanManageGuild(ctx, nk, input.GuildID, approverID); err != nil { return "", err }
// L6
request, err := getGuildJoinRequestOrThrow(ctx, nk, input.GuildID, input.UserID)
// L7
if err != nil { return "", err }
// L8
if err := ensureUserHasNoGuild(ctx, nk, input.UserID); err != nil { return "", err }
// L9
users, err := nk.UsersGetId(ctx, []string{input.UserID}, nil)
// L10
if err != nil { return "", err }
// L11
if len(users) == 0 { return "", notFound("Guild member not found.") }
```

- `L1`：取得核准者 ID。
- `L2`：未登入時停止。
- `L3`：建立包含 target user ID 的 payload。
- `L4`：解析 JSON。
- `L5`：驗證核准者是 owner/admin。
- `L6`：確認 pending request 存在並讀出其內容。
- `L7`：request 不存在或 storage 錯誤時停止。
- `L8`：再次確認 target 尚未加入其他 guild。
- `L9`：向 Nakama 確認 target user 存在。
- `L10`：查 user 失敗時停止。
- `L11`：沒有 user 時拒絕核准。

```go
// L12
if err := nk.GroupUsersAdd(ctx, approverID, input.GuildID, []string{input.UserID}); err != nil { return "", err }
// L13
if err := writeGuildMembership(ctx, nk, input.UserID, guildMembershipStorage{GuildID: input.GuildID, Role: "member"}); err != nil { return "", err }
// L14
if err := deleteGuildJoinRequest(ctx, nk, input.GuildID, input.UserID); err != nil { return "", err }
// L15
if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "join_approved", approverID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), input.UserID, users[0].GetUsername(), fmt.Sprintf("Approved @%s into the guild.", users[0].GetUsername()))); err != nil { return "", err }
// L16
return mustJSON(map[string]interface{}{ "accepted": true, "request": request }), nil
```

- `L12`：先將 target 加入 Nakama authoritative roster。
- `L13`：再建立 membership projection。
- `L14`：成功加入後移除 pending request。
- `L15`：追加核准 audit。
- `L16`：回傳核准結果與原 request。

## 4. `rpcRejectGuildJoinHandler`

```go
// L1
approverID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
var input guildMemberPayload
// L4
if err := parsePayload(payload, &input); err != nil { return "", err }
// L5
if err := ensureUserCanManageGuild(ctx, nk, input.GuildID, approverID); err != nil { return "", err }
// L6
if _, err := getGuildJoinRequestOrThrow(ctx, nk, input.GuildID, input.UserID); err != nil { return "", err }
// L7
if err := deleteGuildJoinRequest(ctx, nk, input.GuildID, input.UserID); err != nil { return "", err }
// L8
if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "join_rejected", approverID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), input.UserID, "", "Rejected a guild join request.")); err != nil { return "", err }
// L9
return mustJSON(map[string]bool{"accepted": true}), nil
```

- `L1`：取得拒絕者 ID。
- `L2`：未登入時停止。
- `L3`：建立 guild 與 target payload。
- `L4`：解析 JSON。
- `L5`：驗證拒絕者可管理 guild。
- `L6`：確認 request 存在，避免對不存在資料產生假成功。
- `L7`：刪除 pending request；不會修改 roster 或 membership。
- `L8`：保存拒絕 audit。
- `L9`：回傳成功。

## 5. `rpcKickGuildMemberHandler`

```go
// L1
managerID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
var input guildMemberPayload
// L4
if err := parsePayload(payload, &input); err != nil { return "", err }
// L5
if err := ensureUserCanManageGuild(ctx, nk, input.GuildID, managerID); err != nil { return "", err }
// L6
members, err := listGuildMembers(ctx, nk, input.GuildID)
// L7
if err != nil { return "", err }
// L8
target := findGroupUserByID(members, input.UserID)
// L9
if target == nil { return "", notFound("Guild member not found.") }
// L10
if groupUserState(target) == 0 { return "", failedPrecondition("Guild owner cannot be kicked.") }
```

- `L1`：取得執行踢除的 manager ID。
- `L2`：未登入時停止。
- `L3`：建立 guild/target payload。
- `L4`：解析 JSON。
- `L5`：驗證 caller 是 owner/admin。
- `L6`：讀取 authoritative roster。
- `L7`：roster 失敗時停止。
- `L8`：找出 target roster entry。
- `L9`：target 不在 guild 時回傳 not found。
- `L10`：owner 不可被 kick，必須使用 owner transfer 或 disband。

```go
// L11
if err := nk.GroupUsersKick(ctx, managerID, input.GuildID, []string{input.UserID}); err != nil { return "", err }
// L12
if err := deleteGuildMembership(ctx, nk, input.UserID); err != nil { return "", err }
// L13
if _, err := updateGuildAverageLeaderboardForGuild(ctx, nk, input.GuildID); err != nil { return "", err }
// L14
targetName := ""
// L15
if target.GetUser() != nil { targetName = target.GetUser().GetUsername() }
// L16
if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "member_kicked", managerID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), input.UserID, targetName, fmt.Sprintf("Removed @%s from the guild.", defaultString(targetName, input.UserID)))); err != nil { return "", err }
// L17
return mustJSON(map[string]bool{"accepted": true}), nil
```

- `L11`：由 Nakama 將 target 踢出 authoritative roster。
- `L12`：同步刪除 target membership projection。
- `L13`：成員變更後重算 guild average。
- `L14`：預設 audit 顯示名稱為空。
- `L15`：target 帶有 Nakama user 時取 username。
- `L16`：追加踢除 audit；沒有 username 時以 user ID 作 fallback。
- `L17`：回傳成功。
