package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/heroiclabs/nakama-common/runtime"
	"math"
	"sort"
	"strings"
	"time"
)

// financeHandleMessage 負責交易意圖、訂單驗證、成交與投組計算。
func financeHandleMessage(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, state *financeAuthoritativeMatchState, message runtime.MatchData) {
	userID := message.GetUserId()
	if !financeHasPlayer(state, userID) {
		return
	}
	if !financeAllowMessage(state, userID, message.GetOpCode()) {
		return
	}
	switch message.GetOpCode() {
	case financeReadyOpCode:
		if state.Status != "waiting" && state.Status != "matched_confirming" {
			return
		}
		var payload struct {
			Ready bool `json:"ready"`
		}
		if json.Unmarshal(message.GetData(), &payload) != nil {
			return
		}
		if state.Status == "matched_confirming" && !payload.Ready {
			return
		}
		state.Ready[userID] = payload.Ready
		financeAppendEvent(ctx, logger, nk, dispatcher, state, "ready_changed", userID, fmt.Sprintf("%t", payload.Ready))
		financePersistSnapshot(ctx, logger, nk, state)
		financeBroadcastState(dispatcher, state, nil)
	case financeMatchCancelOpCode:
		if state.Status != "matched_confirming" && state.Status != "waiting" && state.Status != "countdown" {
			return
		}
		state.Status = "canceled"
		state.CanceledByUserID = userID
		state.CancelReason = "player_canceled"
		state.CountdownStartedTick = state.Tick
		financeAppendEvent(ctx, logger, nk, dispatcher, state, "match_canceled", userID, state.CancelReason)
		financeSetConfirmationOutcome(ctx, logger, nk, state)
		financePersistSnapshot(ctx, logger, nk, state)
		financeBroadcastState(dispatcher, state, nil)
	case financeOrderOpCode:
		var intent financeOrderIntent
		if err := json.Unmarshal(message.GetData(), &intent); err != nil {
			financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "invalid_order_payload")
			return
		}
		financeAcceptOrder(ctx, logger, nk, dispatcher, state, userID, intent)
	case financeCancelOpCode:
		var intent financeCancelIntent
		if json.Unmarshal(message.GetData(), &intent) != nil {
			return
		}
		order := state.Orders[strings.TrimSpace(intent.OrderID)]
		if order == nil || order.UserID != userID || (order.Status != "open" && order.Status != "partial") {
			financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "order_not_cancelable")
			return
		}
		order.Status = "canceled"
		order.Reason = "canceled_by_user"
		order.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		financeAppendEvent(ctx, logger, nk, dispatcher, state, "order_canceled", userID, order.ID)
		financePersistOrder(ctx, logger, nk, state.ArenaID, order)
		financePersistSnapshot(ctx, logger, nk, state)
		financeBroadcastState(dispatcher, state, nil)
	case financeStateRequestOpCode:
		financeBroadcastState(dispatcher, state, []runtime.Presence{message})
	case financeResignOpCode:
		if state.Status == "running" {
			financeFinish(ctx, logger, nk, dispatcher, state, "resign", financeOtherPlayers(state, userID))
		}
	}
}

// financeAllowMessage 限制每位玩家在單一 server tick 可送出的交易 mutation 與 state request 數量。
func financeAllowMessage(state *financeAuthoritativeMatchState, userID string, opCode int64) bool {
	limit := financeMutationMessagesPerTick
	if opCode == financeStateRequestOpCode {
		limit = financeStateRequestsPerTick
	}
	key := fmt.Sprintf("%s:%d", userID, opCode)
	window := state.MessageRateWindows[key]
	if window.Tick != state.Tick {
		window = financeMessageRateWindow{Tick: state.Tick}
	}
	if window.Count >= limit {
		return false
	}
	window.Count++
	state.MessageRateWindows[key] = window
	return true
}

