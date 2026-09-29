package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

// rpcIngestMatchCandlesHandler is the authenticated server-to-server market-data entry point.
func rpcIngestMatchCandlesHandler(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var input matchCandleIngestPayload
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	} // 驗證 secret 是否正確，若不正確則回傳 permission denied。
	secret := strings.TrimSpace(os.Getenv("MATCH_PRICE_INGEST_SECRET"))
	if secret == "" { // 若環境變數 MATCH_PRICE_INGEST_SECRET 未設定，則回傳 failed precondition 錯誤。
		return "", failedPrecondition("MATCH_PRICE_INGEST_SECRET is not configured.")
	}
	providedSecret := strings.TrimSpace(input.Secret)
	if !marketIngestSignatureRequired() && subtle.ConstantTimeCompare([]byte(providedSecret), []byte(secret)) != 1 {
		return "", permissionDenied("Invalid price ingest secret.") // secret 不符時回傳 permission denied。
	}
	// 驗證 symbol 是否為空，若為空則回傳 invalid argument。
	symbol := strings.ToUpper(strings.TrimSpace(input.Symbol))
	if symbol == "" {
		return "", invalidArgument("symbol is required.")
	} // 驗證 candles 長度是否在合理範圍內，若不合理則回傳 out of range。
	if !marketSymbolAllowed(symbol) {
		return "", permissionDenied("symbol is not allowed for price ingestion.")
	}
	if len(input.Candles) == 0 || len(input.Candles) > 500 {
		return "", outOfRange("candles length out of range.")
	}

	now := time.Now().UTC().Format(time.RFC3339Nano) // 取得當前 UTC 時間，格式為 RFC3339Nano。
	source := strings.TrimSpace(input.Source)
	if source == "" {
		source = "ccxt"
	}
	if !marketSourceAllowed(source) {
		return "", permissionDenied("source is not allowed for price ingestion.")
	} // 建立 StorageWrite 陣列，將每個 K 線資料寫入 Nakama storage，並更新最新價格。
	writes := make([]*runtime.StorageWrite, 0, len(input.Candles)+1)
	latest := matchCandleRecord{}          // 建立一個 matchCandleRecord 變數，用於儲存最新的 K 線資料。
	for _, candle := range input.Candles { // 對於每個 K 線資料，驗證其價格、成交量與時間欄位是否合理，若不合理則回傳 invalid argument。
		candle.Symbol = symbol                              // 將 symbol 設為大寫，避免大小寫不一致造成的問題。
		candle.Source = source                              // 將 source 設為輸入的 source，若輸入為空則使用預設值 ccxt。
		candle.UpdatedAt = now                              // 將 UpdatedAt 設為當前 UTC 時間，格式為 RFC3339Nano。
		if err := validateMatchCandle(candle); err != nil { // 驗證 K 線資料是否合法，若不合法則回傳 invalid argument。
			return "", err
		}
		if candle.Timestamp > latest.Timestamp { // 若當前 K 線資料的時間戳大於最新的時間戳，則更新最新的 K 線資料。
			latest = candle
		}
		writes = append(writes, &runtime.StorageWrite{ // 將 K 線資料寫入 Nakama storage，Collection 為 marketCandleCollection(symbol)，Key 為 buildMatchCandleKey(symbol, candle.Timestamp)，Value 為序列化後的 K 線資料，PermissionRead 與 PermissionWrite 為 0。
			Collection: marketCandleCollection(symbol), Key: buildMatchCandleKey(symbol, candle.Timestamp), UserID: "", Value: mustJSON(candle), PermissionRead: 0, PermissionWrite: 0,
		})
	}
	if err := validateLatestMarketCandle(latest, time.Now().UTC()); err != nil {
		return "", err
	}
	if err := validateMarketPriceMovement(ctx, nk, symbol, latest.Close, time.Now().UTC()); err != nil {
		return "", err
	}
	if marketIngestSignatureRequired() {
		if err := validateMarketIngestSignature(input, secret, time.Now().UTC()); err != nil {
			return "", err
		}
		if err := claimMarketIngestNonce(ctx, nk, input.Nonce, time.Now().UTC()); err != nil {
			return "", err
		}
		financeRunMaintenanceTask(ctx, logger, nk, "market_ingest_nonce_cleanup", marketMaintenanceLeaseDuration, func() {
			cleanupMarketIngestNonces(ctx, logger, nk)
		})
	}
	financeRunMaintenanceTask(ctx, logger, nk, "market_candle_cleanup", marketMaintenanceLeaseDuration, func() {
		cleanupMarketCandleRetention(ctx, logger, nk, symbol)
	})
	writes = append(writes, &runtime.StorageWrite{ // 將最新價格寫入 Nakama storage，Collection 為 collectionMatchPriceFeed，Key 為 symbol，Value 為序列化後的 matchPriceRecord，PermissionRead 與 PermissionWrite 為 0。
		Collection: collectionMatchPriceFeed, Key: symbol, UserID: "", Value: mustJSON(matchPriceRecord{Symbol: symbol, Price: latest.Close, UpdatedAt: now, Source: source}), PermissionRead: 0, PermissionWrite: 0,
	})
	if _, err := nk.StorageWrite(ctx, writes); err != nil { // 將 K 線資料與最新價格寫入 Nakama storage，若寫入失敗則回傳錯誤。
		return "", err
	}
	return mustJSON(map[string]interface{}{"accepted": true, "symbol": symbol, "candles": len(input.Candles), "latestTimestamp": latest.Timestamp}), nil // 回傳成功訊息，包含接受的標的、K 線資料數量與最新時間戳。
}

