# runtime_finance_match.go 逐行 Code Review

每段以 `L1`、`L2` 對照 authoritative match lifecycle 的關鍵原始碼。

## 1. `MatchInit`
```go
// L1
priceRecord, marketStale, err := readFinanceBTCPrice(ctx, nk)
// L2
if err != nil { logger.Warn("Finance match could not read BTC price feed: %v", err) }
// L3
price := priceRecord.Price; if price <= 0 { price = defaultMatchPrices()["BTC/USDT"]; marketStale = true }
// L4
expectedPlayers := stringSetParam(params, "expectedPlayers")
// L5
status := "waiting"; confirmationDeadline := int64(0); if len(expectedPlayers) == 2 { status = "matched_confirming"; confirmationDeadline = financeConfirmationTicks }
// L6
state := &financeAuthoritativeMatchState{ /* server arena, players, portfolios, orders, price, stale status, deadlines */ }
// L7
financeCleanupExpiredIdempotency(ctx, logger, nk)
// L8
return state, authoritativeMatchTickRate, mustJSON(map[string]interface{}{ "type": gameTypeFinance, "arenaId": state.ArenaID, "communityId": state.CommunityID, "kind": state.Kind, "name": state.Name })
```
- `L1`：讀 server BTC price 與 freshness。
- `L2`：行情讀取錯誤只記錄 warning，state 仍會建立為 stale。
- `L3`：缺價格時用 fallback 顯示價，但強制 `MarketStale`，不能交易。
- `L4`：讀 queue 配對指定的兩位 expected players。
- `L5`：有兩位指定玩家時先進 30 秒確認狀態；否則是 waiting lobby。
- `L6`：建立唯一 authoritative state，前端無法直接修改。
- `L7`：新 match 建立時順便做有界 idempotency cleanup。
- `L8`：回傳 tick rate 與可被 Nakama console 使用的 match metadata。

## 2. `MatchJoinAttempt`
```go
// L1
matchState, ok := state.(*financeAuthoritativeMatchState)
// L2
if !ok || matchState == nil { return state, false, "match state unavailable" }
// L3
if matchState.CommunityID != "" { if err := ensureCommunityMembership(ctx, nk, matchState.CommunityID, matchState.Kind, presence.GetUserId()); err != nil { return state, false, "community membership required" } }
// L4
if len(matchState.ExpectedPlayers) > 0 && !matchState.ExpectedPlayers[presence.GetUserId()] { return state, false, "player was not selected for this match" }
// L5
if !knownPlayer && len(matchState.Players) >= 2 { return state, false, "match is full" }
// L6
return state, true, ""
```
- `L1`：把 Nakama interface state 轉回 finance state。
- `L2`：state 型別不正確時拒絕加入。
- `L3`：community match 驗證玩家 roster membership。
- `L4`：queue match 只允許 expected players 加入。
- `L5`：新玩家且房間已有兩人時拒絕；已知玩家可重連。
- `L6`：通過所有 server 驗證才接受。

## 3. `MatchJoin`、`MatchLeave`
```go
// L1
matchState.Presences[presence.GetSessionId()] = presence
// L2
if _, exists := matchState.Portfolios[userID]; !exists && len(matchState.Players) < 2 { matchState.Players = append(matchState.Players, userID); matchState.Portfolios[userID] = &financePortfolio{UserID: userID, CashCents: financeInitialCashCents, NAVCents: financeInitialCashCents} }
// L3
delete(matchState.DisconnectedAt, userID)
// L4
delete(matchState.Presences, presence.GetSessionId())
// L5
if !financeUserOnline(matchState, presence.GetUserId()) { matchState.DisconnectedAt[presence.GetUserId()] = matchState.Tick }
// L6
financePersistSnapshot(ctx, logger, nk, matchState); financeBroadcastState(dispatcher, matchState, nil)
```
- `L1`：加入 session presence。
- `L2`：首次加入才建立 player 與初始 cash/NAV portfolio。
- `L3`：重連成功時清除斷線 tick。
- `L4`：離開時移除該 session。
- `L5`：同 user 沒有其他 session 才記為真正斷線。
- `L6`：加入或離開後都保存 snapshot 並廣播。

