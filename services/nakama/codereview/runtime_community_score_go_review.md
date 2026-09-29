# runtime_community_score.go 逐行 Code Review

每段以 `L1`、`L2` 對照關鍵原始碼；可依編號逐行講解排行榜、score storage 與 guild average 的資料流。

## 1. `rpcGetPhaseConfigHandler`

```go
// L1
logger.Info("Go rpcGetPhaseConfig invoked")
// L2
return mustJSON(map[string]interface{}{
	"leaderboardIds": map[string]string{ "global": leaderboardGlobal, "weekly": leaderboardWeekly, "guildAverage": leaderboardGuildAverage },
	"rpcIds": map[string]string{ /* 所有前端可呼叫的 community RPC ID */ },
	"guildPolicy": map[string]interface{}{ "singleGuildPerUser": true, "defaultRoles": []string{"owner", "admin", "member"}, "ownerOnlyActions": []string{"promote_admin", "demote_admin", "transfer_owner"}, "leaderboardMetric": "average_return" },
	"validationPolicy": map[string]interface{}{ /* score 與 guild 限制 */ },
}), nil
```

- `L1`：寫入 Nakama logger，讓營運端可確認 phase config RPC 被呼叫。
- `L2`：回傳前端需要的常數與規則；`leaderboardIds` 提供排行榜 ID，`rpcIds` 提供後端路由名稱，`guildPolicy` 描述 guild 規則，`validationPolicy` 提供 score 範圍、cooldown 與人數限制。這些是展示與設定資訊，不是前端可覆寫的 authoritative 規則。

## 2. `rpcSubmitPortfolioScoreHandler`

```go
// L1
userID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
username := contextString(ctx, runtime.RUNTIME_CTX_USERNAME)
// L4
var input submitPortfolioScorePayload
// L5
if err := parsePayload(payload, &input); err != nil { return "", err }
// L6
if err := validateScore(input.Score); err != nil { return "", err }
// L7
if err := enforceScoreSubmissionPolicy(ctx, nk, userID, input.Score); err != nil { return "", err }
```

- `L1`：從 Nakama authenticated context 取得 user ID，不信任 payload 內的身分。
- `L2`：未登入或 context 缺 user ID 時拒絕。
- `L3`：讀取 Nakama context 中的 username，供 leaderboard 顯示。
- `L4`：建立 payload 結構承接 client JSON。
- `L5`：解析 payload 失敗時回傳輸入錯誤。
- `L6`：驗證 score 數值範圍。
- `L7`：驗證提交頻率與前次提交時間。

```go
// L8
submittedAt := time.Now().UTC().Format(time.RFC3339)
// L9
scoreValue := mustJSON(portfolioScoreStorage{Score: input.Score, UpdatedAt: submittedAt})
// L10
if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionPortfolioScores, Key: portfolioScoreKey, UserID: userID, Value: scoreValue, PermissionRead: 0, PermissionWrite: 0}}); err != nil { return "", err }
// L11
metadata := map[string]interface{}{ "source": defaultString(input.Source, "rpc"), "submittedAt": submittedAt, "version": 2 }
```

- `L8`：由 server 建立提交 UTC 時間。
- `L9`：將 score 與提交時間轉成 storage JSON。
- `L10`：保存 user-scoped latest score；權限為 `0`，禁止 client 直接改寫 cooldown 依據。
- `L11`：建立 leaderboard metadata，保留來源、提交時間與資料版本。

```go
// L12
globalRecord, err := nk.LeaderboardRecordWrite(ctx, leaderboardGlobal, userID, username, input.Score, 0, metadata, nil)
// L13
if err != nil { return "", err }
// L14
weeklyRecord, err := nk.LeaderboardRecordWrite(ctx, leaderboardWeekly, userID, username, input.Score, 0, metadata, nil)
// L15
if err != nil { return "", err }
// L16
guildAverageRecord, err := updateGuildAverageLeaderboard(ctx, nk, userID)
// L17
if err != nil { return "", err }
```

- `L12`：寫入全域 leaderboard；owner ID 使用 authenticated user ID。
- `L13`：全域 leaderboard 寫入失敗時停止。
- `L14`：寫入週榜，使用相同 authoritative score。
- `L15`：週榜寫入失敗時停止。
- `L16`：若玩家有 guild，重新計算該 guild 平均分數；玩家不能自行提交 guild average。
- `L17`：guild average 重算失敗時回傳錯誤。