// marketIngestSignatureRequired 預設要求 HMAC；只有明確設為 false 或 0 才允許舊 shared-secret payload。
func marketIngestSignatureRequired() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("MATCH_PRICE_REQUIRE_SIGNATURE")))
	return value != "false" && value != "0"
}

// marketIngestCanonical 建立 Go 與 Node worker 共用的固定簽章字串。
func marketIngestCanonical(input matchCandleIngestPayload) string {
	lines := []string{input.SentAt, input.Nonce, strings.ToUpper(strings.TrimSpace(input.Symbol)), strings.TrimSpace(input.Source)}
	for _, candle := range input.Candles {
		lines = append(lines, strings.Join([]string{
			strconv.Itoa(candle.Round), strconv.FormatInt(candle.Timestamp, 10), strconv.FormatInt(candle.Open, 10),
			strconv.FormatInt(candle.High, 10), strconv.FormatInt(candle.Low, 10), strconv.FormatInt(candle.Close, 10), strconv.FormatInt(candle.Volume, 10),
		}, ","))
	}
	return strings.Join(lines, "\n")
}

// validateMarketIngestSignature 驗證送出時間、nonce 與整批 K 線的 HMAC-SHA256。
func validateMarketIngestSignature(input matchCandleIngestPayload, secret string, now time.Time) error {
	sentAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(input.SentAt))
	if err != nil {
		return invalidArgument("sentAt must be RFC3339.")
	}
	maxSkew := time.Duration(environmentInt("MATCH_PRICE_SIGNATURE_MAX_SKEW_SECONDS", 60)) * time.Second
	if sentAt.Before(now.Add(-maxSkew)) || sentAt.After(now.Add(maxSkew)) {
		return failedPrecondition("price ingest signature has expired.")
	}
	if len(strings.TrimSpace(input.Nonce)) < 16 || len(input.Nonce) > 128 {
		return invalidArgument("nonce length is invalid.")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(marketIngestCanonical(input)))
	expected := fmt.Sprintf("%x", mac.Sum(nil))
	provided := strings.ToLower(strings.TrimSpace(input.Signature))
	if subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		return permissionDenied("Invalid price ingest signature.")
	}
	return nil
}

// claimMarketIngestNonce 以 create-only StorageWrite 保證同一個簽章 nonce 只能成功一次。
func claimMarketIngestNonce(ctx context.Context, nk runtime.NakamaModule, nonce string, now time.Time) error {
	record := marketIngestNonceRecord{Nonce: nonce, ExpiresAt: now.Add(marketIngestNonceRetention).Format(time.RFC3339Nano)}
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection: collectionMarketIngestNonces, Key: nonce, UserID: "", Value: mustJSON(record), Version: "*", PermissionRead: 0, PermissionWrite: 0,
	}}); err != nil {
		return failedPrecondition("price ingest nonce was already consumed.")
	}
	return nil
}

