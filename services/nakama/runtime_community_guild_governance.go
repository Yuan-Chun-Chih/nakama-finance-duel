package main

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

// 本檔案處理 Guild 角色升降、owner 移交與治理設定。

// rpcPromoteGuildAdminHandler 將 guild member 提升為 admin。
func rpcPromoteGuildAdminHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// promote admin 是 owner-only action。
	// UI 顯示按鈕不是安全邊界，這裡必須再次檢查 caller 是 owner。
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}
	var input guildMemberPayload
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	if err := ensureUserOwnsGuild(ctx, nk, input.GuildID, ownerID); err != nil {
		return "", err
	}
	members, err := listGuildMembers(ctx, nk, input.GuildID)
	if err != nil {
		return "", err
	}
	target := findGroupUserByID(members, input.UserID)
	if target == nil || target.GetUser() == nil || target.GetUser().GetId() == "" {
		return "", notFound("Guild member not found.")
	}
	if groupUserState(target) == 0 {
		// owner 已經是最高權限，不能再 promote。
		return "", failedPrecondition("Guild owner cannot be promoted.")
	}
	if groupUserState(target) == 1 {
		return "", failedPrecondition("Member is already an admin.")
	}

	if err := nk.GroupUsersPromote(ctx, ownerID, input.GuildID, []string{input.UserID}); err != nil {
		return "", err
	}
	// 同步 storage role，讓 dashboard / detail 不必每次都只靠 roster state 推導。
	if err := writeGuildMembership(ctx, nk, input.UserID, guildMembershipStorage{
		GuildID: input.GuildID,
		Role:    "admin",
	}); err != nil {
		return "", err
	}
	if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "admin_promoted", ownerID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), input.UserID, target.GetUser().GetUsername(), fmt.Sprintf("Promoted @%s to admin.", target.GetUser().GetUsername()))); err != nil {
		return "", err
	}

	logger.Info("Guild admin promoted: guild=%s owner=%s user=%s", input.GuildID, ownerID, input.UserID)
	return mustJSON(map[string]bool{"accepted": true}), nil
}

// rpcDemoteGuildAdminHandler 將 admin 降回一般 member。
func rpcDemoteGuildAdminHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// demote admin 也是 owner-only action。
	// owner 不能用這支 RPC 降級自己；owner transfer 要走 transfer_guild_owner。
	ownerID, err := requireUserID(ctx) // 檢查呼叫者是否有 userId，若沒有則回傳錯誤。
	if err != nil {
		return "", err
	}
	var input guildMemberPayload // demote admin 需要 guildId 與 target userId。
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	if err := ensureUserOwnsGuild(ctx, nk, input.GuildID, ownerID); err != nil { // 確認呼叫者是否為 guild owner，若不是則回傳錯誤。
		return "", err
	}
	members, err := listGuildMembers(ctx, nk, input.GuildID) // 取得 guild 成員列表，若失敗則回傳錯誤。
	if err != nil {
		return "", err
	}
	target := findGroupUserByID(members, input.UserID) // 找到要被降級的成員，若找不到則回傳錯誤。
	if target == nil || target.GetUser() == nil || target.GetUser().GetId() == "" {
		return "", notFound("Guild member not found.")
	}
	if groupUserState(target) == 0 { // 如果 target 是 owner，則回傳錯誤，因為 owner 不能被降級。
		return "", failedPrecondition("Guild owner cannot be demoted with this action.")
	}
	if groupUserState(target) != 1 { // 如果 target 不是 admin，則回傳錯誤，因為只有 admin 才能被降級。
		return "", failedPrecondition("Only admins can be demoted.")
	}

	if err := nk.GroupUsersDemote(ctx, ownerID, input.GuildID, []string{input.UserID}); err != nil { // 呼叫 Nakama API 將 target 降級為 member，若失敗則回傳錯誤。
		return "", err
	}
	if err := writeGuildMembership(ctx, nk, input.UserID, guildMembershipStorage{ // 同步 storage role，讓 dashboard / detail 不必每次都只靠 roster state 推導。
		GuildID: input.GuildID,
		Role:    "member",
	}); err != nil {
		return "", err
	}
	if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "admin_demoted", ownerID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), input.UserID, target.GetUser().GetUsername(), fmt.Sprintf("Demoted @%s back to member.", target.GetUser().GetUsername()))); err != nil { // 寫入 guild audit log，紀錄這次降級操作。
		return "", err
	}

	logger.Info("Guild admin demoted: guild=%s owner=%s user=%s", input.GuildID, ownerID, input.UserID)
	return mustJSON(map[string]bool{"accepted": true}), nil
}

