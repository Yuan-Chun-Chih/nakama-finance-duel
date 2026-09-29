package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

// rpcListFinanceHistoryHandler 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func rpcListFinanceHistoryHandler(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	} // 解析 payload，取得 limit 與 cursor，若 limit 不在 1~50 範圍內則預設為 20。
	var input financeHistoryPayload
	if err := parsePayload(payload, &input); err != nil { // 解析 payload，若失敗則回傳錯誤。
		return "", err
	} // 取得 limit 與 cursor，若 limit 不在 1~50 範圍內則預設為 20。
	limit := input.Limit
	if limit <= 0 || limit > 50 {
		limit = 20
	} // 讀取玩家統計資料，若失敗則回傳錯誤。
	stats, err := readFinancePlayerStats(ctx, nk, userID)
	if err != nil {
		return "", err
	} // 讀取玩家歷史比賽資料，若失敗則回傳錯誤。
	historyObjects, nextCursor, err := nk.StorageList(ctx, "", userID, collectionFinanceHistory, limit, input.Cursor)
	if err != nil {
		return "", err
	} // 將歷史比賽資料反序列化為 financeGameRecord，若失敗則忽略該筆資料。
	games := make([]financeGameRecord, 0, len(historyObjects))
	for _, object := range historyObjects {
		var game financeGameRecord
		if object != nil && json.Unmarshal([]byte(object.GetValue()), &game) == nil && game.ArenaID != "" {
			games = append(games, game)
		} // 將歷史比賽資料依時間戳由大到小排序，方便前端顯示。
	} // 讀取玩家歷史訂單、成交與投資組合快照，若有指定 arenaID 則只讀取該 arena 的資料。
	orders := []financeOrder{}
	fills := []financeFillRecord{}
	portfolios := []financePortfolioSnapshotRecord{}
	if strings.TrimSpace(input.ArenaID) != "" {
		if err := ensureFinanceArenaPlayer(ctx, nk, input.ArenaID, userID); err != nil {
			return "", err
		} // 讀取指定 arena 的歷史訂單、成交與投資組合快照，若失敗則回傳錯誤。
		orders, err = listFinanceOrders(ctx, nk, input.ArenaID)
		if err != nil {
			return "", err
		} // 讀取指定 arena 的歷史成交與投資組合快照，若失敗則回傳錯誤。
		fills, err = listFinanceFills(ctx, nk, input.ArenaID)
		if err != nil {
			return "", err
		} // 讀取指定 arena 的歷史投資組合快照，若失敗則回傳錯誤。
		portfolios, err = listFinancePortfolioSnapshots(ctx, nk, input.ArenaID)
		if err != nil {
			return "", err
		} // 若指定 arena 尚未結束，則只回傳玩家自己的訂單、成交與投資組合快照。
		status, err := readFinanceArenaStatus(ctx, nk, input.ArenaID)
		if err != nil {
			return "", err
		} // 若指定 arena 尚未結束，則只回傳玩家自己的訂單、成交與投資組合快照。
		if status != "finished" {
			orders = filterFinanceOrdersByUser(orders, userID)
			fills = filterFinanceFillsByUser(fills, userID)
			portfolios = filterFinancePortfolioSnapshotsByUser(portfolios, userID)
		}
	}
	return mustJSON(map[string]interface{}{
		"stats": stats, "games": games, "cursor": nextCursor,
		"orders": orders, "fills": fills, "portfolioSnapshots": portfolios,
	}), nil // 回傳成功訊息，包含玩家統計、歷史比賽、歷史訂單、歷史成交與歷史投資組合快照。
}

// rpcGetFinanceMetricsHandler 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func rpcGetFinanceMetricsHandler(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, _ string) (string, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return "", err
	}
	if !financeMetricsAdminAllowed(userID) {
		return "", permissionDenied("Finance metrics admin privileges required.")
	}
	metrics, err := readFinanceMetrics(ctx, nk)
	if err != nil {
		return "", err
	}
	return mustJSON(map[string]interface{}{"metrics": metrics}), nil
}

// financeMetricsAdminAllowed 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func financeMetricsAdminAllowed(userID string) bool {
	for _, candidate := range strings.Split(os.Getenv("FINANCE_METRICS_ADMIN_USER_IDS"), ",") {
		if strings.TrimSpace(candidate) == userID {
			return true
		}
	}
	return false
}

// readFinanceArenaStatus 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func readFinanceArenaStatus(ctx context.Context, nk runtime.NakamaModule, arenaID string) (string, error) {
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceSnapshots, Key: arenaID, UserID: ""}})
	if err != nil || len(objects) == 0 || objects[0] == nil {
		return "", err
	}
	var snapshot struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal([]byte(objects[0].GetValue()), &snapshot); err != nil {
		return "", err
	}
	return snapshot.Status, nil
}

