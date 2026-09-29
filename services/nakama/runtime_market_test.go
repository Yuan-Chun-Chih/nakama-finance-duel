package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"fmt"
	"testing"
	"time"
)

// TestMarketAllowLists 驗證行情標的與來源必須出現在環境 allowlist。
func TestMarketAllowLists(t *testing.T) {
	t.Setenv("MATCH_PRICE_ALLOWED_SYMBOLS", "BTC/USDT,ETH/USDT")
	t.Setenv("MATCH_PRICE_ALLOWED_SOURCE_PREFIXES", "binance:,kraken:")
	if !marketSymbolAllowed("btc/usdt") || marketSymbolAllowed("SOL/USDT") { // 這裡使用 marketSymbolAllowed 與 marketSourceAllowed 檢查標的與來源是否在 allowlist 中，若不符合則回傳錯誤。
		t.Fatal("market symbol allowlist was not enforced")
	}
	if !marketSourceAllowed("binance:1m") || marketSourceAllowed("unknown:1m") { // 這裡使用 marketSymbolAllowed 與 marketSourceAllowed 檢查標的與來源是否在 allowlist 中，若不符合則回傳錯誤。
		t.Fatal("market source allowlist was not enforced")
	}
}

// TestValidateMarketIngestSignature 驗證 HMAC 正確時接受，payload 被修改後拒絕。
func TestValidateMarketIngestSignature(t *testing.T) {
	now := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	input := matchCandleIngestPayload{ // 這裡建立一個 matchCandleIngestPayload 結構體，模擬行情資料的輸入，包含了公會 ID、時間戳、隨機數、交易對、來源與 K 線資料。
		SentAt: "2026-07-18T00:00:00.000Z", Nonce: "12345678-1234-1234-1234-123456789abc",
		Symbol: "BTC/USDT", Source: "binance:1m",
		Candles: []matchCandleRecord{{Round: 1, Timestamp: now.UnixMilli(), Open: 65000, High: 65100, Low: 64900, Close: 65050, Volume: 10}},
	}
	secret := "test-ingest-secret"
	mac := hmac.New(sha256.New, []byte(secret))            // 這裡使用 HMAC-SHA256 計算輸入資料的簽名，確保資料在傳輸過程中未被篡改。
	_, _ = mac.Write([]byte(marketIngestCanonical(input))) // 這裡使用 marketIngestCanonical 將輸入資料轉換為 canonical string，並寫入 HMAC 計算器中，得到簽名。
	input.Signature = fmt.Sprintf("%x", mac.Sum(nil))
	if input.Signature != "6ab27942529aaa24547f72f1008d4c10ea5619aadacda9dc18e130de61f933dc" { // 這裡檢查計算出的簽名是否與預期的簽名一致，若不一致則回傳錯誤。
		t.Fatalf("Go canonical signature must match the Node worker vector: %s", input.Signature)
	}
	if err := validateMarketIngestSignature(input, secret, now); err != nil { // 這裡使用 validateMarketIngestSignature 驗證簽名是否正確，若正確則回傳 nil，否則回傳錯誤。
		t.Fatalf("valid signature should be accepted: %v", err)
	}
	input.Candles[0].Close++
	if err := validateMarketIngestSignature(input, secret, now); err == nil { // 這裡修改了輸入資料的 K 線收盤價，並再次驗證簽名是否正確，若簽名被篡改則回傳錯誤。
		t.Fatal("modified payload should invalidate the signature")
	}
}

// TestValidateLatestMarketCandle 驗證最新 K 線的過舊與未來時間保護。
func TestValidateLatestMarketCandle(t *testing.T) {
	t.Setenv("MATCH_PRICE_MAX_LATEST_AGE_SECONDS", "300")
	t.Setenv("MATCH_PRICE_MAX_FUTURE_SKEW_SECONDS", "120")
	now := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	if err := validateLatestMarketCandle(matchCandleRecord{Timestamp: now.Add(-time.Minute).UnixMilli()}, now); err != nil { // 這裡使用 validateLatestMarketCandle 驗證最新 K 線的時間戳是否在允許的範圍內，若在範圍內則回傳 nil，否則回傳錯誤。
		t.Fatalf("fresh candle should be accepted: %v", err)
	}
	if err := validateLatestMarketCandle(matchCandleRecord{Timestamp: now.Add(-10 * time.Minute).UnixMilli()}, now); err == nil { // 這裡使用 validateLatestMarketCandle 驗證過舊的 K 線是否被拒絕，若被拒絕則回傳錯誤，否則回傳 nil。
		t.Fatal("stale candle should be rejected")
	}
	if err := validateLatestMarketCandle(matchCandleRecord{Timestamp: now.Add(3 * time.Minute).UnixMilli()}, now); err == nil { // 這裡使用 validateLatestMarketCandle 驗證未來的 K 線是否被拒絕，若被拒絕則回傳錯誤，否則回傳 nil。
		t.Fatal("future candle should be rejected")
	}
}
