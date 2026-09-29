# runtime_community_guild_queries.go 逐行 Code Review

每段以 `L1`、`L2` 對照關鍵原始碼；可依編號逐行講解 guild query、detail projection 與 user search。

## 1. `rpcListGuildJoinRequestsHandler`

```go
// L1
userID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
var input guildJoinPayload
// L4
if err := parsePayload(payload, &input); err != nil { return "", err }
// L5
if err := ensureUserCanManageGuild(ctx, nk, input.GuildID, userID); err != nil { return "", err }
// L6
requests, err := listGuildJoinRequestsForGuild(ctx, nk, input.GuildID)
// L7
if err != nil { return "", err }
// L8
return mustJSON(map[string]interface{}{ "guildId": input.GuildID, "requests": requests }), nil
```

- `L1`：取得 caller ID。
- `L2`：未登入時停止。
- `L3`：建立 guild ID payload。
- `L4`：解析 JSON。
- `L5`：只有 owner/admin 可查看 pending join requests。
- `L6`：從 storage 讀取並以 guild 前綴篩選 requests。
- `L7`：讀取失敗時停止。
- `L8`：回傳指定 guild 與 request 清單。

## 2. `rpcGetGuildDetailHandler`

```go
// L1
if _, err := requireUserID(ctx); err != nil { return "", err }
// L2
var input guildJoinPayload
// L3
if err := parsePayload(payload, &input); err != nil { return "", err }
// L4
guild, err := getGuildOrThrow(ctx, nk, input.GuildID)
// L5
if err != nil { return "", err }
// L6
members, err := listGuildMembers(ctx, nk, input.GuildID)
// L7
if err != nil { return "", err }
// L8
if err := reconcileGuildMembershipProjections(ctx, nk, input.GuildID, members); err != nil { logger.Warn("Guild membership reconciliation failed guild=%s: %v", input.GuildID, err) }
```

- `L1`：detail 至少需要 authenticated user；此處只驗證身分，不使用 user ID。
- `L2`：建立 guild ID payload。
- `L3`：解析 JSON。
- `L4`：確認目標 group 存在且為 guild。
- `L5`：驗證失敗時停止。
- `L6`：讀取 authoritative roster。
- `L7`：roster 失敗時停止。
- `L8`：以 roster 修正 membership projections；修正失敗只記錄 warning，不讓 detail 讀取完全失敗。

```go
// L9
requests, err := listGuildJoinRequestsForGuild(ctx, nk, input.GuildID)
// L10
if err != nil { return "", err }
// L11
config, err := readGuildConfig(ctx, nk, input.GuildID)
// L12
if err != nil { return "", err }
// L13
auditLog, err := listGuildAuditLog(ctx, nk, input.GuildID, 30)
// L14
if err != nil { return "", err }
// L15
viewer := findGroupUserByID(members, contextString(ctx, runtime.RUNTIME_CTX_USER_ID))
// L16
memberViews, contributionViews, averageScore, submittedMembers := buildGuildMemberAndContributionViews(ctx, nk, members)
```

- `L9`：讀取 guild pending requests。
- `L10`：request 讀取失敗時停止。
- `L11`：讀取 guild config。
- `L12`：config 讀取失敗時停止。
- `L13`：讀取最近 30 筆 audit。
- `L14`：audit 讀取失敗時停止。
- `L15`：從 roster 找出目前 viewer，用於回傳 viewer role。
- `L16`：由 roster 與 server storage 產生 member/contribution views 與平均指標。

```go
// L17
return mustJSON(map[string]interface{}{
	"guild": map[string]interface{}{ "id": guild.GetId(), "name": guild.GetName(), "description": guild.GetDescription(), "kind": "guild", "memberCount": len(members), "viewerRole": mapGuildStateToRole(stateOf(viewer)), "announcement": config.Announcement, "joinPolicy": config.JoinPolicy },
	"members": memberViews, "requests": requests, "audit": auditLog, "contributions": contributionViews,
	"metrics": map[string]interface{}{ "averageScore": averageScore, "submittedMembers": submittedMembers },
}), nil
```

- `L17`：將所有 server 讀取與投影資料包成 detail response；viewer role 來自 roster state，平均分數與提交人數來自 score storage。

## 3. `rpcSearchUsersHandler`

```go
// L1
userID, err := requireUserID(ctx)
// L2
if err != nil { return "", err }
// L3
var input userSearchPayload
// L4
if err := parsePayload(payload, &input); err != nil { return "", err }
// L5
query := strings.ToLower(strings.TrimSpace(input.Query))
// L6
if query == "" { return mustJSON(map[string]interface{}{ "users": []map[string]interface{}{} }), nil }
// L7
limit := input.Limit
// L8
if limit <= 0 || limit > 10 { limit = 8 }
// L9
pattern := "%" + query + "%"
// L10
prefix := query + "%"
```

- `L1`：取得搜尋者 ID，之後 SQL 會排除自己。
- `L2`：未登入時停止。
- `L3`：建立 search payload。
- `L4`：解析 JSON。
- `L5`：清理並轉成小寫，讓搜尋不區分大小寫。
- `L6`：空 query 直接回傳空集合，不掃描 users table。
- `L7`：取 client 請求的筆數。
- `L8`：將不合理筆數限制為預設 8，最大不超過 10。
- `L9`：建立包含式 SQL LIKE pattern。
- `L10`：建立前綴比對 pattern，供排序提升精確結果。

```go
// L11
rows, err := db.QueryContext(ctx, `SELECT id::text, username, COALESCE(display_name, '') FROM users WHERE id <> $1 AND (LOWER(username) LIKE $2 OR LOWER(COALESCE(display_name, '')) LIKE $2) ORDER BY CASE WHEN LOWER(username) = $3 THEN 0 WHEN LOWER(username) LIKE $4 THEN 1 WHEN LOWER(COALESCE(display_name, '')) LIKE $4 THEN 2 ELSE 3 END, username ASC LIMIT $5`, userID, pattern, query, prefix, limit)
// L12
if err != nil { return "", err }
// L13
defer rows.Close()
// L14
users := make([]map[string]interface{}, 0)
// L15
for rows.Next() {
	var candidateID, username, displayName string
	if err := rows.Scan(&candidateID, &username, &displayName); err != nil { return "", err }
	users = append(users, map[string]interface{}{ "userId": candidateID, "username": username, "displayName": displayName })
}
// L16
if err := rows.Err(); err != nil { return "", err }
// L17
return mustJSON(map[string]interface{}{ "users": users }), nil
```

- `L11`：使用參數化 SQL 搜尋 username/display name；`id <> $1` 排除自己；排序優先完全 username、username prefix、display name prefix，最後才一般包含比對。
- `L12`：SQL 建立或執行失敗時回傳錯誤。
- `L13`：函式結束前一定關閉 rows。
- `L14`：建立搜尋結果 slice。
- `L15`：逐列 Scan 出 ID、username、display name，轉為 API view。
- `L16`：檢查迭代 rows 時才發生的延遲錯誤。
- `L17`：回傳結果集合。
