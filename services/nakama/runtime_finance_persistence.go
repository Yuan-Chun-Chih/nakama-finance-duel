package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
)

// financeAppendEvent 負責事件、訂單、快照、冪等與戰績資料保存。
func financeAppendEvent(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, state *financeAuthoritativeMatchState, eventType, actorUserID, detail string) {
	state.EventSequence++
	record := map[string]interface{}{
		"arenaId": state.ArenaID, "sequence": state.EventSequence, "type": eventType, "actorUserId": actorUserID,
		"detail": detail, "round": state.Round, "createdAt": time.Now().UTC().Format(time.RFC3339Nano),
	}
	key := fmt.Sprintf("%s:%08d", state.ArenaID, state.EventSequence)
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceEvents, Key: key, UserID: "", Value: mustJSON(record), Version: "*", PermissionRead: 0, PermissionWrite: 0}}); err != nil {
		logger.Error("Finance event append failed arena=%s sequence=%d: %v", state.ArenaID, state.EventSequence, err)
		return
	}
	var recipients []runtime.Presence
	if actorUserID != "" && (strings.HasPrefix(eventType, "order_") || eventType == "intent_rejected") {
		for _, presence := range state.Presences {
			if presence.GetUserId() == actorUserID {
				recipients = append(recipients, presence)
			}
		}
		if len(recipients) == 0 {
			return
		}
	}
	_ = dispatcher.BroadcastMessage(financeEventOpCode, []byte(mustJSON(map[string]interface{}{"kind": "finance_event", "event": record})), recipients, nil, true)
}

// financePersistSnapshot 負責事件、訂單、快照、冪等與戰績資料保存。
func financePersistSnapshot(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, state *financeAuthoritativeMatchState) {
	value := mustJSON(map[string]interface{}{
		"arenaId": state.ArenaID, "status": state.Status, "round": state.Round, "priceCents": state.PriceCents,
		"players": state.Players, "ready": state.Ready, "portfolios": state.Portfolios, "orders": state.Orders,
		"winnerUserIds": state.WinnerUserIDs, "finishReason": state.FinishReason, "updatedAt": time.Now().UTC().Format(time.RFC3339Nano),
	})
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceSnapshots, Key: state.ArenaID, UserID: "", Value: value, PermissionRead: 0, PermissionWrite: 0}}); err != nil {
		logger.Error("Finance snapshot persistence failed arena=%s: %v", state.ArenaID, err)
	}
}

// financePersistOrder 負責事件、訂單、快照、冪等與戰績資料保存。
func financePersistOrder(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, arenaID string, order *financeOrder) {
	if order == nil {
		return
	}
	value := mustJSON(map[string]interface{}{"arenaId": arenaID, "order": order})
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceOrders, Key: order.ID, UserID: "", Value: value, PermissionRead: 0, PermissionWrite: 0}}); err != nil {
		logger.Error("Finance order persistence failed arena=%s order=%s: %v", arenaID, order.ID, err)
		return
	}
	financeAppendArenaIndex(ctx, logger, nk, arenaID, []string{order.ID}, nil, nil)
	financePersistOrderIdempotency(ctx, logger, nk, arenaID, order)
}

// financeOrderIdempotencyKey 負責事件、訂單、快照、冪等與戰績資料保存。
func financeOrderIdempotencyKey(arenaID, userID, clientOrderID string) string {
	return arenaID + ":" + userID + ":" + clientOrderID
}

// readFinanceOrderIdempotency 負責事件、訂單、快照、冪等與戰績資料保存。
func readFinanceOrderIdempotency(ctx context.Context, nk runtime.NakamaModule, arenaID, userID, clientOrderID string) (financeOrderIdempotencyRecord, bool, error) {
	key := financeOrderIdempotencyKey(arenaID, userID, clientOrderID)
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceIdempotency, Key: key, UserID: ""}})
	if err != nil {
		return financeOrderIdempotencyRecord{}, false, err
	}
	if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" {
		return financeOrderIdempotencyRecord{}, false, nil
	}
	var record financeOrderIdempotencyRecord
	if err := json.Unmarshal([]byte(objects[0].GetValue()), &record); err != nil {
		return financeOrderIdempotencyRecord{}, false, err
	}
	if expiresAt, err := time.Parse(time.RFC3339Nano, record.ExpiresAt); err != nil || !expiresAt.After(time.Now().UTC()) {
		return financeOrderIdempotencyRecord{}, false, nil
	}
	return record, record.OrderID != "", nil
}

