package main

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

// 本檔案處理 Guild 邀請、加入申請、核准、拒絕與踢除成員。

// rpcInviteGuildMemberHandler 驗證管理權限並邀請指定使用者加入 guild。
func rpcInviteGuildMemberHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// invite 是管理者主動加入成員，不需要 target 先申請。
	// 仍必須檢查 caller 權限、target user 是否存在、target 是否已有 guild。
	managerID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}
	// invite guild member 需要管理權限，通常是 owner 或 admin。
	var input guildInvitePayload
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	if input.GuildID == "" || strings.TrimSpace(input.Username) == "" {
		return "", invalidArgument("guildId and username are required.")
	}
	if err := ensureUserCanManageGuild(ctx, nk, input.GuildID, managerID); err != nil {
		return "", err
	}

	users, err := nk.UsersGetUsername(ctx, []string{strings.TrimSpace(input.Username)})
	if err != nil {
		return "", err
	}
	if len(users) == 0 || users[0].GetId() == "" {
		return "", notFound("Target username not found.")
	}

	targetUser := users[0]
	targetUserID := targetUser.GetId()
	if err := ensureUserHasNoGuild(ctx, nk, targetUserID); err != nil {
		return "", err
	}
	members, err := listGuildMembers(ctx, nk, input.GuildID)
	if err != nil {
		return "", err
	}
	if findGroupUserByID(members, targetUserID) != nil {
		return "", failedPrecondition("User already belongs to this guild.")
	}
	// invite 會直接把 target 加入 guild，並更新 guild_membership storage。
	if err := nk.GroupUsersAdd(ctx, managerID, input.GuildID, []string{targetUserID}); err != nil {
		return "", err
	}
	// GroupUsersAdd 只更新 Nakama roster；本專案還要同步 guild_membership storage。
	if err := writeGuildMembership(ctx, nk, targetUserID, guildMembershipStorage{
		GuildID: input.GuildID,
		Role:    "member",
	}); err != nil {
		return "", err
	}
	if err := deleteGuildJoinRequestIfExists(ctx, nk, input.GuildID, targetUserID); err != nil {
		// 如果該 user 原本有 pending request，邀請成功後要刪掉，避免 detail 頁出現矛盾狀態。
		return "", err
	}
	if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "member_invited", managerID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), targetUserID, targetUser.GetUsername(), fmt.Sprintf("Invited @%s into the guild.", targetUser.GetUsername()))); err != nil {
		return "", err
	}

	logger.Info("Guild member invited: guild=%s manager=%s user=%s", input.GuildID, managerID, targetUserID)
	return mustJSON(map[string]interface{}{
		"accepted": true,
		"userId":   targetUserID,
		"username": targetUser.GetUsername(),
	}), nil
}

// rpcRequestGuildJoinHandler 建立玩家加入 guild 的待審核申請。
func rpcRequestGuildJoinHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// request join 不會直接把 user 加入 group。
	// 它只建立 pending request，由 owner/admin 後續 approve/reject。
	userID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}
	if err := ensureUserHasNoGuild(ctx, nk, userID); err != nil {
		return "", err
	}
	var input guildJoinPayload
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	guild, err := getGuildOrThrow(ctx, nk, input.GuildID)
	if err != nil {
		return "", err
	}
	members, err := listGuildMembers(ctx, nk, input.GuildID)
	if err != nil {
		return "", err
	}
	if findGroupUserByID(members, userID) != nil {
		return "", invalidArgument("User already belongs to this guild.")
	}

	request := guildJoinRequestRecord{
		// request record 會用 guildId:userId 當 storage key，因此同一 user 對同一 guild 只會有一筆 pending request。
		GuildID:     input.GuildID,
		UserID:      userID,
		Username:    contextString(ctx, runtime.RUNTIME_CTX_USERNAME),
		RequestedAt: time.Now().UTC().Format(time.RFC3339),
		Status:      "pending",
	}
	config, err := readGuildConfig(ctx, nk, input.GuildID)
	if err != nil {
		return "", err
	}
	// invite_only 必須由後端強制拒絕，不能只靠前端隱藏「Request to join」按鈕。
	if config.JoinPolicy == "invite_only" {
		return "", failedPrecondition("This guild is currently invite only.")
	}
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{
		{
			Collection:      collectionGuildRequests,
			Key:             buildGuildJoinRequestKey(input.GuildID, userID),
			UserID:          "",
			Value:           mustJSON(request),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
	}); err != nil {
		return "", err
	}
	if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "join_requested", userID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), "", "", "Submitted a guild join request.")); err != nil {
		return "", err
	}

	logger.Info("Guild join requested: guild=%s user=%s", input.GuildID, userID)
	return mustJSON(map[string]interface{}{
		"accepted": true,
		"guildId":  guild.GetId(),
	}), nil
}

