package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

// financeMatchmakerMatched 負責配對、確認、QueueToken 與配對狀態保存。
func financeMatchmakerMatched(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, entries []runtime.MatchmakerEntry) (string, error) {
	if len(entries) != 2 { // 只接受兩個玩家的配對，若不是則回傳空字串。
		return "", nil
	} // 檢查配對的玩家是否都是 finance 遊戲類型，若不是則回傳空字串。
	for _, entry := range entries {
		if entry.GetProperties()["gameType"] != gameTypeFinance {
			return "", nil
		}
	} // 將配對的玩家依照建立時間排序，確保配對順序一致。
	sort.Slice(entries, func(i, j int) bool { return entries[i].GetCreateTime() < entries[j].GetCreateTime() })
	expectedPlayers := []string{entries[0].GetPresence().GetUserId(), entries[1].GetPresence().GetUserId()}
	if expectedPlayers[0] == expectedPlayers[1] {
		return "", failedPrecondition("A player cannot be matched against another session of the same account.")
	} // 讀取配對的玩家的 queueToken，並呼叫 claimFinanceMatchmaking 來確認配對。
	queueTokens := map[string]string{}
	for _, entry := range entries {
		queueTokens[entry.GetPresence().GetUserId()], _ = entry.GetProperties()["queueToken"].(string)
	} // 呼叫 claimFinanceMatchmaking 來確認配對，若失敗則回傳錯誤。
	if err := claimFinanceMatchmaking(ctx, nk, expectedPlayers, queueTokens); err != nil {
		return "", err
	} // 建立 Nakama authoritative match，並將配對的玩家加入 match。
	arenaID := fmt.Sprintf("finance-%d", time.Now().UTC().UnixNano())
	matchID, err := nk.MatchCreate(ctx, financeAuthoritativeModule, map[string]interface{}{
		"arenaId": arenaID, "name": "BTC ranked queue", "gameType": gameTypeFinance,
		"expectedPlayers": expectedPlayers, "matchmade": true,
	}) // 若建立 match 失敗則回傳錯誤。
	if err != nil {
		financeSetMatchmakingStatus(ctx, logger, nk, expectedPlayers, "idle", "", "")
		return "", err
	} // 將配對的玩家的 matchmaking 狀態更新為 matched，並記錄配對等待時間。
	for _, userID := range expectedPlayers {
		waitSeconds := int64(0)
		if current, readErr := readFinanceMatchmaking(ctx, nk, userID); readErr == nil {
			if startedAt, parseErr := time.Parse(time.RFC3339Nano, current.SearchStartedAt); parseErr == nil {
				waitSeconds = int64(time.Since(startedAt).Seconds())
			}
		} // 將配對的玩家的 matchmaking 狀態更新為 matched，並記錄配對等待時間。
		now := time.Now().UTC()
		if err := writeFinanceMatchmaking(ctx, nk, financeMatchmakingRecord{UserID: userID, Status: "matched", MatchID: matchID, LeaseExpiresAt: now.Add(financeMatchmakingLease).Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano)}); err != nil {
			return "", err
		} // 更新配對統計資料，包含配對成功次數與總等待時間。
		financeUpdateMetrics(ctx, logger, nk, func(metrics *financeSystemMetrics) {
			metrics.MatchedPlayers++
			metrics.TotalMatchWaitSeconds += waitSeconds
		}) // 回傳 matchID 給前端，前端會使用這個 matchID 來加入 Nakama authoritative match。
	}
	logger.Info("Finance matchmaker paired arena=%s players=%v", arenaID, expectedPlayers)
	return matchID, nil
}

