# runtime_community_guild_governance.go 逐行 Code Review

每段以 `L1`、`L2` 對照關鍵原始碼；可依編號逐行講解角色異動、owner transfer 冪等操作與設定管理。

## 1. `rpcPromoteGuildAdminHandler`

```go
// L1
ownerID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
var input guildMemberPayload
// L4
if err := parsePayload(payload, &input); err != nil { return "", err }
// L5
if err := ensureUserOwnsGuild(ctx, nk, input.GuildID, ownerID); err != nil { return "", err }
// L6
members, err := listGuildMembers(ctx, nk, input.GuildID)
// L7
if err != nil { return "", err }
// L8
target := findGroupUserByID(members, input.UserID)
// L9
if target == nil || target.GetUser() == nil || target.GetUser().GetId() == "" { return "", notFound("Guild member not found.") }
// L10
if groupUserState(target) == 0 { return "", failedPrecondition("Guild owner cannot be promoted.") }
// L11
if groupUserState(target) == 1 { return "", failedPrecondition("Member is already an admin.") }
// L12
if err := nk.GroupUsersPromote(ctx, ownerID, input.GuildID, []string{input.UserID}); err != nil { return "", err }
// L13
if err := writeGuildMembership(ctx, nk, input.UserID, guildMembershipStorage{GuildID: input.GuildID, Role: "admin"}); err != nil { return "", err }
// L14
if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "admin_promoted", ownerID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), input.UserID, target.GetUser().GetUsername(), fmt.Sprintf("Promoted @%s to admin.", target.GetUser().GetUsername()))); err != nil { return "", err }
// L15
return mustJSON(map[string]bool{"accepted": true}), nil
```

- `L1`：取得 owner 的 authenticated ID。
- `L2`：未登入時停止。
- `L3`：建立 guild/target payload。
- `L4`：解析 JSON。
- `L5`：從 roster 驗證 caller 是 owner。
- `L6`：讀取 authoritative roster。
- `L7`：roster 失敗時停止。
- `L8`：找出 target。
- `L9`：target 不存在或沒有有效 user 時拒絕。
- `L10`：owner 不可被 promote。
- `L11`：已是 admin 時拒絕重複操作。
- `L12`：由 Nakama 提升 target roster state。
- `L13`：同步 membership projection 為 `admin`。
- `L14`：追加角色異動 audit。
- `L15`：回傳成功。

## 2. `rpcDemoteGuildAdminHandler`

```go
// L1
ownerID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
var input guildMemberPayload
// L4
if err := parsePayload(payload, &input); err != nil { return "", err }
// L5
if err := ensureUserOwnsGuild(ctx, nk, input.GuildID, ownerID); err != nil { return "", err }
// L6
members, err := listGuildMembers(ctx, nk, input.GuildID)
// L7
if err != nil { return "", err }
// L8
target := findGroupUserByID(members, input.UserID)
// L9
if target == nil || target.GetUser() == nil || target.GetUser().GetId() == "" { return "", notFound("Guild member not found.") }
// L10
if groupUserState(target) == 0 { return "", failedPrecondition("Guild owner cannot be demoted with this action.") }
// L11
if groupUserState(target) != 1 { return "", failedPrecondition("Only admins can be demoted.") }
// L12
if err := nk.GroupUsersDemote(ctx, ownerID, input.GuildID, []string{input.UserID}); err != nil { return "", err }
// L13
if err := writeGuildMembership(ctx, nk, input.UserID, guildMembershipStorage{GuildID: input.GuildID, Role: "member"}); err != nil { return "", err }
// L14
if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "admin_demoted", ownerID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), input.UserID, target.GetUser().GetUsername(), fmt.Sprintf("Demoted @%s back to member.", target.GetUser().GetUsername()))); err != nil { return "", err }
// L15
return mustJSON(map[string]bool{"accepted": true}), nil
```

- `L1`：取得 caller ID。
- `L2`：未登入時停止。
- `L3`：建立 payload。
- `L4`：解析 JSON。
- `L5`：只允許 owner 執行 demote。
- `L6`：讀 roster。
- `L7`：讀取失敗時停止。
- `L8`：找 target。
- `L9`：target 無效時拒絕。
- `L10`：owner 不能透過此 action demote。
- `L11`：只有 state `1` 的 admin 可以 demote。
- `L12`：由 Nakama 降低 target roster state。
- `L13`：同步投影 role 為 member。
- `L14`：保存 demote audit。
- `L15`：回傳成功。

## 3. `rpcTransferGuildOwnerHandler`

