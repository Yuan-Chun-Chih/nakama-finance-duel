package main

import (
	"github.com/heroiclabs/nakama-common/api"
	"testing"
	"time"
)

// TestFinanceNotionalPreservesBTCMicrosPrecision 驗證 BTC micros 換算不因整數精度遺失。
func TestFinanceNotionalPreservesBTCMicrosPrecision(t *testing.T) {
	tests := []struct {
		name     string
		quantity int64
		price    int64
		want     int64
	}{
		{name: "one BTC at cents price", quantity: financeBTCScale, price: 6_264_729, want: 6_264_729},
		{name: "fractional BTC rounds down to cents", quantity: 15_914_707, price: 6_264_729, want: 99_701_326},
		{name: "zero quantity", quantity: 0, price: 6_264_729, want: 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) { // 這裡使用 t.Run 來建立子測試，方便在測試報告中看到每個測試案例的名稱，並且可以單獨執行某個子測試。
			if got := financeNotional(test.quantity, test.price); got != test.want {
				t.Fatalf("financeNotional(%d, %d) = %d, want %d", test.quantity, test.price, got, test.want)
			}
		})
	}
}

// TestFinanceAllowMessage 驗證同一 tick 的訊息有上限，下一個 tick 會重設計數。
func TestFinanceAllowMessage(t *testing.T) {
	state := &financeAuthoritativeMatchState{Tick: 10, MessageRateWindows: map[string]financeMessageRateWindow{}}
	for index := 0; index < financeMutationMessagesPerTick; index++ {
		if !financeAllowMessage(state, "user", financeOrderOpCode) {
			t.Fatalf("message %d should be accepted", index)
		}
	}
	if financeAllowMessage(state, "user", financeOrderOpCode) { // 測試在同一個 tick 中，當訊息數量超過限制時，financeAllowMessage 應該回傳 false，表示不允許再接收更多訊息。
		t.Fatal("message above the per-tick limit should be rejected")
	}
	state.Tick++
	if !financeAllowMessage(state, "user", financeOrderOpCode) { // 測試在下一個 tick 中，訊息數量應該會被重置，financeAllowMessage 應該回傳 true，表示可以接收新的訊息。
		t.Fatal("new server tick should reset the message window")
	}
}

// TestFinanceFeesAndSlippageUseBasisPoints 驗證費用與滑價依 basis points 計算。
func TestFinanceFeesAndSlippageUseBasisPoints(t *testing.T) {
	if got := calculateBpsCeil(99_701_326, matchTakerFeeBps); got != 79_762 {
		t.Fatalf("taker fee = %d, want 79762", got)
	}
	if got := calculateBpsCeil(99_701_326, matchTaxBps); got != 99_702 {
		t.Fatalf("sell tax = %d, want 99702", got)
	}
	if got, _ := applyMatchSlippage(6_264_729, "buy"); got <= 6_264_729 {
		t.Fatalf("buy slippage price = %d, want price above reference", got)
	}
	if got, _ := applyMatchSlippage(6_264_729, "sell"); got >= 6_264_729 {
		t.Fatalf("sell slippage price = %d, want price below reference", got)
	}
}

// TestFinancePriceFreshness 驗證行情更新時間超過期限後會被視為過期。
func TestFinancePriceFreshness(t *testing.T) {
	fresh := time.Now().UTC().Add(-time.Second).Format(time.RFC3339)
	stale := time.Now().UTC().Add(-time.Duration(financePriceMaxAgeSeconds+1) * time.Second).Format(time.RFC3339)
	if financePriceIsStale(fresh) {
		t.Fatal("fresh price marked stale")
	}
	if !financePriceIsStale(stale) {
		t.Fatal("expired price marked fresh")
	}
	if !financePriceIsStale("not-a-timestamp") {
		t.Fatal("invalid timestamp marked fresh")
	}
}

// TestBootstrapMarketDataIsNeverTradable 驗證 bootstrap 記錄即使時間新鮮也必須停盤。
func TestBootstrapMarketDataIsNeverTradable(t *testing.T) {
	fresh := time.Now().UTC().Format(time.RFC3339)
	if !financePriceRecordIsStale(matchPriceRecord{Price: 65000, UpdatedAt: fresh, Source: "bootstrap"}) {
		t.Fatal("bootstrap price was accepted as tradable market data")
	}
	if financePriceRecordIsStale(matchPriceRecord{Price: 65000, UpdatedAt: fresh, Source: "ccxt"}) {
		t.Fatal("fresh external price was marked stale")
	}
}