// rpcTransferGuildOwnerHandler 執行 guild owner 轉移並更新雙方角色。
func rpcTransferGuildOwnerHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// owner transfer 是 guild governance 中風險最高的操作之一。
	// 成功後 target 成為 owner，原 owner 降為 admin，因此前端必須重新抓 detail/snapshot。
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}
	var input guildMemberPayload // transfer owner 需要 guildId 與 target userId。
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	operationKey := buildGuildOperationKey("owner_transfer", input.GuildID, ownerID, input.UserID, input.OperationID)
	operation, version, err := readGuildOperation(ctx, nk, operationKey)
	if err != nil {
		return "", err
	}
	if operation != nil {
		if operation.GuildID != input.GuildID || operation.ActorUserID != ownerID || operation.TargetUserID != input.UserID {
			return "", failedPrecondition("Guild operation identity does not match this request.")
		}
		if operation.Status == "completed" {
			return mustJSON(map[string]interface{}{"accepted": true, "operationId": operation.ID}), nil
		}
	}
	if operation == nil {
		if err := ensureUserOwnsGuild(ctx, nk, input.GuildID, ownerID); err != nil {
			return "", err
		}
		operation = &guildOperationRecord{
			ID: operationKey, GuildID: input.GuildID, Action: "owner_transfer", ActorUserID: ownerID,
			TargetUserID: input.UserID, Status: "pending", Step: "validated",
		}
		version, err = writeGuildOperation(ctx, nk, operation, "")
		if err != nil {
			return "", err
		}
	}
	failOperation := func(step string, cause error) (string, error) {
		operation.Status = "failed"
		operation.Step = step
		operation.LastError = cause.Error()
		_, _ = writeGuildOperation(ctx, nk, operation, version)
		return "", cause
	}
	members, err := listGuildMembers(ctx, nk, input.GuildID)
	if err != nil {
		return failOperation("read_roster", err)
	}
	target := findGroupUserByID(members, input.UserID)
	if target == nil || target.GetUser() == nil || target.GetUser().GetId() == "" {
		return failOperation("validate_target", notFound("Guild member not found."))
	}
	if input.UserID == ownerID {
		return failOperation("validate_target", failedPrecondition("Target member is already the owner."))
	}

	promotions, err := guildPromotionsToOwner(groupUserState(target))
	if err != nil {
		return failOperation("validate_target_state", err)
	}
	for promotion := 0; promotion < promotions; promotion++ {
		if err := nk.GroupUsersPromote(ctx, ownerID, input.GuildID, []string{input.UserID}); err != nil {
			return failOperation("promote_target", err)
		}
		operation.Status = "pending"
		operation.Step = fmt.Sprintf("target_promoted_%d", promotion+1)
		operation.LastError = ""
		version, err = writeGuildOperation(ctx, nk, operation, version)
		if err != nil {
			return "", err
		}
	}
	owner := findGroupUserByID(members, ownerID)
	if owner == nil {
		return failOperation("validate_owner_state", failedPrecondition("Current owner is no longer in the guild roster."))
	}
	if guildStateIsOwner(groupUserState(owner)) {
		if err := nk.GroupUsersDemote(ctx, ownerID, input.GuildID, []string{ownerID}); err != nil {
			return failOperation("demote_previous_owner", err)
		}
	} else if groupUserState(owner) != 1 {
		return failOperation("validate_owner_state", failedPrecondition("Previous owner has an unexpected guild role."))
	}

	if err := writeGuildMembership(ctx, nk, input.UserID, guildMembershipStorage{
		GuildID: input.GuildID,
		Role:    "owner",
	}); err != nil {
		return failOperation("write_target_membership", err)
	}
	if err := writeGuildMembership(ctx, nk, ownerID, guildMembershipStorage{
		GuildID: input.GuildID,
		Role:    "admin",
	}); err != nil {
		return failOperation("write_actor_membership", err)
	}
	audit := newGuildAudit(input.GuildID, "owner_transferred", ownerID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), input.UserID, target.GetUser().GetUsername(), fmt.Sprintf("Transferred guild ownership to @%s.", target.GetUser().GetUsername()))
	audit.ID = operation.ID + ":audit"
	if err := appendGuildAudit(ctx, nk, audit); err != nil {
		return failOperation("append_audit", err)
	}
	operation.Status = "completed"
	operation.Step = "completed"
	operation.LastError = ""
	if _, err := writeGuildOperation(ctx, nk, operation, version); err != nil {
		return "", err
	}
	logger.Info("Guild ownership transferred: guild=%s oldOwner=%s newOwner=%s", input.GuildID, ownerID, input.UserID)
	return mustJSON(map[string]interface{}{"accepted": true, "operationId": operation.ID}), nil
}

// rpcUpdateGuildSettingsHandler 更新 guild 公告與加入政策。
func rpcUpdateGuildSettingsHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}
	var input guildSettingsPayload
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	if strings.TrimSpace(input.GuildID) == "" {
		return "", invalidArgument("guildId is required.")
	}
	if err := ensureUserCanManageGuild(ctx, nk, input.GuildID, userID); err != nil {
		return "", err
	}
	current, err := readGuildConfig(ctx, nk, input.GuildID)
	if err != nil {
		return "", err
	}
	nextJoinPolicy := strings.TrimSpace(input.JoinPolicy)
	if nextJoinPolicy == "" {
		nextJoinPolicy = current.JoinPolicy
	}
	// 變更 join policy 影響整個 guild 的入場規則，因此只有 owner 可以改。
	if nextJoinPolicy != "request" && nextJoinPolicy != "invite_only" {
		return "", invalidArgument("joinPolicy must be request or invite_only.")
	}
	if nextJoinPolicy != current.JoinPolicy {
		if err := ensureUserOwnsGuild(ctx, nk, input.GuildID, userID); err != nil {
			return "", err
		}
	}
	next := guildConfigStorage{
		GuildID:       input.GuildID,
		Announcement:  strings.TrimSpace(input.Announcement),
		JoinPolicy:    nextJoinPolicy,
		UpdatedAt:     time.Now().UTC().Format(time.RFC3339),
		UpdatedBy:     userID,
		UpdatedByName: contextString(ctx, runtime.RUNTIME_CTX_USERNAME),
	}
	if err := writeGuildConfig(ctx, nk, input.GuildID, &next); err != nil {
		return "", err
	}
	if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "settings_updated", userID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), "", "", fmt.Sprintf("Updated guild settings. Join policy: %s.", next.JoinPolicy))); err != nil {
		return "", err
	}
	logger.Info("Guild settings updated: guild=%s by=%s", input.GuildID, userID)
	return mustJSON(map[string]interface{}{
		"accepted":     true,
		"announcement": next.Announcement,
		"joinPolicy":   next.JoinPolicy,
	}), nil
}