```go
// L1
ownerID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
var input guildMemberPayload
// L4
if err := parsePayload(payload, &input); err != nil { return "", err }
// L5
operationKey := buildGuildOperationKey("owner_transfer", input.GuildID, ownerID, input.UserID, input.OperationID)
// L6
operation, version, err := readGuildOperation(ctx, nk, operationKey)
// L7
if err != nil { return "", err }
// L8
if operation != nil {
	if operation.GuildID != input.GuildID || operation.ActorUserID != ownerID || operation.TargetUserID != input.UserID { return "", failedPrecondition("Guild operation identity does not match this request.") }
	if operation.Status == "completed" { return mustJSON(map[string]interface{}{ "accepted": true, "operationId": operation.ID }), nil }
}
```

- `L1`：取得目前 owner 的 authenticated ID。
- `L2`：未登入時停止。
- `L3`：建立 transfer payload。
- `L4`：解析 JSON。
- `L5`：以動作、guild、actor、target 與 client operation ID 建立冪等 key。
- `L6`：讀取既有 operation 與其 CAS version。
- `L7`：storage 讀取失敗時停止。
- `L8`：重試請求若帶同 key，必須與原 actor/target/guild 完全相同；已完成時直接回傳成功，避免重複 promotion/demotion。

```go
// L9
if operation == nil {
	if err := ensureUserOwnsGuild(ctx, nk, input.GuildID, ownerID); err != nil { return "", err }
	operation = &guildOperationRecord{ID: operationKey, GuildID: input.GuildID, Action: "owner_transfer", ActorUserID: ownerID, TargetUserID: input.UserID, Status: "pending", Step: "validated"}
	version, err = writeGuildOperation(ctx, nk, operation, "")
	if err != nil { return "", err }
}
// L10
failOperation := func(step string, cause error) (string, error) {
	operation.Status = "failed"; operation.Step = step; operation.LastError = cause.Error()
	_, _ = writeGuildOperation(ctx, nk, operation, version)
	return "", cause
}
```

- `L9`：首次請求時驗證原 owner、建立 pending operation，並用空 version 進行 create-only 寫入。
- `L10`：建立失敗處理 closure；它保存失敗狀態、步驟與錯誤訊息，再把原始錯誤回傳。

```go
// L11
members, err := listGuildMembers(ctx, nk, input.GuildID)
// L12
if err != nil { return failOperation("read_roster", err) }
// L13
target := findGroupUserByID(members, input.UserID)
// L14
if target == nil || target.GetUser() == nil || target.GetUser().GetId() == "" { return failOperation("validate_target", notFound("Guild member not found.")) }
// L15
if input.UserID == ownerID { return failOperation("validate_target", failedPrecondition("Target member is already the owner.")) }
// L16
promotions, err := guildPromotionsToOwner(groupUserState(target))
// L17
if err != nil { return failOperation("validate_target_state", err) }
// L18
for promotion := 0; promotion < promotions; promotion++ {
	if err := nk.GroupUsersPromote(ctx, ownerID, input.GuildID, []string{input.UserID}); err != nil { return failOperation("promote_target", err) }
	operation.Status = "pending"; operation.Step = fmt.Sprintf("target_promoted_%d", promotion+1); operation.LastError = ""
	version, err = writeGuildOperation(ctx, nk, operation, version)
	if err != nil { return "", err }
}
```

- `L11`：讀取最新 roster，不能使用舊 operation 的 role 快照。
- `L12`：roster 失敗時保存 `read_roster` 失敗狀態。
- `L13`：找 target。
- `L14`：target 不存在時保存並回傳 not found。
- `L15`：禁止把 owner 轉讓給自己。
- `L16`：依 target 現有 state 計算要 promotion 幾次。
- `L17`：target 不是 active member 時保存失敗。
- `L18`：逐次呼叫 Nakama promotion；每成功一次都保存 operation step 與新版 CAS version，讓中斷後可追蹤進度。

```go
// L19
owner := findGroupUserByID(members, ownerID)
// L20
if owner == nil { return failOperation("validate_owner_state", failedPrecondition("Current owner is no longer in the guild roster.")) }
// L21
if guildStateIsOwner(groupUserState(owner)) {
	if err := nk.GroupUsersDemote(ctx, ownerID, input.GuildID, []string{ownerID}); err != nil { return failOperation("demote_previous_owner", err) }
} else if groupUserState(owner) != 1 { return failOperation("validate_owner_state", failedPrecondition("Previous owner has an unexpected guild role.")) }
// L22
if err := writeGuildMembership(ctx, nk, input.UserID, guildMembershipStorage{GuildID: input.GuildID, Role: "owner"}); err != nil { return failOperation("write_target_membership", err) }
// L23
if err := writeGuildMembership(ctx, nk, ownerID, guildMembershipStorage{GuildID: input.GuildID, Role: "admin"}); err != nil { return failOperation("write_actor_membership", err) }
```

