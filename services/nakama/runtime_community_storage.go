package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
)

// 本檔案負責 guild roster、storage projection、join request 與 audit log。
// listGuildJoinRequestsForGuild 分頁讀取並過濾指定 guild 的加入申請。
func listGuildJoinRequestsForGuild(ctx context.Context, nk runtime.NakamaModule, guildID string) ([]guildJoinRequestRecord, error) {
	// join request 是 global storage object，key 以 guildID: 開頭。
	// 因此要 list collection 後用 prefix 過濾出指定 guild。
	requests := make([]guildJoinRequestRecord, 0)
	prefix := guildID + ":"
	cursor := ""
	for len(requests) < guildStorageScanMaxRecords {
		objects, nextCursor, err := nk.StorageList(ctx, "", "", collectionGuildRequests, guildStorageScanPageSize, cursor)
		if err != nil {
			return nil, err
		}
		for _, object := range objects {
			if object == nil || !strings.HasPrefix(object.GetKey(), prefix) {
				continue
			}
			var request guildJoinRequestRecord
			if json.Unmarshal([]byte(object.GetValue()), &request) == nil {
				requests = append(requests, request)
			}
		}
		if nextCursor == "" {
			break
		}
		cursor = nextCursor
	}
	return requests, nil
}

// listGuildAuditLog 分頁讀取 audit 並依時間倒序回傳。
func listGuildAuditLog(ctx context.Context, nk runtime.NakamaModule, guildID string, limit int) ([]guildAuditRecord, error) {
	// audit log 同樣是 global storage object，key 以 guildID:timestamp:id 組成。
	// 讀出後依 CreatedAt 倒序，讓 detail page 先顯示最新事件。
	records := make([]guildAuditRecord, 0)
	prefix := guildID + ":"
	cursor := ""
	for len(records) < guildStorageScanMaxRecords {
		objects, nextCursor, err := nk.StorageList(ctx, "", "", collectionGuildAudit, guildStorageScanPageSize, cursor)
		if err != nil {
			return nil, err
		}
		for _, object := range objects {
			if object == nil || !strings.HasPrefix(object.GetKey(), prefix) {
				continue
			}
			var record guildAuditRecord
			if json.Unmarshal([]byte(object.GetValue()), &record) == nil {
				records = append(records, record)
			}
		}
		if nextCursor == "" {
			break
		}
		cursor = nextCursor
	}
	sort.Slice(records, func(i, j int) bool {
		return records[i].CreatedAt > records[j].CreatedAt
	})
	if limit > 0 && len(records) > limit {
		return records[:limit], nil
	}
	return records, nil
}

// listGuildMembers 讀取 Nakama guild roster。
func listGuildMembers(ctx context.Context, nk runtime.NakamaModule, guildID string) ([]*api.GroupUserList_GroupUser, error) {
	// 成員真相來源是 Nakama group roster，不是 guild_membership storage。
	users, _, err := nk.GroupUsersList(ctx, guildID, maxGuildMembers, nil, "")
	return users, err
}

// ensureUserHasNoGuild 確認使用者尚未加入其他 guild。
func ensureUserHasNoGuild(ctx context.Context, nk runtime.NakamaModule, userID string) error {
	// single-guild-per-user 的檢查點。
	// create/request/invite/approve 都應該呼叫，避免同一玩家加入多個 guild。
	membership, err := readGuildMembership(ctx, nk, userID)
	if err != nil {
		return err
	}
	if membership != nil && membership.GuildID != "" {
		groups, groupErr := nk.GroupsGetId(ctx, []string{membership.GuildID})
		if groupErr != nil {
			return groupErr
		}
		if len(groups) == 0 {
			return deleteGuildMembership(ctx, nk, userID)
		}
		members, rosterErr := listGuildMembers(ctx, nk, membership.GuildID)
		if rosterErr == nil && findGroupUserByID(members, userID) == nil {
			return deleteGuildMembership(ctx, nk, userID)
		}
		if rosterErr != nil {
			return rosterErr
		}
		return failedPrecondition("User already belongs to a guild.")
	}
	return nil
}