// financeAcceptOrder 負責交易意圖、訂單驗證、成交與投組計算。
func financeAcceptOrder(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, state *financeAuthoritativeMatchState, userID string, intent financeOrderIntent) {
	if state.Status != "running" {
		financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "match_not_running")
		return
	}
	if state.MarketStale {
		financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "market_data_stale")
		return
	}
	intent.Side = strings.ToLower(strings.TrimSpace(intent.Side))
	intent.OrderType = strings.ToLower(strings.TrimSpace(intent.OrderType))
	intent.ClientOrderID = strings.TrimSpace(intent.ClientOrderID)
	if intent.ClientOrderID == "" || len(intent.ClientOrderID) > 128 {
		financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "invalid_client_order_id")
		return
	}
	clientOrderKey := userID + ":" + intent.ClientOrderID
	if existingOrderID := state.ClientOrders[clientOrderKey]; existingOrderID != "" {
		financeAppendEvent(ctx, logger, nk, dispatcher, state, "order_replayed", userID, existingOrderID)
		financeBroadcastState(dispatcher, state, nil)
		return
	}
	if existing, found, err := readFinanceOrderIdempotency(ctx, nk, state.ArenaID, userID, intent.ClientOrderID); err != nil {
		logger.Warn("Finance idempotency read failed arena=%s user=%s: %v", state.ArenaID, userID, err)
	} else if found {
		state.ClientOrders[clientOrderKey] = existing.OrderID
		financeAppendEvent(ctx, logger, nk, dispatcher, state, "order_replayed", userID, existing.OrderID)
		financeBroadcastState(dispatcher, state, nil)
		return
	}
	if intent.Side != "buy" && intent.Side != "sell" {
		financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "invalid_side")
		return
	}
	if intent.OrderType != "market" && intent.OrderType != "limit" {
		financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "invalid_order_type")
		return
	}
	if intent.QuantityMicros <= 0 || intent.QuantityMicros > matchMaxPosition*financeBTCScale {
		financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "invalid_quantity")
		return
	}
	if intent.OrderType == "limit" && intent.LimitPriceCents <= 0 {
		financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "invalid_limit_price")
		return
	}
	portfolio := state.Portfolios[userID]
	if intent.Side == "sell" && intent.QuantityMicros > financeAvailableSellQuantity(state, userID) {
		financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "insufficient_position")
		return
	}
	if intent.Side == "buy" {
		reservationPrice := state.PriceCents
		if intent.OrderType == "limit" {
			reservationPrice = intent.LimitPriceCents
		}
		reserved := financeReservedBuyNotional(state, userID)
		orderNotional := financeNotional(intent.QuantityMicros, reservationPrice)
		if reservationPrice <= 0 || orderNotional+calculateBpsCeil(orderNotional, matchTakerFeeBps)+reserved > portfolio.CashCents {
			financeRejectIntent(ctx, logger, nk, dispatcher, state, userID, "insufficient_cash")
			return
		}
	}
	state.OrderSequence++
	nowTime := time.Now().UTC()
	now := nowTime.Format(time.RFC3339Nano)
	order := &financeOrder{
		ID: fmt.Sprintf("%s:%06d", state.ArenaID, state.OrderSequence), UserID: userID, Side: intent.Side,
		ClientOrderID: intent.ClientOrderID,
		OrderType:     intent.OrderType, QuantityMicros: intent.QuantityMicros, RemainingQuantityMicros: intent.QuantityMicros,
		LimitPriceCents: intent.LimitPriceCents, Status: "open", Round: state.Round, CreatedAt: now, UpdatedAt: now,
	}
	state.Orders[order.ID] = order
	state.ClientOrders[clientOrderKey] = order.ID
	financePersistOrder(ctx, logger, nk, state.ArenaID, order)
	financeAppendEvent(ctx, logger, nk, dispatcher, state, "order_accepted", userID, order.ID)
	financeTryFillOrder(ctx, logger, nk, dispatcher, state, order)
	financePersistOrder(ctx, logger, nk, state.ArenaID, order)
	financePersistSnapshot(ctx, logger, nk, state)
	financeBroadcastState(dispatcher, state, nil)
}

