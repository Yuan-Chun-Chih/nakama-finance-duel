package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"math"
	"time"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
)

// 本檔案負責分數提交、排行榜設定與 guild average 聚合。

// rpcGetPhaseConfigHandler 回傳目前 phase 設定。
func rpcGetPhaseConfigHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ string) (string, error) {
	// 前端開機時會先讀這份設定，避免把 RPC id、榜單 id 與驗證規則硬寫死在 UI 內。
	// 這也讓前端能在 debug 時確認目前連到的 runtime 是否註冊了預期功能。
	logger.Info("Go rpcGetPhaseConfig invoked")
	return mustJSON(map[string]interface{}{
		"leaderboardIds": map[string]string{
			"global":       leaderboardGlobal,
			"weekly":       leaderboardWeekly,
			"guildAverage": leaderboardGuildAverage,
		},
		"rpcIds": map[string]string{
			"getPhaseConfig":        rpcGetPhaseConfig,
			"submitPortfolioScore":  rpcSubmitPortfolioScore,
			"createGuild":           rpcCreateGuild,
			"inviteGuildMember":     rpcInviteGuildMember,
			"promoteGuildAdmin":     rpcPromoteGuildAdmin,
			"demoteGuildAdmin":      rpcDemoteGuildAdmin,
			"transferGuildOwner":    rpcTransferGuildOwner,
			"requestGuildJoin":      rpcRequestGuildJoin,
			"approveGuildJoin":      rpcApproveGuildJoin,
			"rejectGuildJoin":       rpcRejectGuildJoin,
			"leaveGuild":            rpcLeaveGuild,
			"disbandGuild":          rpcDisbandGuild,
			"kickGuildMember":       rpcKickGuildMember,
			"listGuildJoinRequests": rpcListGuildJoinRequests,
			"getGuildDetail":        rpcGetGuildDetail,
			"updateGuildSettings":   rpcUpdateGuildSettings,
			"searchUsers":           rpcSearchUsers,
		},
		"guildPolicy": map[string]interface{}{ // guildPolicy 是 guild 的治理規則，包含了單一 guild、預設角色、擁有者專屬操作與榜單 metric。
			"singleGuildPerUser": true,
			"defaultRoles":       []string{"owner", "admin", "member"},
			"ownerOnlyActions":   []string{"promote_admin", "demote_admin", "transfer_owner"},
			"leaderboardMetric":  "average_return",
		},
		"validationPolicy": map[string]interface{}{ // validationPolicy 是分數驗證規則，包含了分數範圍、整數限制與冷卻時間。
			"score": map[string]interface{}{
				"min":                     -maxPortfolioScore,
				"max":                     maxPortfolioScore,
				"integerOnly":             true,
				"cooldownMs":              scoreSubmissionCooldownMS,
				"authoritativeOnly":       true,
				"clientSubmissionEnabled": environmentFlag("ALLOW_CLIENT_PORTFOLIO_SCORE_SUBMISSION"),
			},
			"guild": map[string]interface{}{ // guild 是 guild 的限制規則，包含了最大成員數與擁有者離開限制。
				"maxMembers":                      maxGuildMembers,
				"ownerCannotLeaveIfMembersRemain": true,
			},
		},
	}), nil
}

