# runtime_config.go 逐行 Code Review

此檔是 compile-time 常數集合，沒有 function；以下依常數群組講解。

## 1. Leaderboard、RPC 與 game contract
```go
// L1
leaderboardGlobal = "portfolio_return_global"
// L2
rpcFinanceMatchmaking = "finance_matchmaking"
// L3
financeReadyOpCode = 220; financeOrderOpCode = 221; financeStateOpCode = 224; financeEventOpCode = 225
```
- `L1`：固定 Nakama leaderboard ID，前後端不可任意改名。
- `L2`：固定 HTTP RPC route ID。
- `L3`：固定 WebSocket match data opcode contract；前端與 runtime 必須一致。

## 2. Storage collection 與 key
```go
// L1
collectionFinanceOrders = "finance_orders"
// L2
collectionFinanceIdempotency = "finance_order_idempotency"
// L3
collectionFinanceArenaIndex = "finance_arena_index"
// L4
portfolioScoreKey = "latest"
```
- `L1`：保存 order 最新狀態。
- `L2`：保存 client order 冪等結果。
- `L3`：保存 arena 對 orders/fills/snapshots 的索引。
- `L4`：玩家 portfolio score 的固定 user-scoped key。

## 3. Finance 規則與維護參數
```go
// L1
financeInitialCashCents = int64(100000000)
// L2
financeBTCScale = int64(1000000)
// L3
financeRoundTicks = int64(10); financeMatchTicks = int64(300)
// L4
financeCountdownTicks = int64(3); financeConfirmationTicks = int64(30)
// L5
financePriceMaxAgeSeconds = int64(30)
// L6
financeIdempotencyRetention = 24 * time.Hour
```
- `L1`：初始資金以 cents 保存，等於一百萬美元。
- `L2`：一 BTC 分為一百萬 micros。
- `L3`：一回合十 tick、全局三百 tick。
- `L4`：開始前倒數三秒、配對確認三十秒。
- `L5`：價格超過三十秒未更新即 stale。
- `L6`：冪等 key 保存二十四小時後可清理。
