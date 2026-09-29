package main

import (
	"context"
	"encoding/json"
	"math"
	"sort"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
)

// 本檔案將 guild roster 與 portfolio scores 組成前端 detail read model。
// buildGuildMemberAndContributionViews 組合成員、分數與平均值 view model。
func buildGuildMemberAndContributionViews(ctx context.Context, nk runtime.NakamaModule, members []*api.GroupUserList_GroupUser) ([]map[string]interface{}, []map[string]interface{}, int64, int) {
	// guild detail 需要的是前端可直接渲染的讀模型，而不是把多份 storage/raw record
	// 丟給 client 再自行拼裝，所以在 runtime 這裡一次整理好 member 與 contribution。
	memberViews := make([]map[string]interface{}, 0, len(members))
	contributionViews := make([]map[string]interface{}, 0, len(members))
	reads := make([]*runtime.StorageRead, 0, len(members))
	indexByUserID := make(map[string]*api.GroupUserList_GroupUser, len(members))

	for _, member := range members {
		user := member.GetUser()
		if user == nil || user.GetId() == "" {
			continue
		}
		memberViews = append(memberViews, map[string]interface{}{
			"userId":      user.GetId(),
			"username":    user.GetUsername(),
			"displayName": user.GetDisplayName(),
			"role":        mapGuildStateToRole(groupUserState(member)),
		})
		indexByUserID[user.GetId()] = member
		reads = append(reads, &runtime.StorageRead{
			Collection: collectionPortfolioScores,
			Key:        portfolioScoreKey,
			UserID:     user.GetId(),
		})
	}

	var total int64
	submittedCount := 0
	scoreByUserID := map[string]portfolioScoreStorage{}
	if len(reads) > 0 {
		// 批次讀取所有成員 latest score，避免每個 member 各打一個 storageRead。
		if objects, err := nk.StorageRead(ctx, reads); err == nil {
			for _, object := range objects {
				if object == nil || object.GetValue() == "" {
					continue
				}
				var score portfolioScoreStorage
				if err := json.Unmarshal([]byte(object.GetValue()), &score); err != nil {
					continue
				}
				scoreByUserID[object.GetUserId()] = score
				total += score.Score
				submittedCount++
			}
		}
	}

	averageScore := int64(0)
	if submittedCount > 0 {
		averageScore = int64(math.Round(float64(total) / float64(submittedCount)))
	}

	for userID, member := range indexByUserID {
		// contribution row 即使沒有 score 也會產生，讓 UI 能顯示誰尚未提交。
		user := member.GetUser()
		score, ok := scoreByUserID[userID]
		row := map[string]interface{}{
			"userId":      userID,
			"username":    user.GetUsername(),
			"displayName": user.GetDisplayName(),
			"role":        mapGuildStateToRole(groupUserState(member)),
			"hasScore":    ok,
		}
		if ok {
			row["latestScore"] = score.Score
			row["updatedAt"] = score.UpdatedAt
			row["deltaFromAverage"] = score.Score - averageScore
		}
		contributionViews = append(contributionViews, row)
	}

	sort.Slice(contributionViews, func(i, j int) bool {
		// 排序規則：有提交分數者優先，分數高者優先，最後以 username 穩定排序。
		leftHas, _ := contributionViews[i]["hasScore"].(bool)
		rightHas, _ := contributionViews[j]["hasScore"].(bool)
		if leftHas != rightHas {
			return leftHas
		}
		leftScore, _ := contributionViews[i]["latestScore"].(int64)
		rightScore, _ := contributionViews[j]["latestScore"].(int64)
		if leftScore != rightScore {
			return leftScore > rightScore
		}
		leftName, _ := contributionViews[i]["username"].(string)
		rightName, _ := contributionViews[j]["username"].(string)
		return leftName < rightName
	})

	return memberViews, contributionViews, averageScore, submittedCount
}

// toGuildAverageSummary 將 guild average leaderboard record 轉成摘要。
func toGuildAverageSummary(ctx context.Context, nk runtime.NakamaModule, userID string, record *api.LeaderboardRecord) (*leaderboardRecordSummary, error) {
	// guild average record 的 ownerID 是 guildID。
	// 這裡用 user membership 找到 guild name，讓前端可顯示公會名稱。
	membership, err := readGuildMembership(ctx, nk, userID)
	if err != nil || membership == nil {
		return nil, err
	}
	guild, err := getGuildOrThrow(ctx, nk, membership.GuildID)
	if err != nil {
		return nil, err
	}
	return toRecordSummary(record, membership.GuildID, guild.GetName()), nil
}