// rpcSubmitPortfolioScoreHandler 驗證並保存玩家的投組分數。
func rpcSubmitPortfolioScoreHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// 送分是排行榜與 guild contribution 的唯一寫入入口。
	// 前端不能直接寫 leaderboard，必須由 runtime 驗證 score、cooldown，再決定要寫哪些資料。
	userID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}
	if !environmentFlag("ALLOW_CLIENT_PORTFOLIO_SCORE_SUBMISSION") {
		return "", permissionDenied("Client portfolio score submission is disabled. Scores are written by authoritative settlement.")
	}

	username := contextString(ctx, runtime.RUNTIME_CTX_USERNAME)
	logger.Info("Go rpcSubmitPortfolioScore invoked user=%s", userID)

	var input submitPortfolioScorePayload
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	// validateScore 控制數值合法性；enforceScoreSubmissionPolicy 控制短時間重複提交。
	if err := validateScore(input.Score); err != nil {
		return "", err
	}
	if err := enforceScoreSubmissionPolicy(ctx, nk, userID, input.Score); err != nil {
		return "", err
	}

	// 先把分數落在 storage，讓 leaderboard、guild contribution 與 cooldown
	// 共用同一份 authoritative 資料來源。
	submittedAt := time.Now().UTC().Format(time.RFC3339)
	scoreValue := mustJSON(portfolioScoreStorage{
		Score:     input.Score,
		UpdatedAt: submittedAt,
	})
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{
		{
			Collection:      collectionPortfolioScores,
			Key:             portfolioScoreKey,
			UserID:          userID,
			Value:           scoreValue,
			PermissionRead:  0,
			PermissionWrite: 0,
		},
	}); err != nil {
		return "", err
	}
	// 這裡的 metadata 會被 leaderboard 聚合，並在 detail 頁顯示分數來源與提交時間。
	metadata := map[string]interface{}{
		"source":      defaultString(input.Source, "rpc"),
		"submittedAt": submittedAt,
		"version":     2,
	}
	// leaderboardGlobal 與 leaderboardWeekly 是 authoritative leaderboard，由 server 決定如何寫入與聚合。
	globalRecord, err := nk.LeaderboardRecordWrite(ctx, leaderboardGlobal, userID, username, input.Score, 0, metadata, nil)
	if err != nil {
		return "", err
	}
	weeklyRecord, err := nk.LeaderboardRecordWrite(ctx, leaderboardWeekly, userID, username, input.Score, 0, metadata, nil)
	if err != nil {
		return "", err
	}

	// guild average 不是 client 直接提交，而是 server 依 guild 成員最新分數重算。
	// 如果 user 沒有 guild，updateGuildAverageLeaderboard 會回 nil，不視為錯誤。
	guildAverageRecord, err := updateGuildAverageLeaderboard(ctx, nk, userID)
	if err != nil {
		return "", err
	}

	logger.Info("Portfolio score submitted by %s: %d", userID, input.Score)
	// 回傳成功訊息，包含 leaderboard id 與各榜單的最新紀錄。
	var guildSummary *leaderboardRecordSummary
	if guildAverageRecord != nil {
		summary, err := toGuildAverageSummary(ctx, nk, userID, guildAverageRecord)
		if err != nil {
			return "", err
		}
		guildSummary = summary
	}
	// 回傳成功訊息，包含 leaderboard id 與各榜單的最新紀錄。
	return mustJSON(map[string]interface{}{
		"accepted": true,
		"leaderboardIds": map[string]string{
			"global":       leaderboardGlobal,
			"weekly":       leaderboardWeekly,
			"guildAverage": leaderboardGuildAverage,
		},
		"records": map[string]interface{}{
			"global":       toRecordSummary(globalRecord, userID, username),
			"weekly":       toRecordSummary(weeklyRecord, userID, username),
			"guildAverage": guildSummary,
		},
	}), nil
}