// reconcileGuildMembershipProjections 依 authoritative roster 批次修補現役成員的 membership 與角色。
func reconcileGuildMembershipProjections(ctx context.Context, nk runtime.NakamaModule, guildID string, members []*api.GroupUserList_GroupUser) error {
	writes := make([]*runtime.StorageWrite, 0, len(members))
	for _, member := range members {
		if member == nil || member.GetUser() == nil || member.GetUser().GetId() == "" || groupUserState(member) == 3 {
			continue
		}
		writes = append(writes, &runtime.StorageWrite{
			Collection: collectionGuildMembership, Key: guildMembershipKey, UserID: member.GetUser().GetId(),
			Value:          mustJSON(guildMembershipStorage{GuildID: guildID, Role: mapGuildStateToRole(groupUserState(member))}),
			PermissionRead: 0, PermissionWrite: 0,
		})
	}
	if len(writes) == 0 {
		return nil
	}
	_, err := nk.StorageWrite(ctx, writes)
	return err
}

// ensureUserCanManageGuild 驗證使用者具備 owner 或 admin 權限。
func ensureUserCanManageGuild(ctx context.Context, nk runtime.NakamaModule, guildID, userID string) error {
	// 管理權限：owner(state=0) 或 admin(state=1)。
	// 使用 roster state 判斷，而不是相信前端傳來的 role。
	users, err := listGuildMembers(ctx, nk, guildID)
	if err != nil {
		return err
	}
	mine := findGroupUserByID(users, userID)
	if mine == nil || !guildStateCanManage(groupUserState(mine)) {
		return permissionDenied("Guild admin privileges required.")
	}
	return nil
}

// ensureUserOwnsGuild 驗證使用者是 guild owner。
func ensureUserOwnsGuild(ctx context.Context, nk runtime.NakamaModule, guildID, userID string) error {
	// owner-only 權限檢查。
	// promote/demote/transfer/disband 這些高風險操作都要走這裡。
	users, err := listGuildMembers(ctx, nk, guildID)
	if err != nil {
		return err
	}
	mine := findGroupUserByID(users, userID)
	if mine == nil || !guildStateIsOwner(groupUserState(mine)) {
		return permissionDenied("Guild owner privileges required.")
	}
	return nil
}

// buildGuildOperationKey 建立可由 client operation ID 或舊版參數重建的冪等 key。
func buildGuildOperationKey(action, guildID, actorUserID, targetUserID, operationID string) string {
	identity := strings.TrimSpace(operationID)
	if identity == "" {
		identity = fmt.Sprintf("%s:%s", actorUserID, targetUserID)
	}
	return fmt.Sprintf("%s:%s:%s", guildID, action, identity)
}

// readGuildOperation 讀取治理 operation 與 CAS version；不存在時回傳 nil。
func readGuildOperation(ctx context.Context, nk runtime.NakamaModule, key string) (*guildOperationRecord, string, error) {
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionGuildOperations, Key: key, UserID: ""}})
	if err != nil {
		return nil, "", err
	}
	if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" {
		return nil, "", nil
	}
	var record guildOperationRecord
	if err := json.Unmarshal([]byte(objects[0].GetValue()), &record); err != nil {
		return nil, "", err
	}
	return &record, objects[0].GetVersion(), nil
}

// writeGuildOperation 以 create-only 或 CAS 更新治理 operation。
func writeGuildOperation(ctx context.Context, nk runtime.NakamaModule, record *guildOperationRecord, version string) (string, error) {
	record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if record.CreatedAt == "" {
		record.CreatedAt = record.UpdatedAt
	}
	if version == "" {
		version = "*"
	}
	writes, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection: collectionGuildOperations, Key: record.ID, UserID: "", Value: mustJSON(record), Version: version,
		PermissionRead: 0, PermissionWrite: 0,
	}})
	if err != nil {
		return "", err
	}
	if len(writes) == 0 || writes[0] == nil {
		return "", failedPrecondition("Guild operation persistence returned no acknowledgement.")
	}
	return writes[0].GetVersion(), nil
}

// writeGuildMembership 保存 user-scoped guild membership。
func writeGuildMembership(ctx context.Context, nk runtime.NakamaModule, userID string, membership guildMembershipStorage) error {
	// guild_membership 是 user-scoped storage，UserID 必須是玩家 userID。
	// 這筆資料讓前端快速知道「目前使用者屬於哪個 guild」。
	_, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{
		{
			Collection:      collectionGuildMembership,
			Key:             guildMembershipKey,
			UserID:          userID,
			Value:           mustJSON(membership),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
	})
	return err
}