// filterFinanceOrdersByUser 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func filterFinanceOrdersByUser(records []financeOrder, userID string) []financeOrder {
	result := make([]financeOrder, 0, len(records))
	for _, record := range records {
		if record.UserID == userID {
			result = append(result, record)
		}
	}
	return result
}

// filterFinanceFillsByUser 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func filterFinanceFillsByUser(records []financeFillRecord, userID string) []financeFillRecord {
	result := make([]financeFillRecord, 0, len(records))
	for _, record := range records {
		if record.UserID == userID {
			result = append(result, record)
		}
	}
	return result
}

// filterFinancePortfolioSnapshotsByUser 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func filterFinancePortfolioSnapshotsByUser(records []financePortfolioSnapshotRecord, userID string) []financePortfolioSnapshotRecord {
	result := make([]financePortfolioSnapshotRecord, 0, len(records))
	for _, record := range records {
		if record.Portfolio.UserID == userID {
			result = append(result, record)
		}
	}
	return result
}

// ensureFinanceArenaPlayer 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func ensureFinanceArenaPlayer(ctx context.Context, nk runtime.NakamaModule, arenaID, userID string) error {
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceSnapshots, Key: arenaID, UserID: ""}})
	if err != nil {
		return err
	}
	if len(objects) == 0 || objects[0] == nil {
		return notFound("Finance match snapshot not found.")
	}
	var snapshot struct {
		Players []string `json:"players"`
	}
	if err := json.Unmarshal([]byte(objects[0].GetValue()), &snapshot); err != nil {
		return err
	}
	for _, playerID := range snapshot.Players {
		if playerID == userID {
			return nil
		}
	}
	return permissionDenied("Only match participants can read finance history.")
}

// financeAppendArenaIndex 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func financeAppendArenaIndex(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, arenaID string, orderIDs, fillIDs, snapshotKeys []string) {
	if arenaID == "" || (len(orderIDs) == 0 && len(fillIDs) == 0 && len(snapshotKeys) == 0) {
		return
	}
	for attempt := 0; attempt < financeStatsCASRetries; attempt++ {
		objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceArenaIndex, Key: arenaID, UserID: ""}})
		if err != nil {
			logger.Warn("Finance arena index read failed arena=%s: %v", arenaID, err)
			return
		}
		index := financeArenaIndexRecord{ArenaID: arenaID}
		version := "*"
		if len(objects) > 0 && objects[0] != nil {
			version = objects[0].GetVersion()
			if err := json.Unmarshal([]byte(objects[0].GetValue()), &index); err != nil {
				logger.Warn("Finance arena index decode failed arena=%s: %v", arenaID, err)
				return
			}
		}
		index.ArenaID = arenaID
		index.OrderIDs = appendUniqueStrings(index.OrderIDs, orderIDs)
		index.FillIDs = appendUniqueStrings(index.FillIDs, fillIDs)
		index.PortfolioSnapshotKeys = appendUniqueStrings(index.PortfolioSnapshotKeys, snapshotKeys)
		index.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
			Collection: collectionFinanceArenaIndex, Key: arenaID, UserID: "", Value: mustJSON(index), Version: version, PermissionRead: 0, PermissionWrite: 0,
		}}); err == nil {
			return
		} else if attempt+1 < financeStatsCASRetries {
			time.Sleep(time.Duration(1<<attempt) * 5 * time.Millisecond)
		}
	}
	logger.Error("Finance arena index write exhausted CAS retries arena=%s", arenaID)
}

// appendUniqueStrings 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func appendUniqueStrings(existing, additions []string) []string {
	seen := make(map[string]struct{}, len(existing)+len(additions))
	for _, value := range existing {
		seen[value] = struct{}{}
	}
	for _, value := range additions {
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		existing = append(existing, value)
	}
	return existing
}

// readFinanceArenaIndex 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func readFinanceArenaIndex(ctx context.Context, nk runtime.NakamaModule, arenaID string) (financeArenaIndexRecord, error) {
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceArenaIndex, Key: arenaID, UserID: ""}})
	if err != nil {
		return financeArenaIndexRecord{}, err
	}
	if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" {
		return financeBackfillArenaIndex(ctx, nk, arenaID)
	}
	var index financeArenaIndexRecord
	if err := json.Unmarshal([]byte(objects[0].GetValue()), &index); err != nil {
		return financeArenaIndexRecord{}, err
	}
	return index, nil
}

