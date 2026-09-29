package main

import (
	"context"
	"database/sql"
	"strings"

	"github.com/heroiclabs/nakama-common/runtime"
)

// InitModule 初始化 Nakama runtime，註冊 authoritative match、RPC 與 leaderboard。
func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
	// Go runtime 是目前 authoritative backend 的入口。
	// 這裡集中建立排行榜與註冊所有前端會打到的 RPC。
	// 如果 InitModule 回傳錯誤，Nakama container 會啟動失敗，所以這裡要 fail fast。
	if err := registerLeaderboards(ctx, nk); err != nil {
		logger.Error("registerLeaderboards failed: %v", err)
		return err
	}
	if err := seedDefaultMatchPriceFeed(ctx, nk); err != nil {
		logger.Error("seedDefaultMatchPriceFeed failed: %v", err)
		return err
	}
	if err := initializer.RegisterMatch(financeAuthoritativeModule, func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule) (runtime.Match, error) {
		return &financeAuthoritativeMatch{}, nil // 初始化 authoritative match，回傳一個新的 financeAuthoritativeMatch 實例。
	}); err != nil {
		logger.Error("RegisterMatch failed for %s: %v", financeAuthoritativeModule, err)
		return err
	}
	if err := initializer.RegisterMatchmakerMatched(financeMatchmakerMatched); err != nil {
		logger.Error("RegisterMatchmakerMatched failed: %v", err)
		return err
	} // 這裡註冊 matchmaker matched callback，當有玩家匹配成功時會呼叫 financeMatchmakerMatched。

	rpcs := map[string]func(context.Context, runtime.Logger, *sql.DB, runtime.NakamaModule, string) (string, error){
		// 這張 map 是 RPC registry。新增 RPC 時要同時更新：
		// 1. const RPC id
		// 2. 這裡的 handler map
		// 3. rpcGetPhaseConfigHandler 回傳給前端的 rpcIds
		// 4. service.ts 的 RuntimeContext / .env.example / 文件
		rpcGetPhaseConfig:        rpcGetPhaseConfigHandler,
		rpcSubmitPortfolioScore:  rpcSubmitPortfolioScoreHandler,
		rpcCreateGuild:           rpcCreateGuildHandler,
		rpcInviteGuildMember:     rpcInviteGuildMemberHandler,
		rpcPromoteGuildAdmin:     rpcPromoteGuildAdminHandler,
		rpcDemoteGuildAdmin:      rpcDemoteGuildAdminHandler,
		rpcTransferGuildOwner:    rpcTransferGuildOwnerHandler,
		rpcRequestGuildJoin:      rpcRequestGuildJoinHandler,
		rpcApproveGuildJoin:      rpcApproveGuildJoinHandler,
		rpcRejectGuildJoin:       rpcRejectGuildJoinHandler,
		rpcLeaveGuild:            rpcLeaveGuildHandler,
		rpcDisbandGuild:          rpcDisbandGuildHandler,
		rpcKickGuildMember:       rpcKickGuildMemberHandler,
		rpcListGuildJoinRequests: rpcListGuildJoinRequestsHandler,
		rpcGetGuildDetail:        rpcGetGuildDetailHandler,
		rpcUpdateGuildSettings:   rpcUpdateGuildSettingsHandler,
		rpcSearchUsers:           rpcSearchUsersHandler,
		rpcCreateFinanceMatch:    rpcCreateFinanceMatchHandler,
		rpcListFinanceHistory:    rpcListFinanceHistoryHandler,
		rpcGetFinanceMetrics:     rpcGetFinanceMetricsHandler,
		rpcFinanceMatchmaking:    rpcFinanceMatchmakingHandler,
		rpcIngestMatchCandles:    rpcIngestMatchCandlesHandler,
		rpcListMatchCandles:      rpcListMatchCandlesHandler,
	}

	for id, fn := range rpcs {
		if err := initializer.RegisterRpc(id, withRPCRateLimit(id, fn)); err != nil {
			logger.Error("RegisterRpc failed for %s: %v", id, err)
			return err
		}
	}

	logger.Info("Nakama runtime initialized with the authoritative finance match.")
	return nil
}

// matchGameDefinition 會定義一個遊戲類型的基本資訊。

// stringParam 會從 params map 中取出指定 key 的字串值，如果不存在或不是字串則回傳空字串。
func stringParam(params map[string]interface{}, key string) string {
	if value, ok := params[key].(string); ok {
		return value
	}
	return ""
}

// stringSetParam 將 RPC 參數中的字串陣列正規化為去重集合。
func stringSetParam(params map[string]interface{}, key string) map[string]bool {
	result := map[string]bool{} // 這裡建立一個空的 map[string]bool，作為去重集合的結果。
	switch values := params[key].(type) {
	case []string:
		for _, value := range values {
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				result[trimmed] = true
			}
		} // 這裡處理 RPC 參數中的字串陣列，將每個字串去除前後空白後加入結果集合，避免重複。
	case []interface{}:
		for _, value := range values {
			if text, ok := value.(string); ok {
				if trimmed := strings.TrimSpace(text); trimmed != "" {
					result[trimmed] = true
				}
			}
		} // 這裡處理 RPC 參數中的 interface{} 陣列，將每個字串去除前後空白後加入結果集合，避免重複。
	}
	return result
}

// defaultString 會回傳 value，如果 value 為空字串則回傳 defaultValue。
func registerLeaderboards(ctx context.Context, nk runtime.NakamaModule) error {
	// 這三張榜都是 authoritative leaderboard，由 server 決定如何寫入與聚合。
	// global：永久個人榜，best 表示同一 user 保留最佳分。
	if err := nk.LeaderboardCreate(ctx, leaderboardGlobal, true, "desc", "best", "", map[string]interface{}{
		"category":      "global",
		"metric":        "portfolio_return",
		"authoritative": true,
	}, true); err != nil {
		return err
	}
	if err := nk.LeaderboardCreate(ctx, leaderboardWeekly, true, "desc", "best", "0 0 * * 1", map[string]interface{}{
		// weekly：每週一重置的個人榜，適合賽季或短週期活動。
		"category":      "seasonal",
		"metric":        "portfolio_return",
		"scope":         "weekly",
		"authoritative": true,
	}, true); err != nil {
		return err
	}
	if err := nk.LeaderboardCreate(ctx, leaderboardGuildAverage, true, "desc", "set", "0 0 * * 1", map[string]interface{}{
		// guild average：owner id 使用 guild id，score 是 runtime 聚合出的成員平均分。
		// set 表示每次重算直接覆蓋該 guild 的 record。
		"category":      "guild",
		"metric":        "average_return",
		"scope":         "weekly",
		"authoritative": true,
	}, true); err != nil {
		return err
	}
	return nil
}