// financeTryFillOrder 負責交易意圖、訂單驗證、成交與投組計算。
func financeTryFillOrder(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, state *financeAuthoritativeMatchState, order *financeOrder) {
	if order == nil || (order.Status != "open" && order.Status != "partial") || order.RemainingQuantityMicros <= 0 || state.PriceCents <= 0 {
		return
	}
	fillable := order.OrderType == "market" || (order.Side == "buy" && order.LimitPriceCents >= state.PriceCents) || (order.Side == "sell" && order.LimitPriceCents <= state.PriceCents)
	if !fillable {
		return
	}
	defer financePersistOrder(ctx, logger, nk, state.ArenaID, order)
	portfolio := state.Portfolios[order.UserID]
	executionPrice, slippagePerBTC := applyMatchSlippage(state.PriceCents, order.Side)
	quantityMicros := order.RemainingQuantityMicros
	fee := int64(0)
	tax := int64(0)
	notional := int64(0)
	if order.Side == "buy" {
		quantityMicros = financeAffordableBuyQuantity(portfolio.CashCents, executionPrice, quantityMicros)
		if quantityMicros <= 0 || portfolio.QuantityMicros+quantityMicros > matchMaxPosition*financeBTCScale {
			order.Status = "rejected"
			order.Reason = "cash_or_position_limit"
			financeAppendEvent(ctx, logger, nk, dispatcher, state, "order_rejected", order.UserID, order.Reason)
			return
		}
		notional = financeNotional(quantityMicros, executionPrice)
		fee = calculateBpsCeil(notional, matchTakerFeeBps)
		oldCost := portfolio.AverageCostCents * portfolio.QuantityMicros
		portfolio.CashCents -= notional + fee
		portfolio.QuantityMicros += quantityMicros
		portfolio.AverageCostCents = (oldCost + executionPrice*quantityMicros) / portfolio.QuantityMicros
	} else {
		if quantityMicros > portfolio.QuantityMicros {
			quantityMicros = portfolio.QuantityMicros
		}
		if quantityMicros <= 0 {
			order.Status = "rejected"
			order.Reason = "insufficient_position"
			financeAppendEvent(ctx, logger, nk, dispatcher, state, "order_rejected", order.UserID, order.Reason)
			return
		}
		notional = financeNotional(quantityMicros, executionPrice)
		fee = calculateBpsCeil(notional, matchTakerFeeBps)
		tax = calculateBpsCeil(notional, matchTaxBps)
		portfolio.CashCents += notional - fee - tax
		portfolio.RealizedPnLCents += financeNotional(quantityMicros, executionPrice-portfolio.AverageCostCents) - fee - tax
		portfolio.QuantityMicros -= quantityMicros
		if portfolio.QuantityMicros == 0 {
			portfolio.AverageCostCents = 0
		}
	}
	order.RemainingQuantityMicros -= quantityMicros
	if order.RemainingQuantityMicros <= 0 {
		order.Status = "filled"
		order.RemainingQuantityMicros = 0
	} else if order.OrderType == "market" {
		order.Status = "partial"
		order.Reason = "ioc_remainder_canceled"
		order.RemainingQuantityMicros = 0
	} else {
		order.Status = "partial"
		order.Reason = "partially_filled"
	}
	order.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	fill := financeFillRecord{
		ID: fmt.Sprintf("%s:%06d", order.ID, len(state.Fills)+1), ArenaID: state.ArenaID, OrderID: order.ID, UserID: order.UserID,
		Side: order.Side, QuantityMicros: quantityMicros, PriceCents: executionPrice, NotionalCents: notional,
		FeeCents: fee, TaxCents: tax, SlippageCents: financeNotional(quantityMicros, slippagePerBTC), Round: state.Round, ExecutedAt: order.UpdatedAt,
	}
	state.Fills = append(state.Fills, fill)
	financePersistFill(ctx, logger, nk, fill)
	financeMarkPortfolios(state)
	financePersistRoundPortfolios(ctx, logger, nk, state)
	financeAppendEvent(ctx, logger, nk, dispatcher, state, "order_filled", order.UserID, fmt.Sprintf("%s@%d", order.ID, executionPrice))
}

// financeProcessOpenOrders 負責交易意圖、訂單驗證、成交與投組計算。
func financeProcessOpenOrders(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, state *financeAuthoritativeMatchState) {
	keys := make([]string, 0, len(state.Orders))
	for key := range state.Orders {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		financeTryFillOrder(ctx, logger, nk, dispatcher, state, state.Orders[key])
	}
}

// financeRefreshPrice 負責交易意圖、訂單驗證、成交與投組計算。
func financeRefreshPrice(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, state *financeAuthoritativeMatchState) {
	record, stale, err := readFinanceBTCPrice(ctx, nk)
	if err != nil {
		logger.Warn("Finance match price refresh failed arena=%s: %v", state.ArenaID, err)
		state.MarketStale = true
		return
	}
	state.MarketStale = stale
	if record.Price > 0 {
		state.PriceCents = record.Price * financeUSDScale
		state.PriceUpdatedAt = record.UpdatedAt
	}
	financeMarkPortfolios(state)
}

