# runtime_finance_orders.go 逐行 Code Review

每段以 `L1`、`L2` 對照交易引擎的關鍵原始碼；所有現金、BTC micros 與訂單狀態都由 server state 計算。

## 1. `financeHandleMessage`

```go
// L1
userID := message.GetUserId()
// L2
if !financeHasPlayer(state, userID) { return }
// L3
switch message.GetOpCode() { case financeReadyOpCode: /* ready/cancel ready */; case financeOrderOpCode: /* parse intent then financeAcceptOrder */; case financeCancelOpCode: /* cancel own open order */; case financeStateOpCode: financeBroadcastState(dispatcher, state, []runtime.Presence{message.GetPresence()}); case financeResignOpCode: /* financeFinish */ }
```

- `L1`：從 Nakama match data 取得送訊息者 ID。
- `L2`：非本局 player 的訊息直接忽略。
- `L3`：依 opcode 分派；ready、order、cancel、state request、resign 都只接受意圖，真正狀態改動在後端 helper 完成。

## 2. `financeAcceptOrder`

```go
// L1
if state.Status != "running" { financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "match_not_running"); return }
// L2
if state.MarketStale { financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "market_stale"); return }
// L3
if intent.QuantityMicros <= 0 || (intent.Side != "buy" && intent.Side != "sell") || (intent.OrderType != "market" && intent.OrderType != "limit") { financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "invalid_order"); return }
// L4
if intent.OrderType == "limit" && intent.LimitPriceCents <= 0 { financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "invalid_limit_price"); return }
```

- `L1`：未進入 running 對局時拒絕下單。
- `L2`：行情過期時拒絕所有新訂單。
- `L3`：數量、方向與類型均由 server 驗證。
- `L4`：limit order 必須帶正的限價。

```go
// L5
portfolio := state.Portfolios[userID]
// L6
if intent.Side == "buy" && financeAffordableBuyQuantity(portfolio.CashCents-financeReservedBuyNotional(state, userID), state.PriceCents, intent.QuantityMicros) < intent.QuantityMicros { financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "insufficient_cash"); return }
// L7
if intent.Side == "sell" && financeAvailableSellQuantity(state, userID) < intent.QuantityMicros { financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "insufficient_position"); return }
// L8
order := &financeOrder{ /* server ID, user ID, round, intent, open quantity and timestamps */ }
// L9
state.Orders[order.ID] = order
// L10
financePersistOrder(ctx, logger, nk, state.ArenaID, order)
// L11
financeTryFillOrder(ctx, logger, nk, dispatcher, state, order)
```

- `L5`：取得 server portfolio。
- `L6`：買入時扣除既有 limit buy 保留資金後，仍必須買得起完整 requested micros。
- `L7`：賣出時扣除既有 sell order 保留持倉後，必須仍有足夠 BTC。
- `L8`：建立 server order；client 不可指定 order ID、round、狀態或時間。
- `L9`：放入 authoritative in-memory order book。
- `L10`：持久化 order 初始狀態。
- `L11`：market order 或價格已符合的 limit order 立即嘗試成交。

## 3. `financeTryFillOrder`

```go
// L1
if order.Status != "open" && order.Status != "partial" { return }
// L2
if order.OrderType == "limit" && ((order.Side == "buy" && state.PriceCents > order.LimitPriceCents) || (order.Side == "sell" && state.PriceCents < order.LimitPriceCents)) { return }
// L3
executionPrice := state.PriceCents
// L4
if order.Side == "buy" { executionPrice += calculateBpsCeil(executionPrice, financeSlippageBps) } else { executionPrice -= calculateBpsCeil(executionPrice, financeSlippageBps) }
// L5
notional := financeNotional(order.RemainingQuantityMicros, executionPrice)
// L6
fee := calculateBpsCeil(notional, financeFeeBps)
// L7
tax := int64(0); if order.Side == "sell" { tax = calculateBpsCeil(notional, financeSellTaxBps) }
```

- `L1`：只有 open/partial order 可以成交。
- `L2`：limit 條件尚未觸發時保留掛單。
- `L3`：以 server 最新價格作成交基準。
- `L4`：買單加滑價、賣單減滑價，並以 bps 向上取整。
- `L5`：以 BTC micros 與成交價換算 cents 名目金額。
- `L6`：以 notional 計算手續費。
- `L7`：只有賣出再加交易稅。

```go
// L8
if order.Side == "buy" { /* deduct cash, update weighted average cost and BTC */ } else { /* deduct BTC, add cash net of fee/tax, realize PnL */ }
// L9
order.RemainingQuantityMicros = 0; order.Status = "filled"
// L10
fill := financeFillRecord{ /* order ID, execution price, quantity, notional, fee, tax, slippage */ }
// L11
financePersistFill(ctx, logger, nk, fill)
// L12
financePersistOrder(ctx, logger, nk, state.ArenaID, order)
// L13
financeMarkPortfolios(state)
// L14
financeAppendEvent(ctx, logger, nk, dispatcher, state, "order_filled", order.UserID, order.ID)
```

- `L8`：買入更新 cash、BTC 與平均成本；賣出更新 BTC、扣 fee/tax 後 cash 與 realized PnL。
- `L9`：本版每次 fill 使用剩餘量，成交後將 order 標記 filled。
- `L10`：建立不可變成交明細。
- `L11`：append-only 保存 fill。
- `L12`：保存 order 最新狀態。
- `L13`：重新計算所有 portfolio NAV 與未實現損益。
- `L14`：寫入並即時廣播成交事件。