```go
// L18
var guildSummary *leaderboardRecordSummary
// L19
if guildAverageRecord != nil {
	summary, err := toGuildAverageSummary(ctx, nk, userID, guildAverageRecord)
	if err != nil { return "", err }
	guildSummary = summary
}
// L20
return mustJSON(map[string]interface{}{
	"accepted": true,
	"leaderboardIds": map[string]string{ "global": leaderboardGlobal, "weekly": leaderboardWeekly, "guildAverage": leaderboardGuildAverage },
	"records": map[string]interface{}{ "global": toRecordSummary(globalRecord, userID, username), "weekly": toRecordSummary(weeklyRecord, userID, username), "guildAverage": guildSummary },
}), nil
```

- `L18`：預設 guild summary 為空，因為玩家可能尚未加入 guild。
- `L19`：有 guild average record 時轉成前端 summary；轉換失敗則中止。
- `L20`：回傳接受狀態、排行榜 ID 與三種 summary；資料均來自 server 寫入結果。

## 3. `updateGuildAverageLeaderboard`

```go
// L1
membership, err := readGuildMembership(ctx, nk, userID)
// L2
if err != nil || membership == nil { return nil, err }
// L3
return updateGuildAverageLeaderboardForGuild(ctx, nk, membership.GuildID)
```

- `L1`：讀取提交玩家的 membership projection。
- `L2`：讀取失敗時回傳錯誤；沒有 guild 時回傳 `nil, nil`，不建立 guild leaderboard record。
- `L3`：有 guild 時交給下一層，以 guild ID 重算平均值。

## 4. `updateGuildAverageLeaderboardForGuild`

```go
// L1
guild, err := getGuildOrThrow(ctx, nk, guildID)
// L2
if err != nil { return nil, err }
// L3
members, err := listGuildMembers(ctx, nk, guildID)
// L4
if err != nil { return nil, err }
// L5
memberIDs := make([]string, 0, len(members))
// L6
for _, member := range members { if user := member.GetUser(); user != nil && user.GetId() != "" { memberIDs = append(memberIDs, user.GetId()) } }
// L7
if len(memberIDs) == 0 { return nil, nil }
```

- `L1`：確認 guild 仍存在且具 `guild` 類型。
- `L2`：無效 guild 時停止。
- `L3`：讀取 authoritative roster。
- `L4`：roster 讀取失敗時停止。
- `L5`：建立收集有效 member user ID 的 slice。
- `L6`：只加入存在 user 且 user ID 非空的 roster member。
- `L7`：沒有有效成員時不寫入 guild average。

```go
// L8
reads := make([]*runtime.StorageRead, 0, len(memberIDs))
// L9
for _, memberID := range memberIDs { reads = append(reads, &runtime.StorageRead{Collection: collectionPortfolioScores, Key: portfolioScoreKey, UserID: memberID}) }
// L10
objects, err := nk.StorageRead(ctx, reads)
// L11
if err != nil { return nil, err }
// L12
var total int64
// L13
counted := 0
// L14
for _, object := range objects {
	if object == nil || object.GetValue() == "" { continue }
	var score portfolioScoreStorage
	if err := json.Unmarshal([]byte(object.GetValue()), &score); err != nil { continue }
	total += score.Score
	counted++
}
```

- `L8`：建立批次讀取請求。
- `L9`：每位成員讀取自己的 latest portfolio score object。
- `L10`：一次從 Nakama storage 取得全部成員 score。
- `L11`：批次讀取失敗時停止。
- `L12`：累積可用 score 的總和。
- `L13`：記錄真正有有效 score 的成員數，不能用 roster 人數當分母。
- `L14`：跳過空 object 和 JSON 損壞資料；有效 score 才加總並增加計數。

```go
// L15
if counted == 0 { return nil, nil }
// L16
average := int64(math.Round(float64(total) / float64(counted)))
// L17
return nk.LeaderboardRecordWrite(ctx, leaderboardGuildAverage, guildID, guild.GetName(), average, int64(counted), map[string]interface{}{ "guildId": guildID, "metric": "average_return", "memberCount": counted }, nil)
```

- `L15`：沒有任何有效 score 時不建立或更新 guild average record。
- `L16`：以有效 score 總和除以有效成員數，再四捨五入為整數。
- `L17`：以 guild ID 作為 leaderboard owner，guild 名稱作 username，平均值作 score，計數作 subscore，並保存可讀 metadata。