// claimFinanceMatchmaking 負責配對、確認、QueueToken 與配對狀態保存。
func claimFinanceMatchmaking(ctx context.Context, nk runtime.NakamaModule, userIDs []string, queueTokens map[string]string) error {
	reads := make([]*runtime.StorageRead, 0, len(userIDs))
	for _, userID := range userIDs {
		reads = append(reads, &runtime.StorageRead{Collection: collectionFinanceMatchmaking, Key: userID, UserID: ""})
	} // 讀取配對的玩家的 matchmaking 狀態，並確認 queueToken 是否正確。
	objects, err := nk.StorageRead(ctx, reads)
	if err != nil || len(objects) != len(userIDs) {
		return failedPrecondition("Matchmaking state is unavailable.")
	} // 確認配對的玩家的 matchmaking 狀態是否正確，若不正確則回傳錯誤。
	nowTime := time.Now().UTC()
	now := nowTime.Format(time.RFC3339Nano)
	writes := make([]*runtime.StorageWrite, 0, len(objects)) // 建立 StorageWrite 陣列，用於更新配對的玩家的 matchmaking 狀態。
	for _, object := range objects { // 遍歷配對的玩家的 matchmaking 狀態，確認 queueToken 是否正確，若不正確則回傳錯誤。
		if object == nil {
			return failedPrecondition("Player is no longer eligible for matchmaking.")
		} // 將配對的玩家的 matchmaking 狀態更新為 matching，並設定 leaseExpiresAt 為現在時間加上 financeMatchmakingLease。
		var record financeMatchmakingRecord
		if json.Unmarshal([]byte(object.GetValue()), &record) != nil || record.Status != "searching" || record.QueueToken == "" || record.QueueToken != queueTokens[record.UserID] {
			return failedPrecondition("Player is no longer eligible for matchmaking.")
		} // 將配對的玩家的 matchmaking 狀態更新為 matching，並設定 leaseExpiresAt 為現在時間加上 financeMatchmakingLease。
		record.Status = "matching"
		record.LeaseExpiresAt = nowTime.Add(financeMatchmakingLease).Format(time.RFC3339Nano)
		record.UpdatedAt = now
		writes = append(writes, &runtime.StorageWrite{Collection: collectionFinanceMatchmaking, Key: record.UserID, UserID: "", Value: mustJSON(record), Version: object.GetVersion(), PermissionRead: 0, PermissionWrite: 0})
	} // 將配對的玩家的 matchmaking 狀態更新為 matching，並設定 leaseExpiresAt 為現在時間加上 financeMatchmakingLease。
	if _, err := nk.StorageWrite(ctx, writes); err != nil {
		return failedPrecondition("Matchmaking claim was already consumed.")
	} // 將配對的玩家的 matchmaking 狀態更新為 matching，並設定 leaseExpiresAt 為現在時間加上 financeMatchmakingLease。
	return nil
}

// financeSetConfirmationOutcome 負責配對、確認、QueueToken 與配對狀態保存。
func financeSetConfirmationOutcome(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, state *financeAuthoritativeMatchState) {
	now := time.Now().UTC()
	for _, userID := range state.Players {
		status := "searching"
		cooldownUntil := ""
		queueToken := fmt.Sprintf("%s:%d", userID, now.UnixNano())
		if userID == state.CanceledByUserID || (state.CanceledByUserID == "" && !state.Ready[userID]) {
			status = "cooldown"
			queueToken = ""
			cooldownUntil = now.Add(time.Duration(financeCancelCooldownSeconds) * time.Second).Format(time.RFC3339Nano)
		} // 將配對的玩家的 matchmaking 狀態更新為 cooldown，並設定 cooldownUntil 為現在時間加上 financeCancelCooldownSeconds。
		searchStartedAt := ""
		if status == "searching" {
			searchStartedAt = now.Format(time.RFC3339Nano)
		} // 將配對的玩家的 matchmaking 狀態更新為 cooldown，並設定 cooldownUntil 為現在時間加上 financeCancelCooldownSeconds。
		if err := writeFinanceMatchmaking(ctx, nk, financeMatchmakingRecord{UserID: userID, Status: status, QueueToken: queueToken, SearchStartedAt: searchStartedAt, CooldownUntil: cooldownUntil, UpdatedAt: now.Format(time.RFC3339Nano)}); err != nil {
			logger.Error("Finance matchmaking outcome persistence failed user=%s: %v", userID, err)
		} // 將配對的玩家的 matchmaking 狀態更新為 cooldown，並設定 cooldownUntil 為現在時間加上 financeCancelCooldownSeconds。
	}
}