// financePersistOrderIdempotency 負責事件、訂單、快照、冪等與戰績資料保存。
func financePersistOrderIdempotency(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, arenaID string, order *financeOrder) {
	if order == nil || order.ClientOrderID == "" {
		return
	}
	record := financeOrderIdempotencyRecord{
		ArenaID: arenaID, UserID: order.UserID, ClientOrderID: order.ClientOrderID, OrderID: order.ID,
		Status: order.Status, Reason: order.Reason, ExpiresAt: time.Now().UTC().Add(financeIdempotencyRetention).Format(time.RFC3339Nano), UpdatedAt: order.UpdatedAt,
	}
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection: collectionFinanceIdempotency, Key: financeOrderIdempotencyKey(arenaID, order.UserID, order.ClientOrderID), UserID: "",
		Value: mustJSON(record), PermissionRead: 0, PermissionWrite: 0,
	}}); err != nil {
		logger.Error("Finance idempotency persistence failed arena=%s order=%s: %v", arenaID, order.ID, err)
	}
}

// financeCleanupExpiredIdempotency 負責事件、訂單、快照、冪等與戰績資料保存。
func financeCleanupExpiredIdempotency(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule) {
	maintenance, version, err := readFinanceMaintenanceCursor(ctx, nk, "idempotency_cleanup")
	if err != nil {
		logger.Warn("Finance idempotency cleanup cursor read failed: %v", err)
		return
	}
	objects, nextCursor, err := nk.StorageList(ctx, "", "", collectionFinanceIdempotency, financeCleanupBatchSize, maintenance.Cursor)
	if err != nil {
		logger.Warn("Finance idempotency cleanup list failed: %v", err)
		return
	}
	deletes, nextMaintenance := financeIdempotencyCleanupPage(objects, nextCursor, time.Now().UTC())
	if len(deletes) > 0 {
		if err := nk.StorageDelete(ctx, deletes); err != nil {
			logger.Warn("Finance idempotency cleanup delete failed: %v", err)
		}
	}
	maintenance = nextMaintenance
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection: collectionFinanceMaintenance, Key: "idempotency_cleanup", UserID: "", Value: mustJSON(maintenance), Version: version, PermissionRead: 0, PermissionWrite: 0,
	}}); err != nil {
		logger.Warn("Finance idempotency cleanup cursor write failed: %v", err)
	}
}

// financeIdempotencyCleanupPage 負責事件、訂單、快照、冪等與戰績資料保存。
func financeIdempotencyCleanupPage(objects []*api.StorageObject, nextCursor string, now time.Time) ([]*runtime.StorageDelete, financeMaintenanceCursor) {
	deletes := make([]*runtime.StorageDelete, 0)
	for _, object := range objects {
		if object == nil || object.GetValue() == "" {
			continue
		}
		var record financeOrderIdempotencyRecord
		if json.Unmarshal([]byte(object.GetValue()), &record) != nil {
			continue
		}
		expiresAt, parseErr := time.Parse(time.RFC3339Nano, record.ExpiresAt)
		if parseErr != nil || !expiresAt.After(now) {
			deletes = append(deletes, &runtime.StorageDelete{
				Collection: collectionFinanceIdempotency,
				Key:        object.GetKey(),
				UserID:     "",
				Version:    object.GetVersion(),
			})
		}
	}
	return deletes, financeMaintenanceCursor{
		Cursor:    nextCursor,
		UpdatedAt: now.Format(time.RFC3339Nano),
	}
}