## 4. `financeProcessOpenOrders`

```go
// L1
for _, order := range state.Orders { financeTryFillOrder(ctx, logger, nk, dispatcher, state, order) }
```

- `L1`：每次價格刷新後逐筆重新檢查 open/partial order 是否已符合成交條件。

## 5. `financeRefreshPrice`

```go
// L1
record, stale, err := readFinanceBTCPrice(ctx, nk)
// L2
if err != nil { logger.Warn("Finance price refresh failed: %v", err); state.MarketStale = true; return }
// L3
state.PriceCents = record.Price * financeUSDScale
// L4
state.PriceUpdatedAt = record.UpdatedAt
// L5
state.MarketStale = stale
// L6
financeMarkPortfolios(state)
```

- `L1`：從後端 market storage 讀 BTC price 及 stale 判定。
- `L2`：讀取失敗時停盤，不使用舊價交易。
- `L3`：將 price feed 的美元整數轉為 cents。
- `L4`：保存行情最後更新時間。
- `L5`：保存 freshness 結果供 order validator 與 UI 使用。
- `L6`：即使市場 stale，仍以最後 server price 重算展示用 NAV。

## 6. `financeMarkPortfolios`

```go
// L1
for _, portfolio := range state.Portfolios {
	positionValue := financeNotional(portfolio.BTCMicros, state.PriceCents)
	portfolio.UnrealizedPnLCents = positionValue - portfolio.CostBasisCents
	portfolio.NAVCents = portfolio.CashCents + positionValue
	portfolio.ReturnBps = ((portfolio.NAVCents-financeInitialCashCents)*10000)/financeInitialCashCents
}
```

- `L1`：逐位以 server price 計算持倉市值、未實現損益、NAV 與相對初始現金的 bps 報酬率。

## 7. `financeRejectIntent`

```go
// L1
financeUpdateMetrics(ctx, logger, nk, func(metrics *financeSystemMetrics) { metrics.OrderRejectReasons[reason]++ })
// L2
financeAppendEvent(ctx, logger, nk, dispatcher, state, "order_rejected", userID, reason)
// L3
financeBroadcastState(dispatcher, state, nil)
```

- `L1`：累積拒絕原因的營運指標。
- `L2`：保存並廣播拒絕事件。
- `L3`：推送最新 snapshot 讓 UI 同步拒絕後狀態。

## 8. `financeHasPlayer`

```go
// L1
for _, playerID := range state.Players { if playerID == userID { return true } }
// L2
return false
```

- `L1`：逐一比對 authoritative player list。
- `L2`：無相同 ID 時不是本局玩家。

## 9. `financeAllReady`

```go
// L1
return len(state.Players) == 2 && state.Ready[state.Players[0]] && state.Ready[state.Players[1]]
```

- `L1`：只有兩位玩家都存在且 ready map 都是 true 才通過。

## 10. `financeUserOnline`

```go
// L1
for _, presence := range state.Presences { if presence.GetUserId() == userID { return true } }
// L2
return false
```

- `L1`：任何活躍 session 屬於該 user 即視為 online。
- `L2`：沒有 session 時離線。

## 11. `financeAvailableSellQuantity`

```go
// L1
portfolio := state.Portfolios[userID]
// L2
reserved := int64(0)
// L3
for _, order := range state.Orders { if order.UserID == userID && order.Side == "sell" && (order.Status == "open" || order.Status == "partial") { reserved += order.RemainingQuantityMicros } }
// L4
return maxInt64(0, portfolio.BTCMicros-reserved)
```

- `L1`：讀玩家 portfolio。
- `L2`：準備累積已被 sell order 保留的 BTC。
- `L3`：只計入仍有效的 sell order 剩餘量。
- `L4`：回傳未被保留、可再次賣出的 BTC，最小不低於零。

## 12. `financeReservedBuyNotional`

```go
// L1
for _, order := range state.Orders { if order.UserID == userID && order.Side == "buy" && (order.Status == "open" || order.Status == "partial") { total += financeNotional(order.RemainingQuantityMicros, order.LimitPriceCents) } }
// L2
return total
```

- `L1`：累積玩家有效 limit buy order 的最大名目金額，防止同一現金被重複承諾。
- `L2`：回傳應從可用 cash 扣除的保留金額。

## 13. `financeNotional`、`financeAffordableBuyQuantity`

```go
// L1
return (quantityMicros * price) / financeBTCScale
// L2
affordable := (cash * financeBTCScale) / price
// L3
return minInt64(requestedMicros, affordable)
```

- `L1`：將 BTC micros 乘 cents 價格後除以 BTC scale，得到 cents notional。
- `L2`：由現金反推最多可買的 BTC micros。
- `L3`：不會回傳超過使用者要求的數量。

## 14. `financeOtherPlayers`、`financeNAVWinners`

```go
// L1
for _, playerID := range state.Players { if playerID != excluded { players = append(players, playerID) } }
// L2
for _, playerID := range state.Players { if state.Portfolios[playerID].ReturnBps == bestReturn { winners = append(winners, playerID) } }
```

- `L1`：回傳除指定 user 外的所有玩家，用於 disconnect/resign 判負。
- `L2`：回傳 NAV 報酬率最高的所有玩家；相同最高值時為平手多 winner。