- `L19`：在原本讀取的 roster 中找舊 owner。
- `L20`：舊 owner 已不在 roster 時保存失敗，不能安全完成 transfer。
- `L21`：舊 owner 仍為 owner 時由 Nakama demote；若不是 owner 也不是 admin，代表狀態不合理而失敗。
- `L22`：將 target projection 改為 owner。
- `L23`：將舊 owner projection 改為 admin。

```go
// L24
audit := newGuildAudit(input.GuildID, "owner_transferred", ownerID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), input.UserID, target.GetUser().GetUsername(), fmt.Sprintf("Transferred guild ownership to @%s.", target.GetUser().GetUsername()))
// L25
audit.ID = operation.ID + ":audit"
// L26
if err := appendGuildAudit(ctx, nk, audit); err != nil { return failOperation("append_audit", err) }
// L27
operation.Status = "completed"; operation.Step = "completed"; operation.LastError = ""
// L28
if _, err := writeGuildOperation(ctx, nk, operation, version); err != nil { return "", err }
// L29
return mustJSON(map[string]interface{}{ "accepted": true, "operationId": operation.ID }), nil
```

- `L24`：建立 owner transfer audit。
- `L25`：audit ID 綁定 operation ID，重試時不會因時間不同產生重複 audit。
- `L26`：追加 audit 失敗時記錄 operation 失敗。
- `L27`：所有 roster、projection、audit 步驟完成後標記 operation completed。
- `L28`：使用最新版 CAS version 保存 completed 結果。
- `L29`：回傳成功與 operation ID。

## 4. `rpcUpdateGuildSettingsHandler`

```go
// L1
userID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
var input guildSettingsPayload
// L4
if err := parsePayload(payload, &input); err != nil { return "", err }
// L5
if strings.TrimSpace(input.GuildID) == "" { return "", invalidArgument("guildId is required.") }
// L6
if err := ensureUserCanManageGuild(ctx, nk, input.GuildID, userID); err != nil { return "", err }
// L7
current, err := readGuildConfig(ctx, nk, input.GuildID)
// L8
if err != nil { return "", err }
```

- `L1`：取得 caller ID。
- `L2`：未登入時停止。
- `L3`：建立 settings payload。
- `L4`：解析 JSON。
- `L5`：guild ID 不可空白。
- `L6`：owner/admin 可更新一般設定。
- `L7`：讀取目前 config。
- `L8`：讀取失敗時停止。

```go
// L9
nextJoinPolicy := strings.TrimSpace(input.JoinPolicy)
// L10
if nextJoinPolicy == "" { nextJoinPolicy = current.JoinPolicy }
// L11
if nextJoinPolicy != "request" && nextJoinPolicy != "invite_only" { return "", invalidArgument("joinPolicy must be request or invite_only.") }
// L12
if nextJoinPolicy != current.JoinPolicy { if err := ensureUserOwnsGuild(ctx, nk, input.GuildID, userID); err != nil { return "", err } }
// L13
next := guildConfigStorage{GuildID: input.GuildID, Announcement: strings.TrimSpace(input.Announcement), JoinPolicy: nextJoinPolicy, UpdatedAt: time.Now().UTC().Format(time.RFC3339), UpdatedBy: userID, UpdatedByName: contextString(ctx, runtime.RUNTIME_CTX_USERNAME)}
// L14
if err := writeGuildConfig(ctx, nk, input.GuildID, &next); err != nil { return "", err }
// L15
if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "settings_updated", userID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), "", "", fmt.Sprintf("Updated guild settings. Join policy: %s.", next.JoinPolicy))); err != nil { return "", err }
// L16
return mustJSON(map[string]interface{}{ "accepted": true, "announcement": next.Announcement, "joinPolicy": next.JoinPolicy }), nil
```

- `L9`：讀取清理後的 join policy 輸入。
- `L10`：未提供 policy 時沿用現有值。
- `L11`：只允許兩種明確政策。
- `L12`：變更加入政策的影響較大，因此需 owner 而不只是 admin。
- `L13`：建立 server 時間、server caller ID 與清理後公告的下一版 config。
- `L14`：保存 config。
- `L15`：追加設定更新 audit。
- `L16`：回傳已保存的設定值。