// financeUpdateMetrics 負責事件、訂單、快照、冪等與戰績資料保存。
func financeUpdateMetrics(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, mutate func(*financeSystemMetrics)) {
	key := financeMetricsShardKey(time.Now().UTC())
	for attempt := 0; attempt < financeStatsCASRetries; attempt++ {
		objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceMetrics, Key: key, UserID: ""}})
		if err != nil {
			if logger != nil {
				logger.Error("Finance metrics read failed: %v", err)
			}
			return
		}
		metrics := financeSystemMetrics{OrderRejections: map[string]int64{}}
		version := "*"
		if len(objects) > 0 && objects[0] != nil {
			version = objects[0].GetVersion()
			if json.Unmarshal([]byte(objects[0].GetValue()), &metrics) != nil {
				metrics = financeSystemMetrics{OrderRejections: map[string]int64{}}
			}
		}
		if metrics.OrderRejections == nil {
			metrics.OrderRejections = map[string]int64{}
		}
		mutate(&metrics)
		metrics.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
			Collection: collectionFinanceMetrics, Key: key, UserID: "", Value: mustJSON(metrics), Version: version, PermissionRead: 0, PermissionWrite: 0,
		}}); err == nil {
			return
		} else if attempt+1 < financeStatsCASRetries {
			time.Sleep(time.Duration(1<<attempt) * 5 * time.Millisecond)
		}
	}
	if logger != nil {
		logger.Error("Finance metrics write exhausted CAS retries")
	}
}

// readFinanceMetrics 負責事件、訂單、快照、冪等與戰績資料保存。
func readFinanceMetrics(ctx context.Context, nk runtime.NakamaModule) (financeSystemMetrics, error) {
	reads := make([]*runtime.StorageRead, 0, financeMetricsShardCount+1)
	reads = append(reads, &runtime.StorageRead{Collection: collectionFinanceMetrics, Key: "global", UserID: ""}) // Legacy aggregate.
	for shard := 0; shard < financeMetricsShardCount; shard++ {
		reads = append(reads, &runtime.StorageRead{Collection: collectionFinanceMetrics, Key: fmt.Sprintf("shard:%02d", shard), UserID: ""})
	}
	objects, err := nk.StorageRead(ctx, reads)
	if err != nil {
		return financeSystemMetrics{}, err
	}
	metrics := financeSystemMetrics{OrderRejections: map[string]int64{}}
	for _, object := range objects {
		if object == nil || object.GetValue() == "" {
			continue
		}
		var shard financeSystemMetrics
		if err := json.Unmarshal([]byte(object.GetValue()), &shard); err != nil {
			return financeSystemMetrics{}, err
		}
		financeMergeMetrics(&metrics, shard)
	}
	return metrics, nil
}

// financeMetricsShardKey 負責事件、訂單、快照、冪等與戰績資料保存。
func financeMetricsShardKey(now time.Time) string {
	return fmt.Sprintf("shard:%02d", now.UnixNano()%int64(financeMetricsShardCount))
}

// financeMergeMetrics 負責事件、訂單、快照、冪等與戰績資料保存。
func financeMergeMetrics(total *financeSystemMetrics, shard financeSystemMetrics) {
	total.MatchmakingStarts += shard.MatchmakingStarts
	total.MatchedPlayers += shard.MatchedPlayers
	total.TotalMatchWaitSeconds += shard.TotalMatchWaitSeconds
	total.CompletedMatches += shard.CompletedMatches
	total.TotalStaleMarketSeconds += shard.TotalStaleMarketSeconds
	if total.OrderRejections == nil {
		total.OrderRejections = map[string]int64{}
	}
	for reason, count := range shard.OrderRejections {
		total.OrderRejections[reason] += count
	}
	if shard.UpdatedAt > total.UpdatedAt {
		total.UpdatedAt = shard.UpdatedAt
	}
}

// financePersistFill 負責事件、訂單、快照、冪等與戰績資料保存。
func financePersistFill(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, fill financeFillRecord) {
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceFills, Key: fill.ID, UserID: "", Value: mustJSON(fill), Version: "*", PermissionRead: 0, PermissionWrite: 0}}); err != nil {
		logger.Error("Finance fill persistence failed arena=%s fill=%s: %v", fill.ArenaID, fill.ID, err)
		return
	}
	financeAppendArenaIndex(ctx, logger, nk, fill.ArenaID, nil, []string{fill.ID}, nil)
}

