package main

import (
	"context"
	"encoding/json"
	"math"
	"time"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
)

// findGroupUserByID 從 Nakama group roster 找出指定 user。
func findGroupUserByID(users []*api.GroupUserList_GroupUser, userID string) *api.GroupUserList_GroupUser {
	for _, entry := range users {
		if entry.GetUser() != nil && entry.GetUser().GetId() == userID {
			return entry
		}
	}
	return nil
}

// 確保使用者是指定社群的成員，若不是則回傳 permission denied。
// active members, while standalone matchmaking does not require a community.
func ensureCommunityMembership(ctx context.Context, nk runtime.NakamaModule, communityID, kind, userID string) error {
	users, err := listGuildMembers(ctx, nk, communityID)
	if err != nil {
		return err
	}
	mine := findGroupUserByID(users, userID)
	if mine == nil {
		return permissionDenied("Community membership required.")
	}
	if kind == "guild" {
		group, err := getGuildOrThrow(ctx, nk, communityID)
		if err != nil {
			return err
		}
		if group.GetLangTag() != "guild" {
			return invalidArgument("Target community is not a guild.")
		}
	}
	return nil
}

// normalizeCommunityKind 將未知 community kind 收斂為預設 group。
func normalizeCommunityKind(kind string) string {
	if kind == "guild" {
		return "guild"
	}
	return "group"
}

// stateOf 讀取 roster state，空值時回傳 -1。
func stateOf(user *api.GroupUserList_GroupUser) int32 {
	if user == nil || user.GetState() == nil {
		return -1
	}
	return user.GetState().GetValue()
}

// groupUserState 提供語意化的 group member state 讀取入口。
func groupUserState(user *api.GroupUserList_GroupUser) int32 {
	return stateOf(user)
}

// guildStateCanManage 判斷 roster state 是否具有 owner 或 admin 管理權限。
func guildStateCanManage(state int32) bool {
	return state == 0 || state == 1
}

// guildStateIsOwner 判斷 roster state 是否為 owner。
func guildStateIsOwner(state int32) bool {
	return state == 0
}

// guildPromotionsToOwner 回傳目前角色升到 owner 所需的 promote 次數。
func guildPromotionsToOwner(state int32) (int, error) {
	switch state {
	case 0:
		return 0, nil
	case 1:
		return 1, nil
	case 2:
		return 2, nil
	default:
		return 0, failedPrecondition("Target user is not an active guild member.")
	}
}

// enforceScoreSubmissionPolicy 驗證分數格式並限制短時間重複提交。
func enforceScoreSubmissionPolicy(ctx context.Context, nk runtime.NakamaModule, userID string, score int64) error {
	if score != int64(math.Round(float64(score))) {
		return invalidArgument("Score must be an integer.")
	}

	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
		Collection: collectionPortfolioScores,
		Key:        portfolioScoreKey,
		UserID:     userID,
	}})
	if err != nil {
		return err
	}
	if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" {
		return nil
	}

	var previous portfolioScoreStorage
	if err := json.Unmarshal([]byte(objects[0].GetValue()), &previous); err != nil || previous.UpdatedAt == "" {
		return nil
	}
	previousTime, err := time.Parse(time.RFC3339, previous.UpdatedAt)
	if err != nil {
		return nil
	}
	if time.Since(previousTime) < time.Duration(scoreSubmissionCooldownMS)*time.Millisecond {
		return failedPrecondition("Score submissions are cooling down. Please wait a few seconds.")
	}
	return nil
}

// toRecordSummary 將 Nakama leaderboard record 轉成前端精簡 view model。
func toRecordSummary(record *api.LeaderboardRecord, ownerID, username string) *leaderboardRecordSummary {
	if record == nil {
		return nil
	}
	return &leaderboardRecordSummary{
		OwnerID:  ownerID,
		Username: username,
		Score:    record.GetScore(),
		Subscore: record.GetSubscore(),
		Rank:     record.GetRank(),
	}
}

// validateScore 確認分數位於系統允許的上下界內。
func validateScore(value int64) error {
	if value < -maxPortfolioScore || value > maxPortfolioScore {
		return outOfRange("score exceeds the allowed range.")
	}
	return nil
}