// cleanupMarketIngestNonces 以小批次刪除超過保留期的防重放 nonce。
func cleanupMarketIngestNonces(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule) {
	maintenance, version, err := readFinanceMaintenanceCursor(ctx, nk, "market_ingest_nonce_cleanup")
	if err != nil {
		logger.Warn("Market ingest nonce cursor read failed: %v", err)
		return
	}
	objects, nextCursor, err := nk.StorageList(ctx, "", "", collectionMarketIngestNonces, marketCandleRetentionBatchSize, maintenance.Cursor)
	if err != nil {
		logger.Warn("Market ingest nonce list failed: %v", err)
		return
	}
	now := time.Now().UTC()
	deletes := make([]*runtime.StorageDelete, 0)
	for _, object := range objects {
		if object == nil || object.GetValue() == "" {
			continue
		}
		var record marketIngestNonceRecord
		var expiresAt time.Time
		var parseErr error
		if json.Unmarshal([]byte(object.GetValue()), &record) == nil {
			expiresAt, parseErr = time.Parse(time.RFC3339Nano, record.ExpiresAt)
		}
		if parseErr != nil || !expiresAt.After(now) {
			deletes = append(deletes, &runtime.StorageDelete{Collection: collectionMarketIngestNonces, Key: object.GetKey(), UserID: "", Version: object.GetVersion()})
		}
	}
	if len(deletes) > 0 {
		if err := nk.StorageDelete(ctx, deletes); err != nil {
			logger.Warn("Market ingest nonce cleanup failed: %v", err)
		}
	}
	maintenance.Cursor = nextCursor
	maintenance.UpdatedAt = now.Format(time.RFC3339Nano)
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection: collectionFinanceMaintenance, Key: "market_ingest_nonce_cleanup", UserID: "", Value: mustJSON(maintenance),
		Version: version, PermissionRead: 0, PermissionWrite: 0,
	}}); err != nil {
		logger.Warn("Market ingest nonce cursor write failed: %v", err)
	}
}

// marketSymbolAllowed 僅允許環境設定中明確列出的交易標的進入 authoritative price feed。
func marketSymbolAllowed(symbol string) bool {
	allowed := environmentList("MATCH_PRICE_ALLOWED_SYMBOLS")
	if len(allowed) == 0 {
		allowed["BTC/USDT"] = true
	}
	for candidate := range allowed {
		if strings.EqualFold(candidate, symbol) {
			return true
		}
	}
	return false
}

// marketSourceAllowed 以來源前綴 allowlist 拒絕未授權交易所或 worker 名稱。
func marketSourceAllowed(source string) bool {
	allowed := environmentList("MATCH_PRICE_ALLOWED_SOURCE_PREFIXES")
	if len(allowed) == 0 {
		allowed["binance:"] = true
	}
	for prefix := range allowed {
		if strings.HasPrefix(strings.ToLower(source), strings.ToLower(prefix)) {
			return true
		}
	}
	return false
}

// validateLatestMarketCandle 確保最新 K 線沒有過舊，也沒有明顯位於 server 未來時間。
func validateLatestMarketCandle(candle matchCandleRecord, now time.Time) error {
	timestamp := time.UnixMilli(candle.Timestamp)
	maxAge := time.Duration(environmentInt("MATCH_PRICE_MAX_LATEST_AGE_SECONDS", 300)) * time.Second
	maxFutureSkew := time.Duration(environmentInt("MATCH_PRICE_MAX_FUTURE_SKEW_SECONDS", 120)) * time.Second
	if timestamp.Before(now.Add(-maxAge)) {
		return failedPrecondition("latest candle is too old.")
	}
	if timestamp.After(now.Add(maxFutureSkew)) {
		return invalidArgument("latest candle timestamp is too far in the future.")
	}
	return nil
}