// financeBackfillArenaIndex 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func financeBackfillArenaIndex(ctx context.Context, nk runtime.NakamaModule, arenaID string) (financeArenaIndexRecord, error) {
	orderIDs, err := listLegacyArenaKeys(ctx, nk, collectionFinanceOrders, arenaID)
	if err != nil {
		return financeArenaIndexRecord{}, err
	}
	fillIDs, err := listLegacyArenaKeys(ctx, nk, collectionFinanceFills, arenaID)
	if err != nil {
		return financeArenaIndexRecord{}, err
	}
	snapshotKeys, err := listLegacyArenaKeys(ctx, nk, collectionFinancePortfolios, arenaID)
	if err != nil {
		return financeArenaIndexRecord{}, err
	}
	index := financeArenaIndexRecord{ArenaID: arenaID, OrderIDs: orderIDs, FillIDs: fillIDs, PortfolioSnapshotKeys: snapshotKeys, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if len(orderIDs) == 0 && len(fillIDs) == 0 && len(snapshotKeys) == 0 {
		return index, nil
	}
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection: collectionFinanceArenaIndex, Key: arenaID, UserID: "", Value: mustJSON(index), Version: "*", PermissionRead: 0, PermissionWrite: 0,
	}}); err != nil {
		objects, readErr := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceArenaIndex, Key: arenaID, UserID: ""}})
		if readErr != nil || len(objects) == 0 || objects[0] == nil || json.Unmarshal([]byte(objects[0].GetValue()), &index) != nil {
			return financeArenaIndexRecord{}, err
		}
	}
	return index, nil
}

// listLegacyArenaKeys 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func listLegacyArenaKeys(ctx context.Context, nk runtime.NakamaModule, collection, arenaID string) ([]string, error) {
	keys := []string{}
	cursor := ""
	for {
		objects, nextCursor, err := nk.StorageList(ctx, "", "", collection, financeCleanupBatchSize, cursor)
		if err != nil {
			return nil, err
		}
		for _, object := range objects {
			if object != nil && strings.HasPrefix(object.GetKey(), arenaID+":") {
				keys = append(keys, object.GetKey())
			}
		}
		if nextCursor == "" {
			return keys, nil
		}
		cursor = nextCursor
	}
}

// readFinanceMaintenanceCursor 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func readFinanceMaintenanceCursor(ctx context.Context, nk runtime.NakamaModule, key string) (financeMaintenanceCursor, string, error) {
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceMaintenance, Key: key, UserID: ""}})
	if err != nil {
		return financeMaintenanceCursor{}, "", err
	}
	if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" {
		return financeMaintenanceCursor{}, "*", nil
	}
	var cursor financeMaintenanceCursor
	if err := json.Unmarshal([]byte(objects[0].GetValue()), &cursor); err != nil {
		return financeMaintenanceCursor{}, "", err
	}
	return cursor, objects[0].GetVersion(), nil
}

// listFinanceOrders 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func listFinanceOrders(ctx context.Context, nk runtime.NakamaModule, arenaID string) ([]financeOrder, error) {
	index, err := readFinanceArenaIndex(ctx, nk, arenaID)
	if err != nil {
		return nil, err
	}
	if len(index.OrderIDs) == 0 {
		return []financeOrder{}, nil
	}
	reads := make([]*runtime.StorageRead, 0, len(index.OrderIDs))
	for _, orderID := range index.OrderIDs {
		reads = append(reads, &runtime.StorageRead{Collection: collectionFinanceOrders, Key: orderID, UserID: ""})
	}
	objects, err := nk.StorageRead(ctx, reads)
	if err != nil {
		return nil, err
	}
	orders := []financeOrder{}
	for _, object := range objects { // 遍歷所有讀取到的 storage 物件，將其反序列化為 financeOrder，若成功則加入 orders 列表。
		if object == nil || object.GetValue() == "" {
			continue
		}
		var wrapper struct { // 定義一個匿名結構體，用於反序列化 storage 物件的值，該值包含一個 Order 欄位。
			Order financeOrder `json:"order"`
		}
		if json.Unmarshal([]byte(object.GetValue()), &wrapper) == nil && wrapper.Order.ID != "" { // 若反序列化成功且 Order 的 ID 不為空，則將該 Order 加入 orders 列表。
			orders = append(orders, wrapper.Order)
		}
	}
	sort.Slice(orders, func(i, j int) bool { return orders[i].CreatedAt > orders[j].CreatedAt }) // 將 orders 列表按照 CreatedAt 欄位由大到小排序，方便前端顯示。
	return orders, nil
}