// projectFinanceResultLeaderboards 將 authoritative 對局結算的報酬率投影到個人與公會排行榜。
func projectFinanceResultLeaderboards(ctx context.Context, nk runtime.NakamaModule, state *financeAuthoritativeMatchState) error {
	projection := financeLeaderboardProjectionRecord{
		ArenaID: state.ArenaID, Scores: map[string]int64{}, Usernames: map[string]string{}, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	for _, userID := range state.Players {
		portfolio := state.Portfolios[userID]
		if portfolio == nil {
			return failedPrecondition("Finance settlement portfolio is unavailable.")
		}
		projection.Scores[userID] = portfolio.ReturnBps
		projection.Usernames[userID] = state.Usernames[userID]
	}
	return projectFinanceLeaderboardRecord(ctx, nk, projection)
}

// projectFinanceLeaderboardRecord 寫入排行榜與公會平均，全部完成後才刪除 outbox record。
func projectFinanceLeaderboardRecord(ctx context.Context, nk runtime.NakamaModule, projection financeLeaderboardProjectionRecord) error {
	submittedAt := time.Now().UTC().Format(time.RFC3339)
	for userID, score := range projection.Scores {
		if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
			Collection: collectionPortfolioScores, Key: portfolioScoreKey, UserID: userID,
			Value:          mustJSON(portfolioScoreStorage{Score: score, UpdatedAt: submittedAt}),
			PermissionRead: 0, PermissionWrite: 0,
		}}); err != nil {
			return err
		}
		metadata := map[string]interface{}{
			"source": "finance_authoritative_settlement", "arenaId": projection.ArenaID,
			"submittedAt": submittedAt, "version": 3,
		}
		username := projection.Usernames[userID]
		if _, err := nk.LeaderboardRecordWrite(ctx, leaderboardGlobal, userID, username, score, 0, metadata, nil); err != nil {
			return err
		}
		if _, err := nk.LeaderboardRecordWrite(ctx, leaderboardWeekly, userID, username, score, 0, metadata, nil); err != nil {
			return err
		}
		if _, err := updateGuildAverageLeaderboard(ctx, nk, userID); err != nil {
			return err
		}
	}
	return nk.StorageDelete(ctx, []*runtime.StorageDelete{{Collection: collectionFinanceLeaderboardProjection, Key: projection.ArenaID, UserID: ""}})
}

// updateGuildAverageLeaderboard 依使用者最新分數更新 guild average leaderboard。
func updateGuildAverageLeaderboard(ctx context.Context, nk runtime.NakamaModule, userID string) (*api.LeaderboardRecord, error) {
	// 從 userID 找 guild，再重算該 guild 平均分。
	// 沒有 guild 時回 nil，代表這次 submit score 不影響 guild leaderboard。
	membership, err := readGuildMembership(ctx, nk, userID)
	if err != nil || membership == nil {
		return nil, err
	}
	return updateGuildAverageLeaderboardForGuild(ctx, nk, membership.GuildID)
}

// updateGuildAverageLeaderboardForGuild 計算指定 guild 的平均投組分數。
func updateGuildAverageLeaderboardForGuild(ctx context.Context, nk runtime.NakamaModule, guildID string) (*api.LeaderboardRecord, error) {
	// guild average 計算方式：
	// 1. 以 Nakama group roster 找 active members。
	// 2. 批次讀每個 member 的 portfolio_scores/latest。
	// 3. 只統計有分數的 member。
	// 4. 用 guildID 當 leaderboard owner id 寫入 guild average 榜。
	guild, err := getGuildOrThrow(ctx, nk, guildID)
	if err != nil {
		return nil, err
	}
	members, err := listGuildMembers(ctx, nk, guildID)
	if err != nil {
		return nil, err
	}
	memberIDs := make([]string, 0, len(members))
	for _, member := range members {
		if user := member.GetUser(); user != nil && user.GetId() != "" {
			memberIDs = append(memberIDs, user.GetId())
		}
	}
	if len(memberIDs) == 0 {
		// 沒有成員就不寫榜單。
		return nil, nil
	}

	reads := make([]*runtime.StorageRead, 0, len(memberIDs))
	for _, memberID := range memberIDs {
		reads = append(reads, &runtime.StorageRead{
			Collection: collectionPortfolioScores,
			Key:        portfolioScoreKey,
			UserID:     memberID,
		})
	}
	objects, err := nk.StorageRead(ctx, reads)
	if err != nil {
		return nil, err
	}

	var total int64
	counted := 0
	for _, object := range objects {
		if object == nil || object.GetValue() == "" {
			continue
		}
		var score portfolioScoreStorage
		if err := json.Unmarshal([]byte(object.GetValue()), &score); err != nil {
			continue
		}
		total += score.Score
		counted++
	}
	if counted == 0 {
		// 有成員但沒人提交 score，也不寫 guild average record。
		return nil, nil
	}

	average := int64(math.Round(float64(total) / float64(counted)))
	return nk.LeaderboardRecordWrite(ctx, leaderboardGuildAverage, guildID, guild.GetName(), average, int64(counted), map[string]interface{}{
		"guildId":     guildID,
		"metric":      "average_return",
		"memberCount": counted,
	}, nil)
}
