# runtime_community_helpers.go 逐行 Code Review

每段以 `L1`、`L2` 對照關鍵原始碼；可依編號逐行講解。單純的 function 宣告與大括號不另行說明。

## 1. `findGroupUserByID`

```go
// L1
for _, entry := range users {
// L2
	if entry.GetUser() != nil && entry.GetUser().GetId() == userID { return entry }
}
// L3
return nil
```

- `L1`：逐一走訪 Nakama roster 成員。
- `L2`：先確認 roster entry 內有 user，再比較 user ID；相同時立即回傳該 entry。
- `L3`：全部比對後仍找不到，回傳 `nil`。

## 2. `ensureCommunityMembership`

```go
// L1
users, err := listGuildMembers(ctx, nk, communityID)
// L2
if err != nil { return err }
// L3
mine := findGroupUserByID(users, userID)
// L4
if mine == nil { return permissionDenied("Community membership required.") }
// L5
if kind == "guild" {
// L6
	group, err := getGuildOrThrow(ctx, nk, communityID)
// L7
	if err != nil { return err }
// L8
	if group.GetLangTag() != "guild" { return invalidArgument("Target community is not a guild.") }
}
// L9
return nil
```

- `L1`：讀取 community 對應 Nakama Group 的 authoritative roster。
- `L2`：roster 讀取失敗時停止。
- `L3`：在 roster 中尋找目前登入者。
- `L4`：找不到登入者代表不是成員，回傳權限錯誤。
- `L5`：只有呼叫端指定 community kind 為 `guild` 時才做 guild 類型驗證。
- `L6`：讀取並驗證目標 group。
- `L7`：group 查詢失敗時回傳錯誤。
- `L8`：不是 `guild` tag 的一般 group 不可使用 guild 流程。
- `L9`：成員與類型皆通過時回傳成功。

## 3. `normalizeCommunityKind`

```go
// L1
if kind == "guild" { return "guild" }
// L2
return "group"
```

- `L1`：只有完全等於 `guild` 的輸入保留為 guild。
- `L2`：所有其他輸入統一降為 `group`，避免未定義 community kind 流入後續邏輯。

## 4. `stateOf`

```go
// L1
if user == nil || user.GetState() == nil { return -1 }
// L2
return user.GetState().GetValue()
```

- `L1`：空 roster entry 或缺少 state 時以 `-1` 表示未知、不可授權狀態。
- `L2`：存在 state 時取出 Nakama roster 的整數 state。

## 5. `groupUserState`

```go
// L1
return stateOf(user)
```

- `L1`：統一由 `stateOf` 取得 state，讓呼叫端不必自行處理 nil。

## 6. `guildStateCanManage`

```go
// L1
return state == 0 || state == 1
```

- `L1`：Nakama state `0` 是 owner、`1` 是 admin；只有兩者可管理 guild。

## 7. `guildStateIsOwner`

```go
// L1
return state == 0
```

- `L1`：只有 Nakama state `0` 被視為 owner。

## 8. `guildPromotionsToOwner`

```go
// L1
switch state {
// L2
case 0: return 0, nil
// L3
case 1: return 1, nil
// L4
case 2: return 2, nil
// L5
default: return 0, failedPrecondition("Target user is not an active guild member.")
}
```

- `L1`：依 target 的目前 roster state 決定 owner transfer 時需要的 Nakama promotion 次數。
- `L2`：target 已是 owner，不需要 promotion。
- `L3`：admin 升為 owner 需要一次 promotion。
- `L4`：一般 member 升為 owner 需要兩次 promotion。
- `L5`：pending 或未知 state 不是有效成員，拒絕轉讓 owner。

## 9. `enforceScoreSubmissionPolicy`

```go
// L1
if score != int64(math.Round(float64(score))) { return invalidArgument("Score must be an integer.") }
// L2
objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionPortfolioScores, Key: portfolioScoreKey, UserID: userID}})
// L3
if err != nil { return err }
// L4
if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" { return nil }
// L5
var previous portfolioScoreStorage
// L6
if err := json.Unmarshal([]byte(objects[0].GetValue()), &previous); err != nil || previous.UpdatedAt == "" { return nil }
// L7
previousTime, err := time.Parse(time.RFC3339, previous.UpdatedAt)
// L8
if err != nil { return nil }
// L9
if time.Since(previousTime) < time.Duration(scoreSubmissionCooldownMS)*time.Millisecond {
	return failedPrecondition("Score submissions are cooling down. Please wait a few seconds.")
}
// L10
return nil
```

- `L1`：將 score 轉成浮點數後四捨五入再轉回整數；若值不相同則拒絕非整數輸入。
- `L2`：讀取玩家最近一次 portfolio score storage record。
- `L3`：storage 讀取失敗時中止。
- `L4`：玩家沒有舊 score 時，不需要 cooldown，允許首次提交。
- `L5`：建立變數承接舊 score record。
- `L6`：舊資料損壞或沒有更新時間時不套用 cooldown，避免壞資料永久阻擋玩家。
- `L7`：將 RFC3339 更新時間轉回 `time.Time`。
- `L8`：舊時間無法解析時不套用 cooldown。
- `L9`：目前時間與前次提交時間的間隔小於設定毫秒數時，拒絕過快重複提交。
- `L10`：通過格式與 cooldown 檢查後允許提交。

## 10. `toRecordSummary`

```go
// L1
if record == nil { return nil }
// L2
return &leaderboardRecordSummary{
	OwnerID: ownerID, Username: username, Score: record.GetScore(),
	Subscore: record.GetSubscore(), Rank: record.GetRank(),
}
```

- `L1`：沒有 leaderboard record 時不建立前端 summary。
- `L2`：將 Nakama record 投影為 API 回傳格式，保留 owner、名稱、分數、subscore 與排名。

## 11. `validateScore`

```go
// L1
if value < -maxPortfolioScore || value > maxPortfolioScore { return outOfRange("score exceeds the allowed range.") }
// L2
return nil
```

- `L1`：限制 score 必須介於負的最大值與正的最大值之間，避免極端數字污染排行榜。
- `L2`：在範圍內時通過驗證。