// listFinanceFills 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func listFinanceFills(ctx context.Context, nk runtime.NakamaModule, arenaID string) ([]financeFillRecord, error) {
	index, err := readFinanceArenaIndex(ctx, nk, arenaID)
	if err != nil { // 讀取指定 arena 的索引，若失敗則回傳錯誤。
		return nil, err
	}
	if len(index.FillIDs) == 0 {
		return []financeFillRecord{}, nil
	}
	reads := make([]*runtime.StorageRead, 0, len(index.FillIDs))
	for _, fillID := range index.FillIDs { // 遍歷索引中的 FillIDs，為每個 fillID 建立一個 StorageRead 物件，並加入 reads 列表。
		reads = append(reads, &runtime.StorageRead{Collection: collectionFinanceFills, Key: fillID, UserID: ""})
	}
	objects, err := nk.StorageRead(ctx, reads)
	if err != nil { // 讀取指定 arena 的成交紀錄，若失敗則回傳錯誤。
		return nil, err
	}
	fills := []financeFillRecord{}
	for _, object := range objects { // 遍歷所有讀取到的 storage 物件，將其反序列化為 financeFillRecord，若成功則加入 fills 列表。
		if object == nil || object.GetValue() == "" {
			continue
		}
		var fill financeFillRecord
		if json.Unmarshal([]byte(object.GetValue()), &fill) == nil && fill.ID != "" {
			fills = append(fills, fill)
		}
	}
	sort.Slice(fills, func(i, j int) bool { return fills[i].ExecutedAt > fills[j].ExecutedAt })
	return fills, nil
}

// listFinancePortfolioSnapshots 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func listFinancePortfolioSnapshots(ctx context.Context, nk runtime.NakamaModule, arenaID string) ([]financePortfolioSnapshotRecord, error) {
	index, err := readFinanceArenaIndex(ctx, nk, arenaID)
	if err != nil { // 讀取指定 arena 的索引，若失敗則回傳錯誤。
		return nil, err
	}
	if len(index.PortfolioSnapshotKeys) == 0 { // 若索引中沒有任何投資組合快照的 key，則回傳空列表。
		return []financePortfolioSnapshotRecord{}, nil
	}
	reads := make([]*runtime.StorageRead, 0, len(index.PortfolioSnapshotKeys))
	for _, snapshotKey := range index.PortfolioSnapshotKeys {
		reads = append(reads, &runtime.StorageRead{Collection: collectionFinancePortfolios, Key: snapshotKey, UserID: ""})
	}
	objects, err := nk.StorageRead(ctx, reads)
	if err != nil { // 讀取指定 arena 的投資組合快照，若失敗則回傳錯誤。
		return nil, err
	}
	records := []financePortfolioSnapshotRecord{}
	for _, object := range objects {
		if object == nil || object.GetValue() == "" { // 遍歷所有讀取到的 storage 物件，將其反序列化為 financePortfolioSnapshotRecord，若成功則加入 records 列表。
			continue
		}
		var record financePortfolioSnapshotRecord
		if json.Unmarshal([]byte(object.GetValue()), &record) == nil && record.ArenaID != "" { // 若反序列化成功且 ArenaID 不為空，則將該 record 加入 records 列表。
			records = append(records, record)
		}
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].Round == records[j].Round {
			return records[i].Portfolio.UserID < records[j].Portfolio.UserID
		}
		return records[i].Round < records[j].Round
	})
	return records, nil
}

// readFinanceBTCPrice 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func readFinanceBTCPrice(ctx context.Context, nk runtime.NakamaModule) (matchPriceRecord, bool, error) {
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionMatchPriceFeed, Key: "BTC/USDT", UserID: ""}})
	if err != nil {
		return matchPriceRecord{}, true, err
	}
	if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" { // 若 storage 中沒有 BTC/USDT 的行情紀錄，則回傳空的 matchPriceRecord，並標記為 stale。
		return matchPriceRecord{}, true, nil
	}
	var record matchPriceRecord
	if err := json.Unmarshal([]byte(objects[0].GetValue()), &record); err != nil { // 若反序列化失敗，則回傳空的 matchPriceRecord，並標記為 stale。
		return matchPriceRecord{}, true, err
	}
	return record, financePriceRecordIsStale(record), nil
}

// financePriceRecordIsStale 除了時間外，也拒絕所有 bootstrap 測試行情。
func financePriceRecordIsStale(record matchPriceRecord) bool {
	if strings.EqualFold(strings.TrimSpace(record.Source), "bootstrap") { // 若行情來源為 bootstrap，則視為 stale，避免使用測試行情。
		return true
	}
	return financePriceIsStale(record.UpdatedAt)
}

// financePriceIsStale 負責歷史查詢、arena 索引、行情讀取與管理員 metrics。
func financePriceIsStale(updatedAt string) bool {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(updatedAt)) // 將 updatedAt 字串解析為 time.Time，若解析失敗則視為 stale。
	if err != nil {
		return true
	}
	return time.Since(parsed) > time.Duration(financePriceMaxAgeSeconds)*time.Second // 若 updatedAt 超過 financePriceMaxAgeSeconds 秒，則視為 stale。
}
