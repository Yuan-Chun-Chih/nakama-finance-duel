package main

import (
	"context"
	"database/sql"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

// 用於 Nakama runtime 的 RPC handler，提供了使用者身份驗證、JSON payload 解析、RPC 呼叫頻率限制等功能，確保服務的安全性與穩定性。
type runtimeRPCHandler func(context.Context, runtime.Logger, *sql.DB, runtime.NakamaModule, string) (string, error)

// runtimeRPCHandlerWithRateLimit 是帶有 RPC 呼叫頻率限制的 handler，會在呼叫前檢查使用者或來源 IP 的請求次數，若超過限制則回傳錯誤。
type runtimeRateWindow struct {
	StartedAt time.Time
	Count     int
}

// runtimeRatePolicy 定義了 RPC 呼叫的限制策略，包括在指定時間窗內允許的最大請求數量。
type runtimeRatePolicy struct {
	Limit  int
	Window time.Duration
}

// runtimeRPCRateLimiter 是一個全域的 RPC 呼叫頻率限制器，使用 map 來追蹤每個使用者或來源 IP 的請求次數與時間窗，並使用 mutex 保護並發存取。
var runtimeRPCRateLimiter = struct {
	sync.Mutex
	Windows map[string]runtimeRateWindow
}{Windows: map[string]runtimeRateWindow{}}

// withRPCRateLimit 以使用者或來源 IP 為單位限制 RPC 呼叫頻率，避免單一節點被大量請求壓垮。
func withRPCRateLimit(id string, handler runtimeRPCHandler) runtimeRPCHandler {
	policy := runtimeRatePolicyFor(id)
	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
		identity := contextString(ctx, runtime.RUNTIME_CTX_USER_ID)
		if identity == "" {
			identity = contextString(ctx, runtime.RUNTIME_CTX_CLIENT_IP)
		}
		if identity == "" {
			identity = "anonymous"
		}
		if !allowRuntimeRPC(identity+":"+id, policy, time.Now().UTC()) { // 這裡使用 identity 與 RPC id 組成唯一 key，並檢查是否允許該 RPC 呼叫，若超過限制則回傳 resourceExhausted 錯誤。
			logger.Warn("RPC rate limit exceeded rpc=%s identity=%s", id, identity)
			return "", resourceExhausted("Too many requests. Please retry later.")
		}
		return handler(ctx, logger, db, nk, payload)
	}
}

// runtimeRatePolicyFor 為查詢、配對與一般 mutation 設定不同的單節點保護上限。
func runtimeRatePolicyFor(id string) runtimeRatePolicy {
	switch id {
	case rpcFinanceMatchmaking:
		return runtimeRatePolicy{Limit: 120, Window: time.Minute}
	case rpcListFinanceHistory, rpcSearchUsers:
		return runtimeRatePolicy{Limit: 30, Window: time.Minute}
	case rpcListMatchCandles:
		return runtimeRatePolicy{Limit: 60, Window: time.Minute}
	case rpcIngestMatchCandles:
		return runtimeRatePolicy{Limit: 30, Window: time.Minute}
	default:
		return runtimeRatePolicy{Limit: 60, Window: time.Minute}
	}
}

// allowRuntimeRPC 使用固定時間窗計數，並在快取過大時清除已過期項目。
func allowRuntimeRPC(key string, policy runtimeRatePolicy, now time.Time) bool {
	if policy.Limit <= 0 || policy.Window <= 0 { // 若限制為 0 或負數，代表不限制，直接回傳 true。
		return true
	}
	runtimeRPCRateLimiter.Lock()
	defer runtimeRPCRateLimiter.Unlock()
	if len(runtimeRPCRateLimiter.Windows) > 10000 { // 若快取超過 10000 個項目，清除已過期的項目，避免記憶體過度使用。
		for existingKey, window := range runtimeRPCRateLimiter.Windows { // 這裡遍歷所有已存在的快取項目，檢查是否已過期，若是則刪除。
			if now.Sub(window.StartedAt) >= policy.Window {
				delete(runtimeRPCRateLimiter.Windows, existingKey)
			}
		}
	}
	window := runtimeRPCRateLimiter.Windows[key]
	if window.StartedAt.IsZero() || now.Sub(window.StartedAt) >= policy.Window { // 若該 key 尚未存在或已過期，則重置計數器與時間窗，並回傳 true 允許呼叫。
		runtimeRPCRateLimiter.Windows[key] = runtimeRateWindow{StartedAt: now, Count: 1}
		return true
	}
	if window.Count >= policy.Limit { // 若該 key 的計數器已達限制，則回傳 false 拒絕呼叫。
		return false
	}
	window.Count++
	runtimeRPCRateLimiter.Windows[key] = window
	return true
}

// environmentFlag 只接受明確的 true 或 1，未設定時一律採安全的關閉狀態。
func environmentFlag(name string) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	return value == "true" || value == "1"
}

// environmentInt 讀取正整數環境設定；格式錯誤時使用安全預設值。
func environmentInt(name string, fallback int64) int64 {
	value, err := strconv.ParseInt(strings.TrimSpace(os.Getenv(name)), 10, 64) // 這裡使用 strconv.ParseInt 將環境變數的值轉換為 int64，若轉換失敗或小於等於 0，則回傳 fallback。
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

// environmentList 將逗號分隔設定正規化為非空字串集合。
func environmentList(name string) map[string]bool {
	result := map[string]bool{}
	for _, value := range strings.Split(os.Getenv(name), ",") { // 這裡使用 strings.Split 將環境變數的值以逗號分隔，得到一個字串陣列。
		if normalized := strings.TrimSpace(value); normalized != "" { // 這裡使用 strings.TrimSpace 將每個字串去除前後空白，若結果不為空字串則加入結果集合。
			result[normalized] = true
		}
	}
	return result
}