// validateMarketPriceMovement 拒絕短時間內超過允許幅度的價格跳動，過舊或 bootstrap 基準不參與比較。
func validateMarketPriceMovement(ctx context.Context, nk runtime.NakamaModule, symbol string, nextPrice int64, now time.Time) error {
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionMatchPriceFeed, Key: symbol, UserID: ""}})
	if err != nil || len(objects) == 0 || objects[0] == nil || objects[0].GetValue() == "" {
		return err
	}
	var previous matchPriceRecord
	if json.Unmarshal([]byte(objects[0].GetValue()), &previous) != nil || previous.Price <= 0 || strings.EqualFold(previous.Source, "bootstrap") {
		return nil
	}
	updatedAt, parseErr := time.Parse(time.RFC3339, previous.UpdatedAt)
	if parseErr != nil || now.Sub(updatedAt) > 10*time.Minute {
		return nil
	}
	moveBps := int64(math.Abs(float64(nextPrice-previous.Price)) * 10000 / float64(previous.Price))
	if moveBps > environmentInt("MATCH_PRICE_MAX_MOVE_BPS", 2500) {
		return failedPrecondition("price movement exceeds the configured safety threshold.")
	}
	return nil
}

// 指定標的與時間範圍，讀取行情 K 線。
func rpcListMatchCandlesHandler(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	if _, err := requireUserID(ctx); err != nil { // 驗證使用者是否已登入，若未登入則回傳 unauthenticated 錯誤。
		return "", err
	}
	var input matchCandleListPayload // 解析輸入的 JSON payload，若解析失敗則回傳錯誤。
	if err := parsePayload(payload, &input); err != nil {
		return "", err
	}
	symbol := strings.ToUpper(strings.TrimSpace(input.Symbol))

	if symbol == "" { // 若 symbol 為空，則使用預設值 BTC/USDT。
		symbol = "BTC/USDT"
	}
	limit := input.Limit // 若讀取的請求 limit 小於等於 0 或大於 300，則使用預設值 120。
	if limit <= 0 || limit > 300 {
		limit = 120
	}

	candles, err := listMarketCandles(ctx, nk, marketCandleCollection(symbol), symbol, limit) // 讀取行情 K 線資料，若讀取失敗則回傳錯誤。
	if err != nil {                                                                           // 讀取行情 K 線資料，若讀取失敗則回傳錯誤。
		return "", err
	}
	// Existing deployments used one shared collection. Read it only while a
	// 新增的部署使用了每個標的獨立的 collection。若 candles 為空，則嘗試從舊的 collection 讀取 K 線資料。
	if len(candles) == 0 {
		candles, err = listLegacyMarketCandles(ctx, nk, symbol, limit)
		if err != nil {
			return "", err
		}
	}
	sort.Slice(candles, func(i, j int) bool { return candles[i].Timestamp < candles[j].Timestamp }) // 將 candles 依時間戳由小到大排序，方便前端顯示。
	if len(candles) > limit {                                                                       // 若 candles 長度大於 limit，則只保留最新的 limit 筆資料。
		candles = candles[len(candles)-limit:]
	} // 回傳成功訊息，包含標的與 K 線資料。
	return mustJSON(map[string]interface{}{"symbol": symbol, "candles": candles}), nil // 回傳成功訊息，包含標的與 K 線資料。
}

// listMarketCandles 依標的與時間倒序讀取行情 K 線。
func listMarketCandles(ctx context.Context, nk runtime.NakamaModule, collection, symbol string, limit int) ([]matchCandleRecord, error) {
	objects, _, err := nk.StorageList(ctx, "", "", collection, limit, "")
	if err != nil { // 讀取行情 K 線資料，若讀取失敗則回傳錯誤。
		return nil, err
	}
	candles := make([]matchCandleRecord, 0, len(objects))
	for _, object := range objects { // 讀取行情 K 線資料，若讀取失敗則回傳錯誤。
		if object == nil || object.GetValue() == "" { // 若 object 為 nil 或 Value 為空，則跳過該筆資料。
			continue
		}
		var candle matchCandleRecord // 將 object 的 Value 反序列化為 matchCandleRecord，若反序列化失敗或 symbol 不符，則跳過該筆資料。
		if json.Unmarshal([]byte(object.GetValue()), &candle) == nil && strings.EqualFold(candle.Symbol, symbol) {
			candles = append(candles, candle) // 將符合條件的 K 線資料加入 candles 陣列。
		}
	}
	return candles, nil
}