## 4. `MatchLoop`
```go
// L1
matchState.Tick++
// L2
if matchState.Tick%financeMaintenanceIntervalTicks == 0 { financeCleanupExpiredIdempotency(ctx, logger, nk) }
// L3
if financePriceIsStale(matchState.PriceUpdatedAt) { matchState.MarketStale = true }
// L4
for _, message := range messages { financeHandleMessage(ctx, logger, nk, dispatcher, matchState, message) }
// L5
if matchState.Status == "matched_confirming" { /* both ready => countdown; deadline => canceled and outcome */ }
// L6
if matchState.Status == "countdown" && matchState.Tick-matchState.CountdownStartedTick >= financeCountdownTicks { /* set running, refresh price, save round snapshot */ }
// L7
if matchState.Status == "running" { /* refresh each round, fill orders, persist portfolios, forfeit disconnects, finish at time limit */ }
// L8
if matchState.Tick-matchState.LastSnapshotTick >= authoritativeMatchTickRate { matchState.LastSnapshotTick = matchState.Tick; financeMarkPortfolios(matchState); financeBroadcastState(dispatcher, matchState, nil) }
// L9
return matchState
```
- `L1`：每次 authoritative tick 遞增 server tick。
- `L2`：按設定間隔清理過期冪等 key。
- `L3`：價格過期後標記 stale；新 order 會被 orders layer 拒絕。
- `L4`：本 tick 的所有 client message 都交由 server dispatcher 處理。
- `L5`：兩人確認才開始倒數；確認超時則取消並設定 queue outcome。
- `L6`：三秒倒數結束後設定 running、讀最新行情並保存第一回合 snapshot。
- `L7`：對局中每回合更新行情、撮合掛單、保存 portfolio，並檢查斷線判負與時間結束。
- `L8`：至少每秒標記 portfolio 並推送個人化 snapshot。
- `L9`：回傳更新後 state 給 Nakama。

## 5. `financeFinish`
```go
// L1
if state.Status != "running" { return }
// L2
financeMarkPortfolios(state)
// L3
state.Status = "finished"; state.FinishReason = reason; state.WinnerUserIDs = winners
// L4
financeSetMatchmakingStatus(ctx, logger, nk, state.Players, "idle", "", "")
// L5
financeAppendEvent(ctx, logger, nk, dispatcher, state, "match_finished", "", reason)
// L6
if !state.ResultSaved { if err := persistFinanceGameAndStats(ctx, nk, state); err == nil { state.ResultSaved = true } }
// L7
financeBroadcastState(dispatcher, state, nil)
```
- `L1`：防止重複結算。
- `L2`：在判定結果前以最後 server price 標記所有 NAV。
- `L3`：由 server 設定結束狀態、原因與勝者。
- `L4`：玩家 matchmaking record 回到 idle。
- `L5`：保存 finished event。
- `L6`：只保存一次 game/stats；成功後標記防重複。
- `L7`：推送最終 snapshot。

## 6. `financeBroadcastState`
```go
// L1
state.StateVersion++
// L2
if state.Status == "running" { remaining = financeMatchTicks - (state.Tick-state.StartedTick) }
// L3
if targets == nil { for _, presence := range state.Presences { targets = append(targets, presence) } }
// L4
for _, target := range targets { /* build only target portfolio and target open orders */ }
// L5
payload := map[string]interface{}{ "portfolios": selfPortfolios, "openOrders": openOrders, "opponentLeadStatus": financeOpponentLeadStatus(state, userID), "stateVersion": state.StateVersion /* other public status */ }
// L6
dispatcher.BroadcastMessage(financeStateOpCode, []byte(mustJSON(payload)), []runtime.Presence{target}, nil, true)
```
- `L1`：每次推送增加 state version，前端可辨識新 snapshot。
- `L2`：running 時由 tick 算剩餘秒數；不相信 client timer。
- `L3`：未指定 recipients 時向全部連線 session 推送。
- `L4`：每位接收者只取得自己的 portfolio 和 own open orders。
- `L5`：對手只得到模糊化 lead status，不會得到即時資產。
- `L6`：以 directed broadcast 個別發送 personal snapshot。

## 7. `financeOpponentLeadStatus`、`MatchTerminate`、`MatchSignal`
```go
// L1
if self == nil || len(opponents) != 1 || state.Portfolios[opponents[0]] == nil || state.Status != "running" { return "even" }
// L2
difference := state.Portfolios[opponents[0]].ReturnBps - self.ReturnBps
// L3
if difference > 5 { return "opponent_ahead" }; if difference < -5 { return "you_ahead" }; return "even"
// L4
return state
// L5
return state, data
```
- `L1`：資料不足或非對局中時不透露比較結果。
- `L2`：以 server 計算的 return bps 比較。
- `L3`：超過五 bps 才顯示誰領先，否則模糊為 even。
- `L4`：terminate 預設保留 state。
- `L5`：signal 預設原樣回傳 state 與 data。
