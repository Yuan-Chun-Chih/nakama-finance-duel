package main

import (
	"context"
	"encoding/json"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

type financeMaintenanceLeaseRecord struct { //常數定義，例如排行榜名稱、RPC 名稱、OpCode、資料庫集合名稱、比賽設定等。
	LeaseUntil string `json:"leaseUntil"`
	UpdatedAt  string `json:"updatedAt"`
}

// 負責維護財務相關的排行榜投影，確保在多節點或多場對局中只有一個節點在執行維護工作。
// financeRunMaintenanceTask 先取得全域 storage lease，再執行單一批次維護工作。
func financeRunMaintenanceTask(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, key string, leaseDuration time.Duration, task func()) {
	acquired, err := financeTryAcquireMaintenanceLease(ctx, nk, key, leaseDuration, time.Now().UTC())
	if err != nil {
		logger.Warn("Finance maintenance lease failed task=%s: %v", key, err)
		return
	}
	if acquired { //如果成功取得 lease，則執行維護工作。
		task()
	}
}

// financeTryAcquireMaintenanceLease 使用 Storage version CAS，確保多場對局或多節點同時間只有一個清理者。
func financeTryAcquireMaintenanceLease(ctx context.Context, nk runtime.NakamaModule, key string, duration time.Duration, now time.Time) (bool, error) {
	storageKey := "lease:" + key
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionFinanceMaintenance, Key: storageKey, UserID: ""}})
	if err != nil { //讀取指定集合和鍵的存儲對象，檢查是否已經有其他節點或對局正在執行維護工作。
		return false, err
	}
	version := "*"
	if len(objects) > 0 && objects[0] != nil && objects[0].GetValue() != "" { //如果讀取到的對象不為空，則解析其值為結構體，檢查 lease 是否仍然有效。
		version = objects[0].GetVersion()
		var record financeMaintenanceLeaseRecord
		if json.Unmarshal([]byte(objects[0].GetValue()), &record) == nil {
			if leaseUntil, parseErr := time.Parse(time.RFC3339Nano, record.LeaseUntil); parseErr == nil && leaseUntil.After(now) {
				return false, nil
			}
		}
	}
	record := financeMaintenanceLeaseRecord{
		LeaseUntil: now.Add(duration).Format(time.RFC3339Nano),
		UpdatedAt:  now.Format(time.RFC3339Nano),
	}
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection: collectionFinanceMaintenance, Key: storageKey, UserID: "", Value: mustJSON(record),
		Version: version, PermissionRead: 0, PermissionWrite: 0,
	}}); err != nil {
		return false, err
	}
	return true, nil
}

// financeRetryPendingLeaderboardProjections 以小批次重試尚未完成的排行榜 outbox records。
func financeRetryPendingLeaderboardProjections(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule) {
	objects, _, err := nk.StorageList(ctx, "", "", collectionFinanceLeaderboardProjection, 20, "")
	if err != nil {
		logger.Warn("Finance leaderboard projection list failed: %v", err)
		return
	}
	for _, object := range objects {
		if object == nil || object.GetValue() == "" { //用戶端的 storageList 取得排行榜投影的 outbox records，檢查是否有尚未完成的投影，若有則重試。
			continue
		}
		var projection financeLeaderboardProjectionRecord
		if json.Unmarshal([]byte(object.GetValue()), &projection) != nil || projection.ArenaID == "" {
			logger.Warn("Finance leaderboard projection is invalid key=%s", object.GetKey())
			continue
		}
		if err := projectFinanceLeaderboardRecord(ctx, nk, projection); err != nil {
			logger.Warn("Finance leaderboard projection retry failed arena=%s: %v", projection.ArenaID, err)
		}
	}
}