// writeGuildConfig 保存 guild 的設定 projection。
func writeGuildConfig(ctx context.Context, nk runtime.NakamaModule, guildID string, config *guildConfigStorage) error {
	// guild_config 是 guild-scoped 但不是 user-scoped，因此用 global object。
	// key 包含 guildID，UserID 固定空字串。
	_, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{
		{
			Collection: collectionGuildConfig,
			// guild config 不屬於任何 user，必須存成 global object。
			// guild id 若寫進 UserID，會撞到 storage.user_id 的 users FK。
			Key:             buildGuildConfigKey(guildID),
			UserID:          "",
			Value:           mustJSON(config),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
	})
	return err
}

// deleteGuildMembership 移除 user 的 guild membership。
func deleteGuildMembership(ctx context.Context, nk runtime.NakamaModule, userID string) error {
	// leave/kick/disband 都必須刪 membership。
	// 如果漏刪，前端 dashboard 會把使用者誤判為仍在 guild。
	return nk.StorageDelete(ctx, []*runtime.StorageDelete{
		{
			Collection: collectionGuildMembership,
			Key:        guildMembershipKey,
			UserID:     userID,
		},
	})
}

// readGuildMembership 讀取 user 目前的 guild membership。
func readGuildMembership(ctx context.Context, nk runtime.NakamaModule, userID string) (*guildMembershipStorage, error) {
	// 沒有 storage object 時回 nil，不視為錯誤。
	// 這代表 user 目前沒有 guild membership。
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{
		{
			Collection: collectionGuildMembership,
			Key:        guildMembershipKey,
			UserID:     userID,
		},
	})
	if err != nil {
		return nil, err
	}
	if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" {
		return nil, nil
	}
	var membership guildMembershipStorage
	if err := json.Unmarshal([]byte(objects[0].GetValue()), &membership); err != nil {
		return nil, err
	}
	return &membership, nil
}

// readGuildConfig 讀取 guild 設定，缺少時回傳預設設定。
func readGuildConfig(ctx context.Context, nk runtime.NakamaModule, guildID string) (*guildConfigStorage, error) {
	// 讀 guild 設定。舊資料可能沒有 config，因此缺資料時回預設值，讓 detail page 不會壞掉。
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{
		{
			Collection: collectionGuildConfig,
			Key:        buildGuildConfigKey(guildID),
			UserID:     "",
		},
	})
	if err != nil {
		return nil, err
	}
	if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" {
		// 舊資料或尚未初始化的 guild 也要能正常開頁，因此回傳預設設定。
		return defaultGuildConfig(guildID, "", ""), nil
	}
	var config guildConfigStorage
	if err := json.Unmarshal([]byte(objects[0].GetValue()), &config); err != nil {
		return nil, err
	}
	if config.JoinPolicy == "" {
		config.JoinPolicy = "request"
	}
	return &config, nil
}

// buildGuildConfigKey 建立 guild 設定的 storage key。
func buildGuildConfigKey(guildID string) string {
	// config key 固定為 `<guildId>:config`，避免不同 guild 的 global object 撞 key。
	return fmt.Sprintf("%s:%s", guildID, guildConfigKey)
}

// getGuildJoinRequestOrThrow 讀取指定申請，不存在時回傳 NOT_FOUND。
func getGuildJoinRequestOrThrow(ctx context.Context, nk runtime.NakamaModule, guildID, userID string) (*guildJoinRequestRecord, error) {
	// approve/reject 前必須確認 request 存在。
	// 若不存在，代表可能已被其他 admin 處理或前端狀態過期。
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{
		{
			Collection: collectionGuildRequests,
			Key:        buildGuildJoinRequestKey(guildID, userID),
			UserID:     "",
		},
	})
	if err != nil {
		return nil, err
	}
	if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" {
		return nil, notFound("Guild join request not found.")
	}
	var request guildJoinRequestRecord
	if err := json.Unmarshal([]byte(objects[0].GetValue()), &request); err != nil {
		return nil, err
	}
	return &request, nil
}

// deleteGuildJoinRequestIfExists 只有申請存在時才執行刪除。
func deleteGuildJoinRequestIfExists(ctx context.Context, nk runtime.NakamaModule, guildID, userID string) error {
	// invite 成功後，如果 target 先前自己申請過，要清掉 pending request。
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{
		{
			Collection: collectionGuildRequests,
			Key:        buildGuildJoinRequestKey(guildID, userID),
			UserID:     "",
		},
	})
	if err != nil {
		return err
	}
	if len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" {
		return nil
	}
	return deleteGuildJoinRequest(ctx, nk, guildID, userID)
}

