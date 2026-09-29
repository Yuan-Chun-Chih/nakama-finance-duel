# runtime.go 逐行 Code Review

## 1. `InitModule`
```go
// L1
if err := registerLeaderboards(ctx, nk); err != nil { logger.Error("registerLeaderboards failed: %v", err); return err }
// L2
if err := seedDefaultMatchPriceFeed(ctx, nk); err != nil { logger.Error("seedDefaultMatchPriceFeed failed: %v", err); return err }
// L3
if err := initializer.RegisterMatch(financeAuthoritativeModule, func(...) (runtime.Match, error) { return &financeAuthoritativeMatch{}, nil }); err != nil { return err }
// L4
if err := initializer.RegisterMatchmakerMatched(financeMatchmakerMatched); err != nil { return err }
// L5
rpcs := map[string]func(...){ /* RPC ID to handler mapping */ }
// L6
for id, fn := range rpcs { if err := initializer.RegisterRpc(id, fn); err != nil { return err } }
// L7
return nil
```
- `L1`：啟動時建立排行榜，失敗即停止 runtime 載入。
- `L2`：初始化 market feed；正式環境未允許 bootstrap 時不會產生可交易假行情。
- `L3`：註冊 finance authoritative match factory。
- `L4`：註冊 Nakama matchmaker 配對完成 callback。
- `L5`：集中定義 RPC route 到 handler 的對照。
- `L6`：逐一註冊 RPC；任一失敗即 fail fast。
- `L7`：全部初始化成功才回傳 nil。

## 2. `stringParam`
```go
// L1
if value, ok := params[key].(string); ok { return value }
// L2
return ""
```
- `L1`：從 match params 取指定 key 的字串值。
- `L2`：不存在或型別不符時回傳空字串。

## 3. `stringSetParam`
```go
// L1
result := map[string]bool{}
// L2
switch values := params[key].(type) { case []string: /* trim then result[value]=true */; case []interface{}: /* accept only string */ }
// L3
return result
```
- `L1`：建立 set，避免 expected players 重複。
- `L2`：同時接受 Go `[]string` 與 JSON 解碼常見的 `[]interface{}`，只加入非空白字串。
- `L3`：回傳 player ID set。

## 4. `registerLeaderboards`
```go
// L1
nk.LeaderboardCreate(ctx, leaderboardGlobal, true, "desc", "best", "", metadata, true)
// L2
nk.LeaderboardCreate(ctx, leaderboardWeekly, true, "desc", "best", "0 0 * * 1", metadata, true)
// L3
nk.LeaderboardCreate(ctx, leaderboardGuildAverage, true, "desc", "set", "0 0 * * 1", metadata, true)
```
- `L1`：建立全域、由高到低、保留最佳成績的 authoritative 排行榜。
- `L2`：建立每週重設的個人排行榜。
- `L3`：建立每週重設、以 set 更新 guild average 的排行榜。