// financeSetMatchmakingStatus 負責配對、確認、QueueToken 與配對狀態保存。
func financeSetMatchmakingStatus(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userIDs []string, status, matchID, cooldownUntil string) {
	nowTime := time.Now().UTC()
	now := nowTime.Format(time.RFC3339Nano)
	for _, userID := range userIDs {
		resolvedMatchID := matchID
		if resolvedMatchID == "" && (status == "matched" || status == "running") {
			if current, err := readFinanceMatchmaking(ctx, nk, userID); err == nil {
				resolvedMatchID = current.MatchID
			}
		} // 將配對的玩家的 matchmaking 狀態更新為指定的 status，並設定 matchID 與 cooldownUntil。
		if err := writeFinanceMatchmaking(ctx, nk, financeMatchmakingRecord{UserID: userID, Status: status, MatchID: resolvedMatchID, CooldownUntil: cooldownUntil, LeaseExpiresAt: financeMatchmakingLeaseExpiry(status, nowTime), UpdatedAt: now}); err != nil {
			logger.Error("Finance matchmaking status persistence failed user=%s status=%s: %v", userID, status, err)
		} // 將配對的玩家的 matchmaking 狀態更新為指定的 status，並設定 matchID 與 cooldownUntil。
	} // 將配對的玩家的 matchmaking 狀態更新為指定的 status，並設定 matchID 與 cooldownUntil。
}

// financeMatchmakingLeaseExpiry 負責配對、確認、QueueToken 與配對狀態保存。
func financeMatchmakingLeaseExpiry(status string, now time.Time) string {
	switch status {
	case "matching", "matched":
		return now.Add(financeMatchmakingLease).Format(time.RFC3339Nano)
	case "running":
		return now.Add(financeRunningLease).Format(time.RFC3339Nano)
	default:
		return ""
	}
} // requireUserID 會從 context 中取出 userID，若不存在則回傳 unauthenticated 錯誤。

// financeRecoverExpiredMatchmaking 負責配對、確認、QueueToken 與配對狀態保存。
func financeRecoverExpiredMatchmaking(record financeMatchmakingRecord, now time.Time) (financeMatchmakingRecord, bool) {
	if record.Status != "matching" && record.Status != "matched" && record.Status != "running" {
		return record, false
	}
	deadline, err := time.Parse(time.RFC3339Nano, record.LeaseExpiresAt)
	if err == nil && deadline.After(now) {
		return record, false
	}
	return financeMatchmakingRecord{UserID: record.UserID, Status: "idle", UpdatedAt: now.Format(time.RFC3339Nano)}, true
}

// rpcCreateFinanceMatchHandler 負責配對、確認、QueueToken 與配對狀態保存。
func rpcCreateFinanceMatchHandler(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, err := requireUserID(ctx) // 會從 context 中取出 userID，若不存在則回傳 unauthenticated 錯誤。
	if err != nil {
		return "", err
	} // 解析 payload，並建立 Nakama authoritative match，回傳 matchID 與 arenaID。
	if !environmentFlag("ALLOW_DIRECT_FINANCE_MATCH_CREATION") {
		return "", permissionDenied("Direct finance match creation is disabled. Use authoritative matchmaking.")
	}
	var input matchLobbyPayload
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	arenaID := fmt.Sprintf("finance-%d", time.Now().UTC().UnixNano()) // 建立 Nakama authoritative match，回傳 matchID 與 arenaID。
	matchID, err := nk.MatchCreate(ctx, financeAuthoritativeModule, map[string]interface{}{
		"arenaId": arenaID, "communityId": "", "kind": "group",
		"name": defaultString(strings.TrimSpace(input.Name), "BTC trading duel"), "hostUserId": userID, "gameType": gameTypeFinance,
	}) // 若建立 match 失敗則回傳錯誤。
	if err != nil {
		return "", err
	} // 將建立的 matchID 與 arenaID 回傳給前端，前端會使用這個 matchID 來加入 Nakama authoritative match。
	return mustJSON(map[string]interface{}{"matchId": matchID, "arenaId": arenaID}), nil
}