// deleteGuildJoinRequest 刪除指定 guild join request。
func deleteGuildJoinRequest(ctx context.Context, nk runtime.NakamaModule, guildID, userID string) error {
	// 刪除 pending request。approve / reject / invite 都可能會用到。
	return nk.StorageDelete(ctx, []*runtime.StorageDelete{
		{
			Collection: collectionGuildRequests,
			Key:        buildGuildJoinRequestKey(guildID, userID),
			UserID:     "",
		},
	})
}

// getGuildOrThrow 讀取 Nakama group，找不到時回傳 NOT_FOUND。
func getGuildOrThrow(ctx context.Context, nk runtime.NakamaModule, guildID string) (*api.Group, error) {
	// 取得指定 guild，並驗證它真的是 lang_tag = guild。
	// 這可以阻止一般 group 被拿來呼叫 guild-only RPC。
	groups, err := nk.GroupsGetId(ctx, []string{guildID})
	if err != nil {
		return nil, err
	}
	if len(groups) == 0 {
		return nil, notFound("Guild does not exist.")
	}
	guild := groups[0]
	if guild.GetLangTag() != "guild" {
		return nil, invalidArgument("Target group is not a guild.")
	}
	return guild, nil
}

// buildGuildJoinRequestKey 建立 guild 與 user 組合而成的申請 key。
func buildGuildJoinRequestKey(guildID, userID string) string {
	// request key 用 guildID:userID，確保同一 user 對同一 guild 只有一筆 request。
	return fmt.Sprintf("%s:%s", guildID, userID)
}

// buildGuildAuditKey 建立包含時間與 actor 的 audit log key。
func buildGuildAuditKey(guildID, action, actorID string, now time.Time) string {
	// audit key 包含時間與 action，讓 storage list 後可排序，也避免事件 key 撞名。
	return fmt.Sprintf("%s:%s:%s:%s", guildID, now.UTC().Format(time.RFC3339Nano), action, defaultString(actorID, "system"))
}

// defaultGuildConfig 建立 guild 初始設定。
func defaultGuildConfig(guildID, updatedBy, updatedByName string) *guildConfigStorage {
	// 新 guild 或舊 guild 沒有 config 時的預設設定。
	return &guildConfigStorage{
		GuildID:       guildID,
		Announcement:  "",
		JoinPolicy:    "request",
		UpdatedAt:     time.Now().UTC().Format(time.RFC3339),
		UpdatedBy:     updatedBy,
		UpdatedByName: updatedByName,
	}
}

// newGuildAudit 建立一筆不可變的治理 audit record。
func newGuildAudit(guildID, action, actorID, actorName, targetUserID, targetName, summary string) guildAuditRecord {
	// 建立 audit record 的唯一入口，確保時間格式與 ID 規則一致。
	now := time.Now().UTC()
	return guildAuditRecord{
		ID:           buildGuildAuditKey(guildID, action, actorID, now),
		GuildID:      guildID,
		Action:       action,
		ActorID:      actorID,
		ActorName:    actorName,
		TargetUserID: targetUserID,
		TargetName:   targetName,
		Summary:      summary,
		CreatedAt:    now.Format(time.RFC3339),
	}
}

// appendGuildAudit 將治理事件以 append-only 方式寫入 storage。
func appendGuildAudit(ctx context.Context, nk runtime.NakamaModule, record guildAuditRecord) error {
	// 寫入治理事件。這是 guild detail audit log 的資料來源。
	// UserID 使用空字串，因為 audit 屬於 guild global object，不屬於單一 user。
	_, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{
		{
			Collection:      collectionGuildAudit,
			Key:             record.ID,
			UserID:          "",
			Value:           mustJSON(record),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
	})
	return err
}

// mapGuildStateToRole 將 Nakama roster state 轉為應用程式角色。
func mapGuildStateToRole(state int32) string {
	// Nakama group state number 對前端不友善，統一轉成語意化字串。
	switch state {
	case 0:
		return "owner"
	case 1:
		return "admin"
	case 3:
		return "requested"
	default:
		return "member"
	}
}
