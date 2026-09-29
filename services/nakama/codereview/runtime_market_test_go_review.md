# runtime_market_test.go 逐段 Code Review

每段以 `L1`、`L2` 對照 `runtime_market_test.go` 由上到下的測試程式。這些單元測試確認市場 ingestion 的 allowlist、HMAC 簽章與時間保護規則。

## 1. import

```go
// L1
import "crypto/hmac"
// L2
import "crypto/sha256"
// L3
import "fmt"
// L4
import "testing"
// L5
import "time"
```

- `L1`：建立 HMAC 計算器，模擬 price-feed worker 的簽章方式。
- `L2`：指定 HMAC 使用 SHA-256 雜湊演算法。
- `L3`：把簽章 bytes 格式化成十六進位字串。
- `L4`：提供 Go 測試工具。
- `L5`：建立固定 ingestion 時間與 candle timestamp。

## 2. `TestMarketAllowLists`

```go
// L1
t.Setenv("MATCH_PRICE_ALLOWED_SYMBOLS", "BTC/USDT,ETH/USDT")
// L2
t.Setenv("MATCH_PRICE_ALLOWED_SOURCE_PREFIXES", "binance:,kraken:")
// L3
if !marketSymbolAllowed("btc/usdt") || marketSymbolAllowed("SOL/USDT") { t.Fatal(...) }
// L4
if !marketSourceAllowed("binance:1m") || marketSourceAllowed("unknown:1m") { t.Fatal(...) }
```

- `L1`：為目前測試設定可接受的交易標的；以逗號分隔，和 `.env` 使用方式一致。
- `L2`：設定可接受的資料來源 prefix；`binance:1m` 這類來源資訊必須有受信任 prefix。
- `L3`：小寫 `btc/usdt` 仍應通過，表示函式先正規化 symbol；未列入 allowlist 的 `SOL/USDT` 必須拒絕。
- `L4`：可信來源 `binance:1m` 必須通過；未知 prefix 即使格式正確仍必須拒絕。

## 3. `TestValidateMarketIngestSignature`

```go
// L1
now := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
// L2
input := matchCandleIngestPayload{SentAt: "...", Nonce: "...", Symbol: "BTC/USDT", Source: "binance:1m", Candles: []matchCandleRecord{{...}}}
// L3
secret := "test-ingest-secret"
// L4
mac := hmac.New(sha256.New, []byte(secret))
// L5
_, _ = mac.Write([]byte(marketIngestCanonical(input)))
// L6
input.Signature = fmt.Sprintf("%x", mac.Sum(nil))
// L7
if input.Signature != "6ab279...61f933dc" { t.Fatalf(...) }
// L8
if err := validateMarketIngestSignature(input, secret, now); err != nil { t.Fatalf(...) }
// L9
input.Candles[0].Close++
// L10
if err := validateMarketIngestSignature(input, secret, now); err == nil { t.Fatal(...) }
```

- `L1`：使用固定 UTC 時間，讓 timestamp skew 與簽章測試可重現。
- `L2`：建立完整 ingestion payload；簽章保護 `SentAt`、`Nonce`、symbol、source 與每根 OHLCV candle。
- `L3`：測試用 secret；正式環境由 `MATCH_PRICE_INGEST_SECRET` 注入，不能寫死在程式碼。
- `L4`：以 SHA-256 和 secret 建立 HMAC calculator。
- `L5`：將 Go runtime 與 Node worker 共用的 canonical payload 寫入 HMAC；兩端字串格式只要不同，簽章就會不同。
- `L6`：計算 digest 後轉成小寫十六進位 signature，填回 payload。
- `L7`：比對固定 signature vector，確保未來修改 canonical format 時能立刻發現 Node/Go contract 不相容。
- `L8`：未修改的 payload 應驗證成功。
- `L9`：在簽章完成後竄改 close price。
- `L10`：同一 signature 不再符合被修改的 payload，因此必須被拒絕。

## 4. `TestValidateLatestMarketCandle`

```go
// L1
t.Setenv("MATCH_PRICE_MAX_LATEST_AGE_SECONDS", "300")
// L2
t.Setenv("MATCH_PRICE_MAX_FUTURE_SKEW_SECONDS", "120")
// L3
now := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
// L4
if err := validateLatestMarketCandle(matchCandleRecord{Timestamp: now.Add(-time.Minute).UnixMilli()}, now); err != nil { t.Fatalf(...) }
// L5
if err := validateLatestMarketCandle(matchCandleRecord{Timestamp: now.Add(-10 * time.Minute).UnixMilli()}, now); err == nil { t.Fatal(...) }
// L6
if err := validateLatestMarketCandle(matchCandleRecord{Timestamp: now.Add(3 * time.Minute).UnixMilli()}, now); err == nil { t.Fatal(...) }
```

- `L1`：設定最新 candle 最多允許五分鐘舊；超過後不接受 ingestion。
- `L2`：設定 candle timestamp 最多允許兩分鐘位於未來；保護 worker 或交易所時鐘錯誤。
- `L3`：建立固定現在時間。
- `L4`：一分鐘前的 candle 位於允許範圍，應驗證成功。
- `L5`：十分鐘前超過最大 age，應回傳 error；否則 stale 行情可能覆蓋 server price。
- `L6`：三分鐘後超過 future skew，應回傳 error；否則未來資料可能影響當前對局。

## 5. 覆蓋範圍與限制

本檔驗證純函式的市場安全規則，但不會真的寫入 Nakama Storage。nonce claim、價格跳動檢查、candle retention cleanup、RPC authentication 與 price-feed 到 Nakama 的完整網路流程，仍應由 integration/smoke test 覆蓋。
