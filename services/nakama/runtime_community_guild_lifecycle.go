package main

import (
	"context"
	"database/sql"
	"strings"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
)

// 本檔案處理 Guild 建立、主動離開與解散等生命週期命令。

// rpcCreateGuildHandler 建立 guild、初始 membership 與治理設定。
func rpcCreateGuildHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// 建立 guild 的規則比一般 group 嚴格：
	// - 使用者同時只能有一個 guild。
	// - guild 一律 private，加入流程由 request / invite 控制。
	// - 建立後必須初始化 membership、config、audit。
	userID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}
	if err := ensureUserHasNoGuild(ctx, nk, userID); err != nil {
		return "", err
	}

	var input createGuildPayload
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	if strings.TrimSpace(input.Name) == "" {
		return "", invalidArgument("Guild name is required.")
	}

	// 前端通常會先用原生 group API 建立 guild 容器，再由這支 RPC 完成
	// guild membership、設定與 audit 初始化。這樣規則仍由 server 收口。
	var group *api.Group
	if strings.TrimSpace(input.GuildID) != "" {
		// 兩階段建立路徑：
		// service.ts 先 createGroup(lang_tag="guild")，這裡再驗證 caller 是否該 group owner。
		group, err = getGuildOrThrow(ctx, nk, input.GuildID)
		if err != nil {
			return "", err
		}
		members, err := listGuildMembers(ctx, nk, input.GuildID)
		if err != nil {
			return "", err
		}
		owner := findGroupUserByID(members, userID)
		if owner == nil || groupUserState(owner) != 0 {
			return "", permissionDenied("Only the guild owner can finalize guild initialization.")
		}
	} else {
		// runtime 直接建立 group 的備援路徑。
		// 目前前端主要使用兩階段建立，但保留這條路徑方便測試或後續 server-only 建立。
		group, err = nk.GroupCreate(
			ctx,
			userID,
			strings.TrimSpace(input.Name),
			userID,
			"guild",
			strings.TrimSpace(input.Description),
			"",
			false,
			map[string]interface{}{},
			maxGuildMembers,
		)
		if err != nil {
			return "", err
		}
	}

	if err := writeGuildMembership(ctx, nk, userID, guildMembershipStorage{
		// owner membership 是 dashboard 判斷 primaryGuild 的關鍵資料。
		GuildID: group.GetId(),
		Role:    "owner",
	}); err != nil {
		return "", err
	}
	// guild 建立後立刻初始化 config 與 audit，確保 detail 頁第一次開啟就有完整治理資料。
	if err := writeGuildConfig(ctx, nk, group.GetId(), defaultGuildConfig(group.GetId(), userID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME))); err != nil {
		return "", err
	}
	if err := appendGuildAudit(ctx, nk, newGuildAudit(group.GetId(), "guild_created", userID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), "", "", "Guild created.")); err != nil {
		return "", err
	}

	logger.Info("Guild created by %s: %s", userID, group.GetId())
	return mustJSON(map[string]interface{}{
		"guildId":  group.GetId(),
		"accepted": true,
	}), nil
}

// rpcLeaveGuildHandler 讓目前使用者離開 guild 並清理 membership。
func rpcLeaveGuildHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// leave guild 是最容易發生前後端不同步的流程之一。
	// handler 會優先讀 guild_membership，但也接受 payload.guildId 作為 fallback。
	// 真正是否還是成員，最後仍以 group roster 裡是否找得到 selfEntry 為準。
	userID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}
	username := contextString(ctx, runtime.RUNTIME_CTX_USERNAME)
	var input guildLeavePayload
	if strings.TrimSpace(payload) != "" {
		if err := parsePayload(payload, &input); err != nil {
			return "", err
		}
	}
	membership, err := readGuildMembership(ctx, nk, userID)
	if err != nil {
		return "", err
	}
	guildID := strings.TrimSpace(input.GuildID)
	if membership != nil && membership.GuildID != "" {
		guildID = membership.GuildID
	}
	// payload.guildId 是前端同步落後時的保險；不要只依賴 guild_membership storage。
	if guildID == "" {
		return "", failedPrecondition("User does not belong to a guild.")
	}

	members, err := listGuildMembers(ctx, nk, guildID)
	if err != nil {
		return "", err
	}
	selfEntry := findGroupUserByID(members, userID)
	if selfEntry == nil {
		return "", failedPrecondition("User does not belong to the specified guild.")
	}
	if groupUserState(selfEntry) == 0 && len(members) > 1 {
		// owner 不能在還有其他成員時直接離開，否則 guild 會失去治理者。
		// 正確流程是先 transfer owner，或直接走 disband_guild。
		return "", failedPrecondition("Guild owner cannot leave while members remain.")
	}

	if err := nk.GroupUserLeave(ctx, guildID, userID, username); err != nil {
		return "", err
	}
	// GroupUserLeave 只處理 Nakama roster；本專案自己的 guild_membership 必須額外刪掉。
	if err := deleteGuildMembership(ctx, nk, userID); err != nil {
		return "", err
	}
	if _, err := updateGuildAverageLeaderboardForGuild(ctx, nk, guildID); err != nil {
		return "", err
	}
	if err := appendGuildAudit(ctx, nk, newGuildAudit(guildID, "member_left", userID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), "", "", "Left the guild.")); err != nil {
		return "", err
	}

	logger.Info("Guild leave completed: guild=%s user=%s", guildID, userID)
	return mustJSON(map[string]interface{}{
		"accepted": true,
		"guildId":  guildID,
	}), nil
}

// rpcDisbandGuildHandler 驗證 owner 身分後解散 guild。
func rpcDisbandGuildHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// disband 是 owner-only 的破壞性操作。
	// 它和 leave 不同：leave 只移除自己，disband 會刪除整個 guild group 並清除所有成員 membership。
	ownerID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}
	var input guildJoinPayload
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	if strings.TrimSpace(input.GuildID) == "" {
		return "", invalidArgument("guildId is required.")
	}
	if err := ensureUserOwnsGuild(ctx, nk, input.GuildID, ownerID); err != nil {
		return "", err
	}

	members, err := listGuildMembers(ctx, nk, input.GuildID)
	if err != nil {
		return "", err
	}
	memberIDs := make([]string, 0, len(members))
	for _, member := range members {
		// 先收集所有 member id，因為 GroupDelete 後 roster 就不能再可靠查詢。
		if member.GetUser() == nil || member.GetUser().GetId() == "" {
			continue
		}
		memberIDs = append(memberIDs, member.GetUser().GetId())
	}

	if err := appendGuildAudit(ctx, nk, newGuildAudit(input.GuildID, "guild_disbanded", ownerID, contextString(ctx, runtime.RUNTIME_CTX_USERNAME), "", "", "Guild disbanded by owner.")); err != nil {
		// audit 先寫入，再刪 group。即使 group 被刪，也保留治理事件紀錄。
		return "", err
	}
	if err := nk.GroupDelete(ctx, input.GuildID); err != nil {
		return "", err
	}
	for _, memberID := range memberIDs {
		// 清掉每個成員的 guild_membership，避免 dashboard 還顯示已被刪除的 guild。
		if err := deleteGuildMembership(ctx, nk, memberID); err != nil {
			return "", err
		}
	}
	logger.Info("Guild disbanded: guild=%s owner=%s members=%d", input.GuildID, ownerID, len(memberIDs))
	return mustJSON(map[string]interface{}{
		"accepted": true,
		"guildId":  input.GuildID,
	}), nil
}