// financeMarkPortfolios 負責交易意圖、訂單驗證、成交與投組計算。
func financeMarkPortfolios(state *financeAuthoritativeMatchState) {
	for _, portfolio := range state.Portfolios {
		portfolio.UnrealizedPnLCents = financeNotional(portfolio.QuantityMicros, state.PriceCents-portfolio.AverageCostCents)
		portfolio.NAVCents = portfolio.CashCents + financeNotional(portfolio.QuantityMicros, state.PriceCents)
		portfolio.ReturnBps = int64(math.Round(float64(portfolio.NAVCents-financeInitialCashCents) * 10000 / float64(financeInitialCashCents)))
	}
}

// financeRejectIntent 負責交易意圖、訂單驗證、成交與投組計算。
func financeRejectIntent(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, state *financeAuthoritativeMatchState, userID, reason string) {
	financeUpdateMetrics(ctx, logger, nk, func(metrics *financeSystemMetrics) {
		metrics.OrderRejections[reason]++
	})
	financeAppendEvent(ctx, logger, nk, dispatcher, state, "intent_rejected", userID, reason)
}

// financeHasPlayer 負責交易意圖、訂單驗證、成交與投組計算。
func financeHasPlayer(state *financeAuthoritativeMatchState, userID string) bool {
	for _, playerID := range state.Players {
		if playerID == userID {
			return true
		}
	}
	return false
}

// financeAllReady 負責交易意圖、訂單驗證、成交與投組計算。
func financeAllReady(state *financeAuthoritativeMatchState) bool {
	return len(state.Players) == 2 && state.Ready[state.Players[0]] && state.Ready[state.Players[1]]
}

// financeUserOnline 負責交易意圖、訂單驗證、成交與投組計算。
func financeUserOnline(state *financeAuthoritativeMatchState, userID string) bool {
	for _, presence := range state.Presences {
		if presence.GetUserId() == userID {
			return true
		}
	}
	return false
}

// financeAvailableSellQuantity 負責交易意圖、訂單驗證、成交與投組計算。
func financeAvailableSellQuantity(state *financeAuthoritativeMatchState, userID string) int64 {
	available := state.Portfolios[userID].QuantityMicros
	for _, order := range state.Orders {
		if order.UserID == userID && order.Side == "sell" && (order.Status == "open" || order.Status == "partial") {
			available -= order.RemainingQuantityMicros
		}
	}
	if available < 0 {
		return 0
	}
	return available
}

// financeReservedBuyNotional 負責交易意圖、訂單驗證、成交與投組計算。
func financeReservedBuyNotional(state *financeAuthoritativeMatchState, userID string) int64 {
	reserved := int64(0)
	for _, order := range state.Orders {
		if order.UserID == userID && order.Side == "buy" && (order.Status == "open" || order.Status == "partial") {
			price := order.LimitPriceCents
			if order.OrderType == "market" {
				price = state.PriceCents
			}
			notional := financeNotional(order.RemainingQuantityMicros, price)
			reserved += notional + calculateBpsCeil(notional, matchTakerFeeBps)
		}
	}
	return reserved
}

// financeNotional 負責交易意圖、訂單驗證、成交與投組計算。
func financeNotional(quantityMicros, price int64) int64 {
	return quantityMicros * price / financeBTCScale
}

// financeAffordableBuyQuantity 負責交易意圖、訂單驗證、成交與投組計算。
func financeAffordableBuyQuantity(cash, price, requestedMicros int64) int64 {
	if cash <= 0 || price <= 0 || requestedMicros <= 0 {
		return 0
	}
	low, high := int64(0), requestedMicros
	for low < high {
		mid := (low + high + 1) / 2
		notional := financeNotional(mid, price)
		if notional+calculateBpsCeil(notional, matchTakerFeeBps) <= cash {
			low = mid
		} else {
			high = mid - 1
		}
	}
	return low
}

// financeOtherPlayers 負責交易意圖、訂單驗證、成交與投組計算。
func financeOtherPlayers(state *financeAuthoritativeMatchState, excluded string) []string {
	result := make([]string, 0, 1)
	for _, userID := range state.Players {
		if userID != excluded {
			result = append(result, userID)
		}
	}
	return result
}

// financeNAVWinners 負責交易意圖、訂單驗證、成交與投組計算。
func financeNAVWinners(state *financeAuthoritativeMatchState) []string {
	best := int64(math.MinInt64)
	winners := []string{}
	for _, userID := range state.Players {
		nav := state.Portfolios[userID].NAVCents
		if nav > best {
			best = nav
			winners = []string{userID}
		} else if nav == best {
			winners = append(winners, userID)
		}
	}
	return winners
}