// listLegacyMarketCandles is a temporary migration path for records written
// 在 candles collection 之前的舊部署。它會讀取舊的 collection，並將符合 symbol 的 K 線資料回傳。
func listLegacyMarketCandles(ctx context.Context, nk runtime.NakamaModule, symbol string, limit int) ([]matchCandleRecord, error) {
	candles := make([]matchCandleRecord, 0, limit)
	cursor := ""
	for {
		objects, nextCursor, err := nk.StorageList(ctx, "", "", collectionMatchCandles, 300, cursor)
		if err != nil {
			return nil, err
		}
		for _, object := range objects { // 讀取舊的 collection，若讀取失敗則回傳錯誤。
			if object == nil || object.GetValue() == "" { // 若 object 為 nil 或 Value 為空，則跳過該筆資料。
				continue
			}
			var candle matchCandleRecord
			if json.Unmarshal([]byte(object.GetValue()), &candle) == nil && strings.EqualFold(candle.Symbol, symbol) { // 將 object 的 Value 反序列化為 matchCandleRecord，若反序列化失敗或 symbol 不符，則跳過該筆資料。
				candles = append(candles, candle) // 將符合條件的 K 線資料加入 candles 陣列。
			}
		}
		if nextCursor == "" { // 若 nextCursor 為空，表示已讀取完所有資料，則跳出迴圈。
			break
		}
		cursor = nextCursor
	}
	sort.Slice(candles, func(i, j int) bool { return candles[i].Timestamp < candles[j].Timestamp })
	if len(candles) > limit {
		return candles[len(candles)-limit:], nil
	}
	return candles, nil
}

// seedDefaultMatchPriceFeed 在沒有外部行情時建立可供測試使用的預設價格。
func seedDefaultMatchPriceFeed(ctx context.Context, nk runtime.NakamaModule) error {
	if !marketBootstrapEnabled() {
		return nil
	}
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionMatchPriceFeed, Key: "BTC/USDT", UserID: ""}})
	if err != nil { // 讀取 BTC/USDT 的價格資料，若讀取失敗則回傳錯誤。
		return err
	}
	if len(objects) > 0 && objects[0] != nil && objects[0].GetValue() != "" { // 若 BTC/USDT 的價格資料已存在，則不需要建立預設價格，直接回傳 nil。
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano) // 取得當前 UTC 時間，格式為 RFC3339Nano，用於建立預設價格的 UpdatedAt 欄位。
	return writeDefaultBTCPrice(ctx, nk, now)
}

// marketBootstrapEnabled 只在明確啟用時允許建立測試行情；正式環境預設永遠關閉。
func marketBootstrapEnabled() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("MATCH_PRICE_ALLOW_BOOTSTRAP")))
	return value == "true" || value == "1"
}

// writeDefaultBTCPrice 寫入預設 BTC 價格與更新時間。
func writeDefaultBTCPrice(ctx context.Context, nk runtime.NakamaModule, updatedAt string) error {
	return storageWriteOne(ctx, nk, collectionMatchPriceFeed, "BTC/USDT", matchPriceRecord{
		Symbol: "BTC/USDT", Price: defaultMatchPrices()["BTC/USDT"], UpdatedAt: updatedAt, Source: "bootstrap",
	}) // 寫入 BTC/USDT 的預設價格，Collection 為 collectionMatchPriceFeed，Key 為 BTC/USDT，Value 為序列化後的 matchPriceRecord，PermissionRead 與 PermissionWrite 為 0。
}