// TestMarketBootstrapRequiresExplicitEnvironmentFlag 驗證預設與正式環境不建立測試行情。
func TestMarketBootstrapRequiresExplicitEnvironmentFlag(t *testing.T) {
	t.Setenv("MATCH_PRICE_ALLOW_BOOTSTRAP", "")
	if marketBootstrapEnabled() {
		t.Fatal("market bootstrap enabled without explicit opt-in")
	}
	t.Setenv("MATCH_PRICE_ALLOW_BOOTSTRAP", "false")
	if marketBootstrapEnabled() {
		t.Fatal("market bootstrap enabled for false")
	}
	t.Setenv("MATCH_PRICE_ALLOW_BOOTSTRAP", "true")
	if !marketBootstrapEnabled() {
		t.Fatal("market bootstrap did not honor explicit test opt-in")
	}
}

// TestFinanceIdempotencyCleanupPageExpiresOnlyInvalidOrPastRecords 驗證清理只刪除無效或已過期記錄。
func TestFinanceIdempotencyCleanupPageExpiresOnlyInvalidOrPastRecords(t *testing.T) {
	now := time.Date(2026, time.July, 13, 12, 0, 0, 0, time.UTC)
	objects := []*api.StorageObject{
		{Key: "expired", Version: "v1", Value: mustJSON(financeOrderIdempotencyRecord{ExpiresAt: now.Add(-time.Second).Format(time.RFC3339Nano)})},
		{Key: "fresh", Version: "v2", Value: mustJSON(financeOrderIdempotencyRecord{ExpiresAt: now.Add(time.Hour).Format(time.RFC3339Nano)})},
		{Key: "invalid", Version: "v3", Value: mustJSON(financeOrderIdempotencyRecord{ExpiresAt: "invalid"})},
		{Key: "malformed", Version: "v4", Value: "{"},
	}

	deletes, cursor := financeIdempotencyCleanupPage(objects, "next-page", now)
	if len(deletes) != 2 {
		t.Fatalf("delete count = %d, want 2", len(deletes))
	}
	if deletes[0].Key != "expired" || deletes[0].Version != "v1" {
		t.Fatalf("first delete = %#v, want expired record with version", deletes[0])
	}
	if deletes[1].Key != "invalid" || deletes[1].Version != "v3" {
		t.Fatalf("second delete = %#v, want invalid expiry record with version", deletes[1])
	}
	if cursor.Cursor != "next-page" || cursor.UpdatedAt != now.Format(time.RFC3339Nano) {
		t.Fatalf("cursor = %#v, want next page and deterministic update time", cursor)
	}
}

// TestMarketCandleIndexUsesSymbolCollectionAndNewestFirstKey 驗證標的 collection 與新到舊排序 key。
func TestMarketCandleIndexUsesSymbolCollectionAndNewestFirstKey(t *testing.T) {
	if got := marketCandleCollection("BTC/USDT"); got != "market_candles_btc_usdt" {
		t.Fatalf("market collection = %q", got)
	}
	older := buildMatchCandleKey("BTC/USDT", 1_000)
	newer := buildMatchCandleKey("BTC/USDT", 2_000)
	if newer >= older {
		t.Fatalf("newest key %q must sort before older key %q", newer, older)
	}
}

// TestFinanceMatchmakingLeaseRecovery 驗證過期配對 lease 可以回復為可重新配對狀態。
func TestFinanceMatchmakingLeaseRecovery(t *testing.T) {
	now := time.Date(2026, time.July, 13, 12, 0, 0, 0, time.UTC)
	active := financeMatchmakingRecord{UserID: "user", Status: "matched", LeaseExpiresAt: now.Add(time.Minute).Format(time.RFC3339Nano)}
	if _, changed := financeRecoverExpiredMatchmaking(active, now); changed {
		t.Fatal("active lease was recovered early")
	}
	expired := financeMatchmakingRecord{UserID: "user", Status: "matching", LeaseExpiresAt: now.Add(-time.Second).Format(time.RFC3339Nano)}
	recovered, changed := financeRecoverExpiredMatchmaking(expired, now)
	if !changed || recovered.Status != "idle" || recovered.UserID != "user" {
		t.Fatalf("recovery = %#v, changed=%t", recovered, changed)
	}
}

// TestFinanceMetricsMergeAggregatesShards 驗證多個 metrics shard 能正確合併。
func TestFinanceMetricsMergeAggregatesShards(t *testing.T) {
	total := financeSystemMetrics{OrderRejections: map[string]int64{}}
	financeMergeMetrics(&total, financeSystemMetrics{MatchmakingStarts: 2, OrderRejections: map[string]int64{"market_stale": 1}, UpdatedAt: "2026-07-13T12:00:00Z"})
	financeMergeMetrics(&total, financeSystemMetrics{MatchmakingStarts: 3, OrderRejections: map[string]int64{"market_stale": 2, "insufficient_cash": 1}, UpdatedAt: "2026-07-13T12:01:00Z"})
	if total.MatchmakingStarts != 5 || total.OrderRejections["market_stale"] != 3 || total.OrderRejections["insufficient_cash"] != 1 {
		t.Fatalf("merged metrics = %#v", total)
	}
}
