package main

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/heroiclabs/nakama-common/runtime"
	"sort"
	"strings"
	"time"
)

// MatchInit 負責 authoritative 對局生命週期與即時狀態同步。
func (m *financeAuthoritativeMatch) MatchInit(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, params map[string]interface{}) (interface{}, int, string) {
	priceRecord, marketStale, err := readFinanceBTCPrice(ctx, nk)
	if err != nil {
		logger.Warn("Finance match could not read BTC price feed: %v", err)
	}
	price := priceRecord.Price
	if price <= 0 {
		price = defaultMatchPrices()["BTC/USDT"]
		marketStale = true
	}
	priceUpdatedAt := priceRecord.UpdatedAt
	if priceUpdatedAt == "" {
		priceUpdatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	expectedPlayers := stringSetParam(params, "expectedPlayers")
	status := "waiting"
	confirmationDeadline := int64(0)
	if len(expectedPlayers) == 2 {
		status = "matched_confirming"
		confirmationDeadline = financeConfirmationTicks
	}
	state := &financeAuthoritativeMatchState{
		ArenaID:              defaultString(stringParam(params, "arenaId"), fmt.Sprintf("finance-%d", time.Now().UTC().UnixNano())),
		CommunityID:          stringParam(params, "communityId"),
		Kind:                 normalizeCommunityKind(stringParam(params, "kind")),
		Name:                 defaultString(strings.TrimSpace(stringParam(params, "name")), "BTC trading duel"),
		HostUserID:           stringParam(params, "hostUserId"),
		Presences:            map[string]runtime.Presence{},
		Players:              []string{},
		Usernames:            map[string]string{},
		Ready:                map[string]bool{},
		ExpectedPlayers:      expectedPlayers,
		Portfolios:           map[string]*financePortfolio{},
		Orders:               map[string]*financeOrder{},
		ClientOrders:         map[string]string{},
		MessageRateWindows:   map[string]financeMessageRateWindow{},
		Status:               status,
		ConfirmationDeadline: confirmationDeadline,
		PriceCents:           price * financeUSDScale,
		PriceUpdatedAt:       priceUpdatedAt,
		MarketStale:          marketStale,
		DisconnectedAt:       map[string]int64{},
	}
	logger.Info("Authoritative finance match initialized arena=%s community=%s host=%s", state.ArenaID, state.CommunityID, state.HostUserID)
	return state, authoritativeMatchTickRate, mustJSON(map[string]interface{}{
		"type": gameTypeFinance, "arenaId": state.ArenaID, "communityId": state.CommunityID, "kind": state.Kind, "name": state.Name,
	})
}

// MatchJoinAttempt 負責 authoritative 對局生命週期與即時狀態同步。
func (m *financeAuthoritativeMatch) MatchJoinAttempt(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, _ runtime.MatchDispatcher, _ int64, state interface{}, presence runtime.Presence, _ map[string]string) (interface{}, bool, string) {
	matchState, ok := state.(*financeAuthoritativeMatchState)
	if !ok || matchState == nil {
		return state, false, "match state unavailable"
	}
	if matchState.CommunityID != "" {
		if err := ensureCommunityMembership(ctx, nk, matchState.CommunityID, matchState.Kind, presence.GetUserId()); err != nil {
			return state, false, "community membership required"
		}
	}
	if len(matchState.ExpectedPlayers) > 0 && !matchState.ExpectedPlayers[presence.GetUserId()] {
		return state, false, "player was not selected for this match"
	}
	knownPlayer := false
	for _, playerID := range matchState.Players {
		if playerID == presence.GetUserId() {
			knownPlayer = true
			break
		}
	}
	if !knownPlayer && len(matchState.Players) >= 2 {
		return state, false, "match is full"
	}
	return state, true, ""
}

// MatchJoin 負責 authoritative 對局生命週期與即時狀態同步。
func (m *financeAuthoritativeMatch) MatchJoin(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, _ int64, state interface{}, presences []runtime.Presence) interface{} {
	matchState, ok := state.(*financeAuthoritativeMatchState)
	if !ok || matchState == nil {
		return state
	}
	for _, presence := range presences {
		matchState.Presences[presence.GetSessionId()] = presence
		userID := presence.GetUserId()
		if _, exists := matchState.Portfolios[userID]; !exists && len(matchState.Players) < 2 {
			matchState.Players = append(matchState.Players, userID)
			matchState.Portfolios[userID] = &financePortfolio{UserID: userID, CashCents: financeInitialCashCents, NAVCents: financeInitialCashCents}
		}
		matchState.Usernames[userID] = presence.GetUsername()
		delete(matchState.DisconnectedAt, userID)
		financeAppendEvent(ctx, logger, nk, dispatcher, matchState, "player_joined", userID, "")
	}
	matchState.EmptyTicks = 0
	financePersistSnapshot(ctx, logger, nk, matchState)
	financeBroadcastState(dispatcher, matchState, nil)
	return matchState
}

// MatchLeave 負責 authoritative 對局生命週期與即時狀態同步。
func (m *financeAuthoritativeMatch) MatchLeave(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, _ int64, state interface{}, presences []runtime.Presence) interface{} {
	matchState, ok := state.(*financeAuthoritativeMatchState)
	if !ok || matchState == nil {
		return state
	}
	for _, presence := range presences {
		delete(matchState.Presences, presence.GetSessionId())
		if !financeUserOnline(matchState, presence.GetUserId()) {
			matchState.DisconnectedAt[presence.GetUserId()] = matchState.Tick
			financeAppendEvent(ctx, logger, nk, dispatcher, matchState, "player_disconnected", presence.GetUserId(), "")
		}
	}
	financePersistSnapshot(ctx, logger, nk, matchState)
	financeBroadcastState(dispatcher, matchState, nil)
	return matchState
}

// MatchLoop 負責 authoritative 對局生命週期與即時狀態同步。
func (m *financeAuthoritativeMatch) MatchLoop(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, _ int64, state interface{}, messages []runtime.MatchData) interface{} {
	matchState, ok := state.(*financeAuthoritativeMatchState)
	if !ok || matchState == nil {
		return state
	}
	matchState.Tick++
	// Bounded cleanup advances during active matches instead of waiting for a match to finish.
	if matchState.Tick%financeMaintenanceIntervalTicks == 0 {
		financeRunMaintenanceTask(ctx, logger, nk, "idempotency_cleanup", financeMaintenanceLeaseDuration, func() {
			financeCleanupExpiredIdempotency(ctx, logger, nk)
		})
		financeRunMaintenanceTask(ctx, logger, nk, "leaderboard_projection", financeMaintenanceLeaseDuration, func() {
			financeRetryPendingLeaderboardProjections(ctx, logger, nk)
		})
	}
	if matchState.Tick%marketCleanupIntervalTicks == 0 {
		financeRunMaintenanceTask(ctx, logger, nk, "market_candle_cleanup", marketMaintenanceLeaseDuration, func() {
			cleanupMarketCandleRetention(ctx, logger, nk, "BTC/USDT")
		})
	}
	if financePriceIsStale(matchState.PriceUpdatedAt) {
		matchState.MarketStale = true
	}
	if matchState.Status == "running" && matchState.MarketStale {
		matchState.StaleMarketSeconds++
	}
	if len(matchState.Presences) == 0 {
		matchState.EmptyTicks++
		if matchState.EmptyTicks > 60 {
			logger.Info("Authoritative finance match closed after idle timeout arena=%s", matchState.ArenaID)
			return nil
		}
	} else {
		matchState.EmptyTicks = 0
	}
	for _, message := range messages {
		financeHandleMessage(ctx, logger, nk, dispatcher, matchState, message)
	}
	if matchState.Status == "matched_confirming" {
		if financeAllReady(matchState) {
			matchState.Status = "countdown"
			matchState.CountdownStartedTick = matchState.Tick
			financeAppendEvent(ctx, logger, nk, dispatcher, matchState, "countdown_started", "", fmt.Sprintf("%d", financeCountdownTicks))
			financePersistSnapshot(ctx, logger, nk, matchState)
			financeBroadcastState(dispatcher, matchState, nil)
		} else if matchState.Tick >= matchState.ConfirmationDeadline {
			matchState.Status = "canceled"
			matchState.CancelReason = "confirmation_timeout"
			matchState.CountdownStartedTick = matchState.Tick
			financeAppendEvent(ctx, logger, nk, dispatcher, matchState, "match_canceled", "", matchState.CancelReason)
			financeSetConfirmationOutcome(ctx, logger, nk, matchState)
			financePersistSnapshot(ctx, logger, nk, matchState)
			financeBroadcastState(dispatcher, matchState, nil)
		}
	}
	if matchState.Status == "canceled" && matchState.Tick-matchState.CountdownStartedTick >= 3 {
		return nil
	}
	if matchState.Status == "waiting" && len(matchState.Players) == 2 && financeAllReady(matchState) {
		matchState.Status = "countdown"
		matchState.CountdownStartedTick = matchState.Tick
		financeAppendEvent(ctx, logger, nk, dispatcher, matchState, "countdown_started", "", fmt.Sprintf("%d", financeCountdownTicks))
		financeBroadcastState(dispatcher, matchState, nil)
	}
	if matchState.Status == "countdown" {
		if matchState.Tick-matchState.CountdownStartedTick >= financeCountdownTicks {
			matchState.Status = "running"
			matchState.StartedTick = matchState.Tick
			matchState.StartedAt = time.Now().UTC().Format(time.RFC3339)
			matchState.Round = 1
			financeRefreshPrice(ctx, logger, nk, matchState)
			financePersistRoundPortfolios(ctx, logger, nk, matchState)
			financeAppendEvent(ctx, logger, nk, dispatcher, matchState, "match_started", "", "")
			financeSetMatchmakingStatus(ctx, logger, nk, matchState.Players, "running", "", "")
		}
		financeBroadcastState(dispatcher, matchState, nil)
	}
	if matchState.Status == "running" {
		elapsed := matchState.Tick - matchState.StartedTick
		nextRound := int(elapsed/financeRoundTicks) + 1
		if nextRound != matchState.Round || matchState.PriceCents <= 0 {
			matchState.Round = nextRound
			financeRefreshPrice(ctx, logger, nk, matchState)
			financeProcessOpenOrders(ctx, logger, nk, dispatcher, matchState)
			financePersistRoundPortfolios(ctx, logger, nk, matchState)
			financeBroadcastState(dispatcher, matchState, nil)
			financePersistSnapshot(ctx, logger, nk, matchState)
		}
		for userID, disconnectedTick := range matchState.DisconnectedAt {
			if matchState.Tick-disconnectedTick >= financeReconnectGraceTicks {
				financeFinish(ctx, logger, nk, dispatcher, matchState, "disconnect_forfeit", financeOtherPlayers(matchState, userID))
				break
			}
		}
		if matchState.Status == "running" && elapsed >= financeMatchTicks {
			financeFinish(ctx, logger, nk, dispatcher, matchState, "time_elapsed", financeNAVWinners(matchState))
		}
	}
	if matchState.Tick-matchState.LastSnapshotTick >= authoritativeMatchTickRate {
		matchState.LastSnapshotTick = matchState.Tick
		financeMarkPortfolios(matchState)
		financeBroadcastState(dispatcher, matchState, nil)
	}
	return matchState
}

// financeFinish 負責 authoritative 對局生命週期與即時狀態同步。
func financeFinish(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, state *financeAuthoritativeMatchState, reason string, winners []string) {
	if state.Status != "running" {
		return
	}
	financeMarkPortfolios(state)
	financeUpdateMetrics(ctx, logger, nk, func(metrics *financeSystemMetrics) {
		metrics.CompletedMatches++
		metrics.TotalStaleMarketSeconds += state.StaleMarketSeconds
	})
	state.Status = "finished"
	state.FinishReason = reason
	state.WinnerUserIDs = winners
	financeSetMatchmakingStatus(ctx, logger, nk, state.Players, "idle", "", "")
	financeAppendEvent(ctx, logger, nk, dispatcher, state, "match_finished", "", reason)
	financePersistSnapshot(ctx, logger, nk, state)
	if !state.ResultSaved {
		if err := persistFinanceGameAndStats(ctx, nk, state); err != nil {
			logger.Error("Finance result persistence failed arena=%s: %v", state.ArenaID, err)
		} else {
			state.ResultSaved = true
			if err := projectFinanceResultLeaderboards(ctx, nk, state); err != nil {
				logger.Error("Finance leaderboard projection failed arena=%s: %v", state.ArenaID, err)
			}
		}
	}
	financeBroadcastState(dispatcher, state, nil)
}

// financeBroadcastState 負責 authoritative 對局生命週期與即時狀態同步。
func financeBroadcastState(dispatcher runtime.MatchDispatcher, state *financeAuthoritativeMatchState, recipients []runtime.Presence) {
	state.StateVersion++
	remaining := int64(0)
	countdownRemaining := int64(0)
	if state.Status == "running" {// 計算比賽剩餘時間，若比賽已經結束則 remaining 為 0。
		remaining = financeMatchTicks - (state.Tick - state.StartedTick)
		if remaining < 0 {
			remaining = 0
		}
	} else if state.Status == "countdown" {// 計算倒數計時剩餘時間，若倒數計時已經結束則 countdownRemaining 為 0。
		countdownRemaining = financeCountdownTicks - (state.Tick - state.CountdownStartedTick)
		if countdownRemaining < 0 {
			countdownRemaining = 0
		}
	} else if state.Status == "matched_confirming" {// 計算確認倒數剩餘時間，若確認倒數已經結束則 countdownRemaining 為 0。
		countdownRemaining = state.ConfirmationDeadline - state.Tick
		if countdownRemaining < 0 {
			countdownRemaining = 0
		}
	}
	targets := recipients
	if targets == nil {// 若 recipients 為 nil，則將所有在線玩家作為目標，準備廣播比賽狀態。
		targets = make([]runtime.Presence, 0, len(state.Presences))
		for _, presence := range state.Presences {
			targets = append(targets, presence)
		}
	}
	for _, target := range targets {// 遍歷所有目標玩家，準備廣播比賽狀態給每個玩家。
		userID := target.GetUserId()
		selfPortfolios := map[string]*financePortfolio{}
		if portfolio := state.Portfolios[userID]; portfolio != nil {
			selfPortfolios[userID] = portfolio
		}
		openOrders := make([]*financeOrder, 0)
		for _, order := range state.Orders {// 遍歷所有訂單，找出該玩家的未完成訂單，並按照建立時間排序。
			if order.UserID == userID && (order.Status == "open" || order.Status == "partial") && order.RemainingQuantityMicros > 0 {
				openOrders = append(openOrders, order)
			}
		}
		sort.Slice(openOrders, func(i, j int) bool { return openOrders[i].CreatedAt < openOrders[j].CreatedAt })
		online := map[string]bool{}
		for _, playerID := range state.Players {// 遍歷所有玩家，判斷每個玩家是否在線，並將結果存入 online map。
			online[playerID] = financeUserOnline(state, playerID)
		}
		payload := map[string]interface{}{// 準備廣播的比賽狀態 payload，包含了比賽的各種資訊，例如玩家、訂單、價格等。
			"kind": "finance_state", "arenaId": state.ArenaID, "status": state.Status, "players": state.Players,
			"usernames": state.Usernames, "ready": state.Ready, "online": online, "portfolios": selfPortfolios, "openOrders": openOrders,
			"opponentLeadStatus": financeOpponentLeadStatus(state, userID),
			"round":              state.Round, "remainingSeconds": remaining, "priceCents": state.PriceCents, "priceUpdatedAt": state.PriceUpdatedAt,
			"countdownSeconds": countdownRemaining, "marketStale": state.MarketStale,
			"winnerUserIds": state.WinnerUserIDs, "finishReason": state.FinishReason, "serverTick": state.Tick,
			"stateVersion":     state.StateVersion,
			"canceledByUserId": state.CanceledByUserID, "cancelReason": state.CancelReason,
		}
		_ = dispatcher.BroadcastMessage(financeStateOpCode, []byte(mustJSON(payload)), []runtime.Presence{target}, nil, true)
	}
}

// financeOpponentLeadStatus 負責 authoritative 對局生命週期與即時狀態同步。
func financeOpponentLeadStatus(state *financeAuthoritativeMatchState, userID string) string {
	self := state.Portfolios[userID]
	opponents := financeOtherPlayers(state, userID)
	if self == nil || len(opponents) != 1 || state.Portfolios[opponents[0]] == nil || state.Status != "running" {
		return "even"
	}
	difference := state.Portfolios[opponents[0]].ReturnBps - self.ReturnBps
	if difference > 5 {// 若對手的回報率比自己高超過 5 個基點，則回傳 "opponent_ahead"，表示對手領先。
		return "opponent_ahead"
	}
	if difference < -5 {// 若對手的回報率比自己低超過 5 個基點，則回傳 "you_ahead"，表示自己領先。
		return "you_ahead"
	}
	return "even"
}

// MatchTerminate 負責 authoritative 對局生命週期與即時狀態同步。
func (m *financeAuthoritativeMatch) MatchTerminate(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ runtime.MatchDispatcher, _ int64, state interface{}, _ int) interface{} {
	return state
}

// MatchSignal 負責 authoritative 對局生命週期與即時狀態同步。
func (m *financeAuthoritativeMatch) MatchSignal(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ runtime.MatchDispatcher, _ int64, state interface{}, data string) (interface{}, string) {
	return state, data
}
