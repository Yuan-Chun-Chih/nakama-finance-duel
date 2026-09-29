# runtime_community_views.go 逐行 Code Review

每段以 `L1`、`L2` 對照關鍵原始碼；可依編號逐行講解 guild detail 的 member 與 contribution view 如何由後端投影。

## 1. `buildGuildMemberAndContributionViews`

```go
// L1
memberViews := make([]map[string]interface{}, 0, len(members))
// L2
contributionViews := make([]map[string]interface{}, 0, len(members))
// L3
reads := make([]*runtime.StorageRead, 0, len(members))
// L4
indexByUserID := make(map[string]*api.GroupUserList_GroupUser, len(members))
```

- `L1`：建立 member view 結果 slice。
- `L2`：建立 contribution view 結果 slice。
- `L3`：建立稍後批次讀取 portfolio score 的請求 slice。
- `L4`：以 user ID 索引 roster member，稍後可將 score 對回對應成員。

```go
// L5
for _, member := range members {
// L6
	user := member.GetUser()
// L7
	if user == nil || user.GetId() == "" { continue }
// L8
	memberViews = append(memberViews, map[string]interface{}{ "userId": user.GetId(), "username": user.GetUsername(), "displayName": user.GetDisplayName(), "role": mapGuildStateToRole(groupUserState(member)) })
// L9
	indexByUserID[user.GetId()] = member
// L10
	reads = append(reads, &runtime.StorageRead{Collection: collectionPortfolioScores, Key: portfolioScoreKey, UserID: user.GetId()})
}
```

- `L5`：逐一處理 roster 成員。
- `L6`：取得 Nakama user 資料。
- `L7`：沒有 user 或 ID 的無效 roster entry 直接略過。
- `L8`：建立前端 member row；role 由 server roster state 轉換，不採用 client 資料。
- `L9`：保存 user ID 到 roster member 的索引。
- `L10`：加入讀取該玩家 latest portfolio score 的 batch request。

```go
// L11
var total int64
// L12
submittedCount := 0
// L13
scoreByUserID := map[string]portfolioScoreStorage{}
// L14
if len(reads) > 0 {
	if objects, err := nk.StorageRead(ctx, reads); err == nil {
		for _, object := range objects {
			if object == nil || object.GetValue() == "" { continue }
			var score portfolioScoreStorage
			if err := json.Unmarshal([]byte(object.GetValue()), &score); err != nil { continue }
			scoreByUserID[object.GetUserId()] = score
			total += score.Score
			submittedCount++
		}
	}
}
```

- `L11`：累積所有有效 score 的總值。
- `L12`：記錄真正提交有效 score 的玩家數量。
- `L13`：建立 user ID 到 score record 的索引。
- `L14`：有讀取請求時批次讀 storage；讀取失敗時維持空 score view；空 object 或壞 JSON 都跳過；有效資料才建立索引、加總與計數。

```go
// L15
averageScore := int64(0)
// L16
if submittedCount > 0 { averageScore = int64(math.Round(float64(total) / float64(submittedCount))) }
// L17
for userID, member := range indexByUserID {
	user := member.GetUser()
	score, ok := scoreByUserID[userID]
	row := map[string]interface{}{ "userId": userID, "username": user.GetUsername(), "displayName": user.GetDisplayName(), "role": mapGuildStateToRole(groupUserState(member)), "hasScore": ok }
	if ok { row["latestScore"] = score.Score; row["updatedAt"] = score.UpdatedAt; row["deltaFromAverage"] = score.Score - averageScore }
	contributionViews = append(contributionViews, row)
}
```

- `L15`：沒有任何提交時平均分數預設為零。
- `L16`：有有效提交時，以總和除以提交數並四捨五入。
- `L17`：對每個有效 roster member 建立 contribution row；`ok` 表示他是否有 score；有 score 才加入 latest score、更新時間與相對平均差距。

```go
// L18
sort.Slice(contributionViews, func(i, j int) bool {
	leftHas, _ := contributionViews[i]["hasScore"].(bool)
	rightHas, _ := contributionViews[j]["hasScore"].(bool)
	if leftHas != rightHas { return leftHas }
	leftScore, _ := contributionViews[i]["latestScore"].(int64)
	rightScore, _ := contributionViews[j]["latestScore"].(int64)
	if leftScore != rightScore { return leftScore > rightScore }
	leftName, _ := contributionViews[i]["username"].(string)
	rightName, _ := contributionViews[j]["username"].(string)
	return leftName < rightName
})
// L19
return memberViews, contributionViews, averageScore, submittedCount
```

- `L18`：排序 contribution rows：先讓已提交 score 的人排前面，再依分數由高到低，分數相同時依 username 字母順序。
- `L19`：回傳成員 view、貢獻 view、平均分數與有效提交人數。

## 2. `toGuildAverageSummary`

```go
// L1
membership, err := readGuildMembership(ctx, nk, userID)
// L2
if err != nil || membership == nil { return nil, err }
// L3
guild, err := getGuildOrThrow(ctx, nk, membership.GuildID)
// L4
if err != nil { return nil, err }
// L5
return toRecordSummary(record, membership.GuildID, guild.GetName()), nil
```

- `L1`：讀取目前玩家的 membership，以找出 guild average record 對應的 guild。
- `L2`：讀取失敗或沒有 guild 時不建立 summary。
- `L3`：取得 guild 詳細資料，主要用來取得顯示名稱。
- `L4`：guild 已不存在或查詢失敗時回傳錯誤。
- `L5`：將 leaderboard record 轉成 summary，owner 改為 guild ID、名稱改為 guild 名稱。
