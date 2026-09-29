package main

import (
	"context"
	"database/sql"
	"strings"

	"github.com/heroiclabs/nakama-common/runtime"
)

// 本檔案處理 Guild 申請清單、完整 detail read model 與使用者搜尋。

// rpcListGuildJoinRequestsHandler 回傳管理者可查看的加入申請清單。
func rpcListGuildJoinRequestsHandler(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}
	var input guildJoinPayload
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	if err := ensureUserCanManageGuild(ctx, nk, input.GuildID, userID); err != nil {
		return "", err
	}
	// 待審核申請屬於治理資料，只允許 owner/admin 查看。
	requests, err := listGuildJoinRequestsForGuild(ctx, nk, input.GuildID)
	if err != nil {
		return "", err
	}
	return mustJSON(map[string]interface{}{
		"guildId":  input.GuildID,
		"requests": requests,
	}), nil
}

// rpcGetGuildDetailHandler 組合 guild、member、audit 與 contribution read model。
func rpcGetGuildDetailHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	if _, err := requireUserID(ctx); err != nil {
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
	if err := reconcileGuildMembershipProjections(ctx, nk, input.GuildID, members); err != nil {
		logger.Warn("Guild membership reconciliation failed guild=%s: %v", input.GuildID, err)
	}
	requests, err := listGuildJoinRequestsForGuild(ctx, nk, input.GuildID)
	if err != nil {
		return "", err
	}
	config, err := readGuildConfig(ctx, nk, input.GuildID)
	if err != nil {
		return "", err
	}
	// guild detail 這裡一次把 config / audit / contribution 整理成讀模型，
	// 前端就不需要自己拼多條 RPC 與 storage 結果。
	auditLog, err := listGuildAuditLog(ctx, nk, input.GuildID, 30)
	if err != nil {
		return "", err
	}
	viewer := findGroupUserByID(members, contextString(ctx, runtime.RUNTIME_CTX_USER_ID))
	memberViews, contributionViews, averageScore, submittedMembers := buildGuildMemberAndContributionViews(ctx, nk, members)

	return mustJSON(map[string]interface{}{
		"guild": map[string]interface{}{
			"id":           guild.GetId(),
			"name":         guild.GetName(),
			"description":  guild.GetDescription(),
			"kind":         "guild",
			"memberCount":  len(members),
			"viewerRole":   mapGuildStateToRole(stateOf(viewer)),
			"announcement": config.Announcement,
			"joinPolicy":   config.JoinPolicy,
		},
		"members":       memberViews,
		"requests":      requests,
		"audit":         auditLog,
		"contributions": contributionViews,
		"metrics": map[string]interface{}{
			"averageScore":     averageScore,
			"submittedMembers": submittedMembers,
		},
	}), nil
}

// rpcSearchUsersHandler 透過 Nakama SQL 查詢使用者公開資料。
func rpcSearchUsersHandler(ctx context.Context, _ runtime.Logger, db *sql.DB, _ runtime.NakamaModule, payload string) (string, error) {
	// search_users 給前端 Add friend by username 使用。
	// 這裡直接查 users table，是因為 Nakama 原生 API 沒有提供足夠彈性的模糊搜尋。
	userID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}

	var input userSearchPayload
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}

	query := strings.ToLower(strings.TrimSpace(input.Query))
	if query == "" {
		return mustJSON(map[string]interface{}{"users": []map[string]interface{}{}}), nil
	}

	limit := input.Limit
	if limit <= 0 || limit > 10 {
		// 對外搜尋一定要限制上限，避免使用者輸入空泛關鍵字造成大量查詢。
		limit = 8
	}

	pattern := "%" + query + "%"
	prefix := query + "%"

	rows, err := db.QueryContext(ctx, `
		SELECT id::text, username, COALESCE(display_name, '')
		FROM users
		WHERE id <> $1
		  AND (
		    LOWER(username) LIKE $2
		    OR LOWER(COALESCE(display_name, '')) LIKE $2
		  )
			ORDER BY
			  -- 排序策略：完全命中 username 最前，其次 username prefix，再其次 display_name prefix。
			  CASE
		    WHEN LOWER(username) = $3 THEN 0
		    WHEN LOWER(username) LIKE $4 THEN 1
		    WHEN LOWER(COALESCE(display_name, '')) LIKE $4 THEN 2
		    ELSE 3
		  END,
		  username ASC
		LIMIT $5
	`, userID, pattern, query, prefix, limit)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	users := make([]map[string]interface{}, 0)
	for rows.Next() {
		var candidateID string
		var username string
		var displayName string
		if err := rows.Scan(&candidateID, &username, &displayName); err != nil {
			return "", err
		}
		users = append(users, map[string]interface{}{
			"userId":      candidateID,
			"username":    username,
			"displayName": displayName,
		})
	}
	if err := rows.Err(); err != nil {
		return "", err
	}

	return mustJSON(map[string]interface{}{"users": users}), nil
}
