# runtime_community_models.go 逐行 Code Review

此檔只定義 payload、storage record 與 view model，沒有 function。每個區塊以 `L1` 對照型別欄位，說明 JSON 欄位如何在前端、RPC 與 storage 間傳遞。

## 1. Guild RPC payload

```go
// L1
type createGuildPayload struct { GuildID string `json:"guildId"`; Name string `json:"name"`; Description string `json:"description"` }
// L2
type guildJoinPayload struct { GuildID string `json:"guildId"` }
// L3
type guildLeavePayload struct { GuildID string `json:"guildId"` }
// L4
type guildInvitePayload struct { GuildID string `json:"guildId"`; Username string `json:"username"` }
// L5
type guildMemberPayload struct { GuildID string `json:"guildId"`; UserID string `json:"userId"`; OperationID string `json:"operationId,omitempty"` }
// L6
type guildSettingsPayload struct { GuildID string `json:"guildId"`; Announcement string `json:"announcement"`; JoinPolicy string `json:"joinPolicy"` }
```

- `L1`：建立 guild 時接收既有 group ID、名稱與說明；JSON tag 決定前端欄位名稱。
- `L2`：join request、disband 與 detail 等只需要 guild ID 的 handler 共用此 payload。
- `L3`：leave 可帶 guild ID，但 handler 會優先採用後端 membership projection。
- `L4`：invite 需要 guild ID 與目標 username。
- `L5`：角色異動需要 guild ID、目標 user ID；`omitempty` 讓未提供的 operation ID 不輸出成空字串。
- `L6`：設定更新接收 guild ID、公告與加入政策。

## 2. Score 與搜尋 payload

```go
// L1
type submitPortfolioScorePayload struct { Score int64 `json:"score"`; Source string `json:"source"` }
// L2
type userSearchPayload struct { Query string `json:"query"`; Limit int `json:"limit"` }
```

- `L1`：score 是 `int64`，避免浮點誤差；source 只作 metadata，不能決定後端分數規則。
- `L2`：user search 接收搜尋文字與筆數上限，handler 仍會自行限制最大值。

## 3. Membership、request 與 config storage

```go
// L1
type guildMembershipStorage struct { GuildID string `json:"guildId"`; Role string `json:"role"` }
// L2
type guildJoinRequestRecord struct { GuildID string `json:"guildId"`; UserID string `json:"userId"`; Username string `json:"username"`; RequestedAt string `json:"requestedAt"`; Status string `json:"status"` }
// L3
type guildConfigStorage struct { GuildID string `json:"guildId"`; Announcement string `json:"announcement"`; JoinPolicy string `json:"joinPolicy"`; UpdatedAt string `json:"updatedAt"`; UpdatedBy string `json:"updatedBy"`; UpdatedByName string `json:"updatedByName"` }
```

- `L1`：user-scoped membership projection 保存玩家目前 guild 與從 roster 投影出的 role。
- `L2`：pending join request 保存 guild、申請者、名稱、server 時間與狀態。
- `L3`：guild config 保存公告、加入政策與後端產生的更新者稽核欄位。

## 4. Audit 與 operation storage

```go
// L1
type guildAuditRecord struct { ID string `json:"id"`; GuildID string `json:"guildId"`; Action string `json:"action"`; ActorID string `json:"actorId"`; ActorName string `json:"actorName"`; TargetUserID string `json:"targetUserId,omitempty"`; TargetName string `json:"targetName,omitempty"`; Summary string `json:"summary"`; CreatedAt string `json:"createdAt"` }
// L2
type guildOperationRecord struct { ID string `json:"id"`; GuildID string `json:"guildId"`; Action string `json:"action"`; ActorUserID string `json:"actorUserId"`; TargetUserID string `json:"targetUserId"`; Status string `json:"status"`; Step string `json:"step"`; LastError string `json:"lastError,omitempty"`; CreatedAt string `json:"createdAt"`; UpdatedAt string `json:"updatedAt"` }
```

- `L1`：audit record 是 append-only 操作軌跡；target 欄位只在有目標玩家時輸出。
- `L2`：operation record 保存 owner transfer 的冪等鍵、actor/target、完成步驟、錯誤與時間，讓 retry 能辨識既有操作。

## 5. Score storage 與 leaderboard view

```go
// L1
type portfolioScoreStorage struct { Score int64 `json:"score"`; UpdatedAt string `json:"updatedAt"` }
// L2
type leaderboardRecordSummary struct { OwnerID string `json:"ownerId"`; Username string `json:"username"`; Score int64 `json:"score,omitempty"`; Subscore int64 `json:"subscore,omitempty"`; Rank int64 `json:"rank,omitempty"` }
```

- `L1`：保存玩家最近一次 score 與 server 更新時間，cooldown 與 guild average 都讀此 record。
- `L2`：將 Nakama leaderboard record 投影為前端 summary；可選數字欄位為零時不輸出。