// storageWriteOne 將單筆資料序列化後寫入 Nakama storage。
func storageWriteOne(ctx context.Context, nk runtime.NakamaModule, collection, key string, value interface{}) error {
	_, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collection, Key: key, UserID: "", Value: mustJSON(value), PermissionRead: 0, PermissionWrite: 0}})
	return err
}

// validateMatchCandle 驗證 K 線價格、成交量與時間欄位的基本範圍。
func validateMatchCandle(candle matchCandleRecord) error {
	if candle.Timestamp <= 0 || candle.Open <= 0 || candle.High <= 0 || candle.Low <= 0 || candle.Close <= 0 || candle.Volume < 0 {
		return invalidArgument("invalid candle values")
	}
	if candle.Low > candle.High || candle.Open < candle.Low || candle.Open > candle.High || candle.Close < candle.Low || candle.Close > candle.High {
		return invalidArgument("invalid candle price range")
	}
	return nil
}

// buildMatchCandleKey 建立可依時間排序且不覆蓋不同標的的 K 線 key。
func buildMatchCandleKey(symbol string, timestamp int64) string {
	return fmt.Sprintf("%019d", math.MaxInt64-timestamp)
}

// marketCandleCollection 將標的正規化為對應的行情 collection 名稱。
func marketCandleCollection(symbol string) string {
	normalized := strings.NewReplacer("/", "_", "-", "_", " ", "_").Replace(strings.ToLower(strings.TrimSpace(symbol)))
	return marketCandleCollectionPrefix + normalized
}

// requireUserID 從 context 中取得使用者 ID，若不存在則回傳 unauthenticated 錯誤。
// helper 函式主要是為了簡化 Nakama runtime 的開發，提供一些常用的功能，例如檢查社群成員資格、解析 JSON payload、建立錯誤訊息等。
func cleanupMarketCandleRetention(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, symbol string) {
	collection := marketCandleCollection(symbol)
	maintenanceKey := "market_cleanup:" + collection
	maintenance, version, err := readFinanceMaintenanceCursor(ctx, nk, maintenanceKey)
	if err != nil {
		logger.Warn("Market retention cursor read failed symbol=%s: %v", symbol, err)
		return
	}
	objects, nextCursor, err := nk.StorageList(ctx, "", "", collection, marketCandleRetentionBatchSize, maintenance.Cursor)
	if err != nil {
		logger.Warn("Market retention list failed symbol=%s: %v", symbol, err)
		return
	}
	cutoff := time.Now().UTC().Add(-marketCandleRetention).UnixMilli()
	deletes := make([]*runtime.StorageDelete, 0)
	for _, object := range objects {
		if object == nil || object.GetValue() == "" {
			continue
		}
		var candle matchCandleRecord
		if json.Unmarshal([]byte(object.GetValue()), &candle) == nil && candle.Timestamp < cutoff {
			deletes = append(deletes, &runtime.StorageDelete{Collection: collection, Key: object.GetKey(), UserID: "", Version: object.GetVersion()})
		}
	}
	if len(deletes) > 0 {
		if err := nk.StorageDelete(ctx, deletes); err != nil {
			logger.Warn("Market retention delete failed symbol=%s: %v", symbol, err)
		}
	}
	maintenance.Cursor = nextCursor
	maintenance.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{Collection: collectionFinanceMaintenance, Key: maintenanceKey, UserID: "", Value: mustJSON(maintenance), Version: version, PermissionRead: 0, PermissionWrite: 0}}); err != nil {
		logger.Warn("Market retention cursor write failed symbol=%s: %v", symbol, err)
	}
}

// defaultMatchPrices 回傳測試與無行情時使用的初始價格表。
func defaultMatchPrices() map[string]int64 {
	return map[string]int64{"BTC/USDT": 65000}
}

// applyMatchSlippage 依買賣方向套用滑價並回傳成交價與滑價金額。
func applyMatchSlippage(price int64, side string) (int64, int64) {
	if price <= 0 {
		return 0, 0
	}
	slippage := calculateBpsCeil(price, 10)
	if side == "sell" {
		return maxInt64(1, price-slippage), slippage
	}
	return price + slippage, slippage
}

// maxInt64 回傳兩個 int64 中較大的值。
func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