// financePersistRoundPortfolios 負責事件、訂單、快照、冪等與戰績資料保存。
func financePersistRoundPortfolios(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, state *financeAuthoritativeMatchState) {
	if state.Round <= 0 {
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	writes := make([]*runtime.StorageWrite, 0, len(state.Players))
	keys := make([]string, 0, len(state.Players))
	for _, userID := range state.Players {
		portfolio := state.Portfolios[userID]
		if portfolio == nil {
			continue
		}
		record := financePortfolioSnapshotRecord{ArenaID: state.ArenaID, Round: state.Round, PriceCents: state.PriceCents, Portfolio: *portfolio, CreatedAt: now}
		key := fmt.Sprintf("%s:%03d:%s", state.ArenaID, state.Round, userID)
		writes = append(writes, &runtime.StorageWrite{Collection: collectionFinancePortfolios, Key: key, UserID: "", Value: mustJSON(record), PermissionRead: 0, PermissionWrite: 0})
		keys = append(keys, key)
	}
	if len(writes) == 0 {
		return
	}
	if _, err := nk.StorageWrite(ctx, writes); err != nil {
		logger.Error("Finance portfolio snapshot persistence failed arena=%s round=%d: %v", state.ArenaID, state.Round, err)
		return
	}
	financeAppendArenaIndex(ctx, logger, nk, state.ArenaID, nil, nil, keys)
}

// persistFinanceGameAndStats 負責事件、訂單、快照、冪等與戰績資料保存。
func persistFinanceGameAndStats(ctx context.Context, nk runtime.NakamaModule, state *financeAuthoritativeMatchState) error {
	if len(state.Players) != 2 {
		return failedPrecondition("Finance result requires exactly two players.")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var lastWriteErr error
	for attempt := 0; attempt < financeStatsCASRetries; attempt++ {
		stats, versions, ratings, err := financeUpdatedPlayerStats(ctx, nk, state, now)
		if err != nil {
			return err
		}
		record := financeGameRecord{
			ArenaID: state.ArenaID, CommunityID: state.CommunityID, Kind: state.Kind, Players: append([]string(nil), state.Players...),
			Portfolios: state.Portfolios, WinnerUserIDs: append([]string(nil), state.WinnerUserIDs...), FinishReason: state.FinishReason,
			StartedAt: state.StartedAt, FinishedAt: now, Ratings: ratings,
		}
		projection := financeLeaderboardProjectionRecord{
			ArenaID: state.ArenaID, Scores: map[string]int64{}, Usernames: map[string]string{}, CreatedAt: now,
		}
		for _, userID := range state.Players {
			projection.Scores[userID] = state.Portfolios[userID].ReturnBps
			projection.Usernames[userID] = state.Usernames[userID]
		}
		writes := []*runtime.StorageWrite{
			{Collection: collectionFinanceGames, Key: state.ArenaID, UserID: "", Value: mustJSON(record), Version: "*", PermissionRead: 0, PermissionWrite: 0},
			{Collection: collectionFinanceLeaderboardProjection, Key: state.ArenaID, UserID: "", Value: mustJSON(projection), Version: "*", PermissionRead: 0, PermissionWrite: 0},
		}
		for index, stat := range stats {
			writes = append(writes,
				&runtime.StorageWrite{Collection: collectionFinanceStats, Key: stat.UserID, UserID: "", Value: mustJSON(stat), Version: versions[index], PermissionRead: 0, PermissionWrite: 0},
				&runtime.StorageWrite{Collection: collectionFinanceHistory, Key: financeHistoryKey(now, state.ArenaID), UserID: stat.UserID, Value: mustJSON(record), Version: "*", PermissionRead: 0, PermissionWrite: 0},
			)
		}
		if _, err := nk.StorageWrite(ctx, writes); err == nil {
			return nil
		} else {
			lastWriteErr = err
		}
	}
	return fmt.Errorf("finance stats write failed after %d CAS retries: %w", financeStatsCASRetries, lastWriteErr)
}

// financeUpdatedPlayerStats 負責事件、訂單、快照、冪等與戰績資料保存。
func financeUpdatedPlayerStats(ctx context.Context, nk runtime.NakamaModule, state *financeAuthoritativeMatchState, updatedAt string) ([2]financePlayerStatsRecord, [2]string, []financeRatingChange, error) {
	stats := [2]financePlayerStatsRecord{}
	versions := [2]string{}
	changes := make([]financeRatingChange, 2)
	reads := []*runtime.StorageRead{
		{Collection: collectionFinanceStats, Key: state.Players[0], UserID: ""},
		{Collection: collectionFinanceStats, Key: state.Players[1], UserID: ""},
	}
	objects, err := nk.StorageRead(ctx, reads)
	if err != nil {
		return stats, versions, changes, err
	}
	byUserID := map[string]financePlayerStatsRecord{}
	versionByUserID := map[string]string{}
	for _, object := range objects {
		var stat financePlayerStatsRecord
		if object != nil && json.Unmarshal([]byte(object.GetValue()), &stat) == nil && stat.UserID != "" {
			byUserID[stat.UserID] = stat
			versionByUserID[stat.UserID] = object.GetVersion()
		}
	}
	for index, userID := range state.Players {
		stats[index] = byUserID[userID]
		if stats[index].UserID == "" {
			stats[index] = financePlayerStatsRecord{UserID: userID, Rating: financeInitialRating}
			versions[index] = "*"
		} else {
			versions[index] = versionByUserID[userID]
		}
	}
	draw := len(state.WinnerUserIDs) != 1
	firstScore := 0.5
	if !draw {
		if state.WinnerUserIDs[0] == state.Players[0] {
			firstScore = 1
		} else {
			firstScore = 0
		}
	}
	expectedFirst := 1 / (1 + math.Pow(10, float64(stats[1].Rating-stats[0].Rating)/400))
	firstDelta := int(math.Round(float64(financeRatingKFactor) * (firstScore - expectedFirst)))
	deltas := [2]int{firstDelta, -firstDelta}
	for index := range stats {
		before := stats[index].Rating
		stats[index].Games++
		stats[index].Rating += deltas[index]
		stats[index].RatingDelta = deltas[index]
		stats[index].UpdatedAt = updatedAt
		returnBps := state.Portfolios[stats[index].UserID].ReturnBps
		stats[index].TotalReturnBps += returnBps
		if stats[index].Games == 1 || returnBps > stats[index].BestReturnBps {
			stats[index].BestReturnBps = returnBps
		}
		if draw {
			stats[index].Draws++
		} else if state.WinnerUserIDs[0] == stats[index].UserID {
			stats[index].Wins++
		} else {
			stats[index].Losses++
		}
		changes[index] = financeRatingChange{UserID: stats[index].UserID, Before: before, After: stats[index].Rating, Delta: deltas[index]}
	}
	return stats, versions, changes, nil
}

// financeHistoryKey 負責事件、訂單、快照、冪等與戰績資料保存。
func financeHistoryKey(finishedAt, arenaID string) string {
	parsed, err := time.Parse(time.RFC3339Nano, finishedAt)
	if err != nil {
		parsed = time.Now().UTC()
	}
	return fmt.Sprintf("%020d:%s", math.MaxInt64-parsed.UnixNano(), arenaID)
}

// readFinancePlayerStats 負責事件、訂單、快照、冪等與戰績資料保存。
func readFinancePlayerStats(ctx context.Context, nk runtime.NakamaModule, userID string) (financePlayerStatsRecord, error) {
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceStats, Key: userID, UserID: ""}})
	if err != nil {
		return financePlayerStatsRecord{}, err
	}
	if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" {
		return financePlayerStatsRecord{UserID: userID, Rating: financeInitialRating}, nil
	}
	var stat financePlayerStatsRecord
	if err := json.Unmarshal([]byte(objects[0].GetValue()), &stat); err != nil {
		return financePlayerStatsRecord{}, err
	}
	return stat, nil
}