// rpcApproveGuildJoinHandler 核准申請並寫入 guild membership。
func rpcApproveGuildJoinHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// approve 是 request join 的完成路徑。
	// 它必須同時處理 roster、membership、request 清理與 audit，缺一個都會造成前端狀態不一致。
	approverID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}
	var input guildMemberPayload // approve guild join 需要 guildId 與 target userId。
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	if err := ensureUserCanManageGuild(ctx, nk, input.GuildID, approverID); err != nil {
		return "", err
	}
	request, err := getGuildJoinRequestOrThrow(ctx, nk, input.GuildID, input.UserID)
	if err != nil {
		return "", err
	}
	if err := ensureUserHasNoGuild(ctx, nk, input.UserID); err != nil {
		return "", err
	}
	users, err := nk.UsersGetId(ctx, []string{input.UserID}, nil)
	if err != nil {
		return "", err
	}
	if len(users) == 0 {
		return "", notFound("Guild member not found.")
	}
	// 這裡同時更新 Nakama group roster 與 guild_membership storage。
	// 前者影響原生聊天/名單能力，後者影響單一公會限制與治理規則。
	if err := nk.GroupUsersAdd(ctx, approverID, input.GuildID, []string{input.UserID}); err != nil {
		return "", err
	}
	if err := writeGuildMembership(ctx, nk, input.UserID, guildMembershipStorage{
		GuildID: input.GuildID,
		Role:    "member",
	}); err != nil {
		return "", err
	}
	if err := deleteGuildJoinRequest(ctx, nk, input.GuildID, input.UserID); err != nil {
		return "", err
	}
	if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "join_approved", approverID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), input.UserID, users[0].GetUsername(), fmt.Sprintf("Approved @%s into the guild.", users[0].GetUsername()))); err != nil {
		return "", err
	}

	logger.Info("Guild join approved: guild=%s approver=%s user=%s", input.GuildID, approverID, input.UserID)
	return mustJSON(map[string]interface{}{
		"accepted": true,
		"request":  request,
	}), nil
}

// rpcRejectGuildJoinHandler 拒絕並移除待審核加入申請。
func rpcRejectGuildJoinHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// reject 只刪 pending request，不應把 user 加進 roster，也不應寫 membership。
	approverID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}
	var input guildMemberPayload // reject guild join 需要 guildId 與 target userId。
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	if err := ensureUserCanManageGuild(ctx, nk, input.GuildID, approverID); err != nil {
		return "", err
	}
	if _, err := getGuildJoinRequestOrThrow(ctx, nk, input.GuildID, input.UserID); err != nil {
		return "", err
	}
	if err := deleteGuildJoinRequest(ctx, nk, input.GuildID, input.UserID); err != nil {
		return "", err
	}
	// 被拒絕的申請同樣要進 audit，否則後續無法回溯治理決策。
	if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "join_rejected", approverID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), input.UserID, "", "Rejected a guild join request.")); err != nil {
		return "", err
	}

	logger.Info("Guild join rejected: guild=%s approver=%s user=%s", input.GuildID, approverID, input.UserID)
	return mustJSON(map[string]bool{"accepted": true}), nil
}

// rpcKickGuildMemberHandler 將指定 member 從 guild 移除。
func rpcKickGuildMemberHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// kick 是管理者移除其他成員的路徑。
	// target 不能是 owner；如果要移除 owner，必須先 transfer owner。
	managerID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}
	var input guildMemberPayload
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	if err := ensureUserCanManageGuild(ctx, nk, input.GuildID, managerID); err != nil {
		return "", err
	}

	members, err := listGuildMembers(ctx, nk, input.GuildID)
	if err != nil {
		return "", err
	}
	target := findGroupUserByID(members, input.UserID)
	if target == nil {
		return "", notFound("Guild member not found.")
	}
	// owner 不能透過一般 kick 流程移除，否則 guild 會失去明確治理主體。
	if groupUserState(target) == 0 {
		return "", failedPrecondition("Guild owner cannot be kicked.")
	}

	if err := nk.GroupUsersKick(ctx, managerID, input.GuildID, []string{input.UserID}); err != nil {
		return "", err
	}
	if err := deleteGuildMembership(ctx, nk, input.UserID); err != nil {
		return "", err
	}
	if _, err := updateGuildAverageLeaderboardForGuild(ctx, nk, input.GuildID); err != nil {
		return "", err
	}
	targetName := ""
	if target.GetUser() != nil {
		targetName = target.GetUser().GetUsername()
	}
	if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "member_kicked", managerID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), input.UserID, targetName, fmt.Sprintf("Removed @%s from the guild.", defaultString(targetName, input.UserID)))); err != nil {
		return "", err
	}

	logger.Info("Guild member kicked: guild=%s manager=%s user=%s", input.GuildID, managerID, input.UserID)
	return mustJSON(map[string]bool{"accepted": true}), nil
}