// rpcFinanceMatchmakingHandler 負責配對、確認、QueueToken 與配對狀態保存。
func rpcFinanceMatchmakingHandler(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	} // 解析 payload，並根據 action 來決定要開始配對、取消配對或查詢配對狀態。
	var input financeMatchmakingPayload
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	} // 根據 action 來決定要開始配對、取消配對或查詢配對狀態，並回傳配對狀態給前端。
	action := strings.ToLower(strings.TrimSpace(input.Action))
	record, err := readFinanceMatchmaking(ctx, nk, userID)
	if err != nil {
		return "", err
	} // 根據 action 來決定要開始配對、取消配對或查詢配對狀態，並回傳配對狀態給前端。
	now := time.Now().UTC()
	if recovered, changed := financeRecoverExpiredMatchmaking(record, now); changed {
		record = recovered
		if err := writeFinanceMatchmaking(ctx, nk, record); err != nil {
			return "", err
		}
	} // 根據 action 來決定要開始配對、取消配對或查詢配對狀態，並回傳配對狀態給前端。
	switch action {
	case "begin":
		if record.Status == "searching" || record.Status == "matching" || record.Status == "matched" || record.Status == "running" {
			return "", failedPrecondition("Player already has an active finance match.")
		} // 若玩家已經有一個 active finance match，則回傳 failedPrecondition 錯誤。
		if deadline, parseErr := time.Parse(time.RFC3339Nano, record.CooldownUntil); parseErr == nil && deadline.After(now) {
			return "", failedPrecondition(fmt.Sprintf("Matchmaking cooldown active until %s.", deadline.Format(time.RFC3339)))
		} // 若玩家的 matchmaking cooldown 尚未結束，則回傳 failedPrecondition 錯誤。
		record = financeMatchmakingRecord{UserID: userID, Status: "searching", QueueToken: fmt.Sprintf("%s:%d", userID, now.UnixNano()), SearchStartedAt: now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano)}
		if err := writeFinanceMatchmaking(ctx, nk, record); err != nil {
			return "", err
		} // 若玩家的 matchmaking cooldown 尚未結束，則回傳 failedPrecondition 錯誤。
		financeUpdateMetrics(ctx, nil, nk, func(metrics *financeSystemMetrics) {
			metrics.MatchmakingStarts++
		}) // 更新配對統計資料，包含配對開始次數。
	case "cancel":
		record = financeMatchmakingRecord{UserID: userID, Status: "cooldown", CooldownUntil: now.Add(time.Duration(financeCancelCooldownSeconds) * time.Second).Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano)}
		if err := writeFinanceMatchmaking(ctx, nk, record); err != nil {
			return "", err
		} // 更新配對統計資料，包含配對取消次數。
	case "status", "":
	default:
		return "", invalidArgument("action must be begin, cancel, or status.")
	} // 根據 action 來決定要開始配對、取消配對或查詢配對狀態，並回傳配對狀態給前端。
	return mustJSON(map[string]interface{}{"matchmaking": record}), nil
}

// readFinanceMatchmaking 負責配對、確認、QueueToken 與配對狀態保存。
func readFinanceMatchmaking(ctx context.Context, nk runtime.NakamaModule, userID string) (financeMatchmakingRecord, error) {
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceMatchmaking, Key: userID, UserID: ""}})
	if err != nil {
		return financeMatchmakingRecord{}, err
	} // 若沒有找到配對紀錄，則回傳一個預設的 matchmaking record，狀態為 idle。
	if len(objects) == 0 || objects[0] == nil {
		return financeMatchmakingRecord{UserID: userID, Status: "idle"}, nil
	} // 若沒有找到配對紀錄，則回傳一個預設的 matchmaking record，狀態為 idle。
	var record financeMatchmakingRecord
	if err := json.Unmarshal([]byte(objects[0].GetValue()), &record); err != nil {
		return financeMatchmakingRecord{}, err
	} // 若沒有找到配對紀錄，則回傳一個預設的 matchmaking record，狀態為 idle。
	return record, nil
}

// writeFinanceMatchmaking 負責配對、確認、QueueToken 與配對狀態保存。
func writeFinanceMatchmaking(ctx context.Context, nk runtime.NakamaModule, record financeMatchmakingRecord) error {
	var lastErr error
	for attempt := 0; attempt < financeStatsCASRetries; attempt++ {
		objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceMatchmaking, Key: record.UserID, UserID: ""}})
		if err != nil { // 若讀取配對紀錄失敗，則回傳錯誤。
			return err
		}
		version := "*"
		if len(objects) > 0 && objects[0] != nil { // 若沒有找到配對紀錄，則回傳一個預設的 matchmaking record，狀態為 idle。
			version = objects[0].GetVersion()
		}
		_, lastErr = nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceMatchmaking, Key: record.UserID, UserID: "", Value: mustJSON(record), Version: version, PermissionRead: 0, PermissionWrite: 0}})
		if lastErr == nil { // 若寫入成功，則回傳 nil。
			return nil
		}
	} // 若寫入失敗，則重試 financeStatsCASRetries 次，若仍然失敗，則回傳最後一次的錯誤。
	return lastErr
}
