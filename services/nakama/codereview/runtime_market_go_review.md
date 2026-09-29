# runtime_market.go 逐行 Code Review

依照 runtime_market.go 的實際 function 順序整理；每段先列重要程式碼，再說明實際資料流與安全作用。

## 1. rpcIngestMatchCandlesHandler

~~~go
var input matchCandleIngestPayload
if err := parsePayload(payload, &input); err != nil { return "", err }
secret := strings.TrimSpace(os.Getenv("MATCH_PRICE_INGEST_SECRET"))
if secret == "" { return "", failedPrecondition("MATCH_PRICE_INGEST_SECRET is not configured.") }
if !marketIngestSignatureRequired() && subtle.ConstantTimeCompare(
	[]byte(strings.TrimSpace(input.Secret)), []byte(secret),
) != 1 { return "", permissionDenied("Invalid price ingest secret.") }
~~~

- input 接收行情 worker 的 symbol、candles、source、sentAt、nonce 與 HMAC signature。
- parsePayload 將 RPC JSON 寫入 input；解析失敗停止流程。
- os.Getenv 讀取 server 環境變數，不能使用 client 提供的環境設定。
- 正式預設要求 HMAC，不會把 secret 放入 RPC payload；只有明確關閉簽章時才走舊 secret 比對。
- 這裡是行情寫入的 server-to-server 邊界。

~~~go
symbol := strings.ToUpper(strings.TrimSpace(input.Symbol))
if symbol == "" { return "", invalidArgument("symbol is required.") }
if !marketSymbolAllowed(symbol) { return "", permissionDenied(...) }
if len(input.Candles) == 0 || len(input.Candles) > 500 { return "", outOfRange("candles length out of range.") }
now := time.Now().UTC().Format(time.RFC3339Nano)
source := strings.TrimSpace(input.Source)
if source == "" { source = "ccxt" }
if !marketSourceAllowed(source) { return "", permissionDenied(...) }
~~~

- symbol 被轉成固定大寫格式。
- symbol 與 source 都必須通過環境 allowlist，正式預設只接受 BTC/USDT 與 binance 前綴。
- candles 限制為 1 到 500 筆，控制 RPC 與 storage 負載。
- now 由 server 產生，不信任 client 時間。
- source 未提供時使用 ccxt 作為來源標籤。

~~~go
for _, candle := range input.Candles {
	candle.Symbol = symbol
	candle.Source = source
	candle.UpdatedAt = now
	if err := validateMatchCandle(candle); err != nil { return "", err }
	if candle.Timestamp > latest.Timestamp { latest = candle }
	writes = append(writes, &runtime.StorageWrite{
		Collection: marketCandleCollection(symbol),
		Key: buildMatchCandleKey(symbol, candle.Timestamp),
		UserID: "",
		Value: mustJSON(candle),
		PermissionRead: 0,
		PermissionWrite: 0,
	})
}
~~~

- server 覆寫每筆 candle 的 symbol、source 與 updatedAt。
- validateMatchCandle 先驗證 OHLC、timestamp 與 volume。
- latest 保存本批最新 candle，後續用來更新 price projection。
- storage permission 為 0，client 不能直接改行情 records。

~~~go
if err := validateLatestMarketCandle(latest, time.Now().UTC()); err != nil { return "", err }
if err := validateMarketPriceMovement(ctx, nk, symbol, latest.Close, time.Now().UTC()); err != nil { return "", err }
if marketIngestSignatureRequired() {
	if err := validateMarketIngestSignature(input, secret, time.Now().UTC()); err != nil { return "", err }
	if err := claimMarketIngestNonce(ctx, nk, input.Nonce, time.Now().UTC()); err != nil { return "", err }
}

writes = append(writes, &runtime.StorageWrite{
	Collection: collectionMatchPriceFeed,
	Key: symbol,
	UserID: "",
	Value: mustJSON(matchPriceRecord{Symbol: symbol, Price: latest.Close, UpdatedAt: now, Source: source}),
	PermissionRead: 0,
	PermissionWrite: 0,
})
if _, err := nk.StorageWrite(ctx, writes); err != nil { return "", err }
return mustJSON(map[string]interface{}{
	"accepted": true, "symbol": symbol, "candles": len(input.Candles),
	"latestTimestamp": latest.Timestamp,
}), nil
~~~

- 同批寫入 candles 與最新價格 projection。
- 寫入前會拒絕過舊、未來或短時間異常跳價，並驗證整批 candles 的 HMAC。
- nonce 以 create-only storage claim；同一請求被重放時第二次一定失敗。
- 最新價格只取最新 candle 的 close。
- StorageWrite 失敗不回傳 accepted。
- RPC response 只表示行情寫入成功，不提供 client 可覆寫的資產欄位。

## 2. 行情簽章與防重放 helpers

~~~go
canonical := marketIngestCanonical(input)
mac := hmac.New(sha256.New, []byte(secret))
mac.Write([]byte(canonical))
expected := fmt.Sprintf("%x", mac.Sum(nil))
~~~

- canonical 依固定順序串接 sentAt、nonce、symbol、source 與每根 candle 欄位。
- Node worker 與 Go runtime 使用相同格式，任何價格、時間或成交量被修改都會改變 signature。
- `validateMarketIngestSignature` 同時限制 sentAt 偏差，預設只能相差 60 秒。
- `claimMarketIngestNonce` 使用 `Version: "*"` 建立一次性 record，防止合法 payload 被重播。
- `cleanupMarketIngestNonces` 依 cursor 分批刪除超過 24 小時的 nonce。

## 3. rpcListMatchCandlesHandler

~~~go
if _, err := requireUserID(ctx); err != nil { return "", err }
var input matchCandleListPayload
if err := parsePayload(payload, &input); err != nil { return "", err }
symbol := strings.ToUpper(strings.TrimSpace(input.Symbol))
if symbol == "" { symbol = "BTC/USDT" }
limit := input.Limit
if limit <= 0 || limit > 300 { limit = 120 }
~~~

- requireUserID 限制匿名使用者查詢。
- symbol 空白時使用 BTC/USDT。
- limit 限制在 1 到 300 之間，預設 120。

~~~go
candles, err := listMarketCandles(ctx, nk, marketCandleCollection(symbol), symbol, limit)
if err != nil { return "", err }
if len(candles) == 0 {
	candles, err = listLegacyMarketCandles(ctx, nk, symbol, limit)
	if err != nil { return "", err }
}
sort.Slice(candles, func(i, j int) bool { return candles[i].Timestamp < candles[j].Timestamp })
if len(candles) > limit { candles = candles[len(candles)-limit:] }
return mustJSON(map[string]interface{}{"symbol": symbol, "candles": candles}), nil
~~~

- 優先查 indexed collection。
- 沒資料才查舊共用 collection，支援資料遷移。
- 依 timestamp 由舊到新排序，只回傳最新 limit 筆。
- 前端拿到的是 backend storage 資料，不直接連交易所。

## 4. listMarketCandles

~~~go
objects, _, err := nk.StorageList(ctx, "", "", collection, limit, "")
if err != nil { return nil, err }
candles := make([]matchCandleRecord, 0, len(objects))
for _, object := range objects {
	if object == nil || object.GetValue() == "" { continue }
	var candle matchCandleRecord
	if json.Unmarshal([]byte(object.GetValue()), &candle) == nil &&
		strings.EqualFold(candle.Symbol, symbol) {
		candles = append(candles, candle)
	}
}
return candles, nil
~~~

- StorageList 讀指定 collection。
- 空 object 或空 value 略過。
- json.Unmarshal 還原 candle；EqualFold 確認 symbol 相符。
- 只有有效 JSON 且標的正確的資料會回傳。

## 5. listLegacyMarketCandles

~~~go
candles := make([]matchCandleRecord, 0, limit)
cursor := ""
for {
	objects, nextCursor, err := nk.StorageList(ctx, "", "", collectionMatchCandles, 300, cursor)
	if err != nil { return nil, err }
	// 逐筆 JSON 解析並篩選 symbol
	if nextCursor == "" { break }
	cursor = nextCursor
}
sort.Slice(candles, func(i, j int) bool { return candles[i].Timestamp < candles[j].Timestamp })
if len(candles) > limit { return candles[len(candles)-limit:], nil }
return candles, nil
~~~

- 舊 collection 以 cursor 分頁掃描，每頁最多 300 筆。
- 讀完所有頁面後排序並保留最新 limit 筆。
- 這是遷移期間 fallback，正常新資料走 indexed collection。

## 6. seedDefaultMatchPriceFeed

~~~go
if !marketBootstrapEnabled() { return nil }
objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
	Collection: collectionMatchPriceFeed, Key: "BTC/USDT", UserID: "",
}})
if err != nil { return err }
if len(objects) > 0 && objects[0] != nil && objects[0].GetValue() != "" { return nil }
now := time.Now().UTC().Format(time.RFC3339Nano)
return writeDefaultBTCPrice(ctx, nk, now)
~~~

- `marketBootstrapEnabled()` 為 false 時不讀寫任何假行情；正式環境預設走此分支。
- 只有測試環境明確設定 `MATCH_PRICE_ALLOW_BOOTSTRAP=true` 才可能建立資料。
- 已有 price projection 時仍不覆寫。

## 7. marketBootstrapEnabled

~~~go
value := strings.ToLower(strings.TrimSpace(os.Getenv("MATCH_PRICE_ALLOW_BOOTSTRAP")))
return value == "true" || value == "1"
~~~

- `os.Getenv` 讀取部署環境值；未設定得到空字串。
- Trim/ToLower 讓大小寫與前後空白不影響解析。
- 僅 `true` 或 `1` 明確啟用，其他值全部 fail-closed。

## 8. writeDefaultBTCPrice

~~~go
return storageWriteOne(ctx, nk, collectionMatchPriceFeed, "BTC/USDT", matchPriceRecord{
	Symbol: "BTC/USDT", Price: defaultMatchPrices()["BTC/USDT"],
	UpdatedAt: updatedAt, Source: "bootstrap",
})
~~~

- 將預設 BTC 價格寫入固定 key。
- Source 標記資料不是交易所即時行情。
- 透過共用 helper 保持 storage 權限一致。

## 9. storageWriteOne

~~~go
_, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
	Collection: collection, Key: key, UserID: "", Value: mustJSON(value),
	PermissionRead: 0, PermissionWrite: 0,
}})
return err
~~~

- value 轉 JSON 後寫入 storage。
- 空 UserID 代表全域 server record。
- read/write permission 皆為 0，避免 client 直接讀寫。
- helper 統一所有 server projection 的寫入設定。

## 10. validateMatchCandle

~~~go
if candle.Timestamp <= 0 || candle.Open <= 0 || candle.High <= 0 ||
	candle.Low <= 0 || candle.Close <= 0 || candle.Volume < 0 {
	return invalidArgument("invalid candle values")
}
if candle.Low > candle.High || candle.Open < candle.Low ||
	candle.Open > candle.High || candle.Close < candle.Low ||
	candle.Close > candle.High {
	return invalidArgument("invalid candle price range")
}
return nil
~~~

- timestamp 與 OHLC 必須正數，volume 可為零但不可負。
- low 不可高於 high。
- open、close 必須介於 low 與 high。
- 任何不合法行情都不允許污染 price feed。

## 11. buildMatchCandleKey

~~~go
return fmt.Sprintf("%019d", math.MaxInt64-timestamp)
~~~

- 反轉 timestamp，讓新 candle 的 key 排序位置較前。
- 19 位固定寬度，避免字串排序錯亂。
- symbol 已由 collection 隔離。

## 12. marketCandleCollection

~~~go
normalized := strings.NewReplacer("/", "_", "-", "_", " ", "_").
	Replace(strings.ToLower(strings.TrimSpace(symbol)))
return marketCandleCollectionPrefix + normalized
~~~

- 清除空白、轉小寫。
- slash、連字號、空白改成底線。
- prefix 形成穩定的 indexed collection 名稱。

## 13. cleanupMarketCandleRetention

~~~go
collection := marketCandleCollection(symbol)
maintenanceKey := "market_cleanup:" + collection
maintenance, version, err := readFinanceMaintenanceCursor(ctx, nk, maintenanceKey)
if err != nil {
	logger.Warn("Market retention cursor read failed symbol=%s: %v", symbol, err)
	return
}
~~~

- maintenanceKey 保存該 collection 的清理進度。
- cursor 與 version 支援分頁續跑及 CAS。
- maintenance 失敗只記 warning，不阻斷交易。

~~~go
objects, nextCursor, err := nk.StorageList(ctx, "", "", collection,
	marketCandleRetentionBatchSize, maintenance.Cursor)
if err != nil { logger.Warn("Market retention list failed symbol=%s: %v", symbol, err); return }
cutoff := time.Now().UTC().Add(-marketCandleRetention).UnixMilli()
deletes := make([]*runtime.StorageDelete, 0)
~~~

- 每次只掃固定 batch，控制維護成本。
- cutoff 是保留期限界線。
- deletes 收集本批過期 records。

~~~go
if json.Unmarshal([]byte(object.GetValue()), &candle) == nil && candle.Timestamp < cutoff {
	deletes = append(deletes, &runtime.StorageDelete{
		Collection: collection, Key: object.GetKey(), UserID: "", Version: object.GetVersion(),
	})
}
if len(deletes) > 0 {
	if err := nk.StorageDelete(ctx, deletes); err != nil {
		logger.Warn("Market retention delete failed symbol=%s: %v", symbol, err)
	}
}
~~~

- 只有有效 candle 且早於 cutoff 才加入刪除。
- object version 可降低刪到已更新 record 的風險。
- 批次刪除失敗時保留 warning，下一輪重試。

~~~go
maintenance.Cursor = nextCursor
maintenance.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
	Collection: collectionFinanceMaintenance, Key: maintenanceKey, UserID: "",
	Value: mustJSON(maintenance), Version: version,
	PermissionRead: 0, PermissionWrite: 0,
}}); err != nil {
	logger.Warn("Market retention cursor write failed symbol=%s: %v", symbol, err)
}
~~~

- 保存下一頁 cursor。
- Version 避免多個 maintenance worker 無條件互相覆蓋。
- 清理 projection 也只允許 server 寫入。

## 14. defaultMatchPrices

~~~go
func defaultMatchPrices() map[string]int64 {
	return map[string]int64{"BTC/USDT": 65000}
}
~~~

- 回傳標的到預設價格的 map。
- 65000 只作為 bootstrap 參考值。

## 15. applyMatchSlippage

~~~go
if price <= 0 { return 0, 0 }
slippage := calculateBpsCeil(price, 10)
if side == "sell" { return maxInt64(1, price-slippage), slippage }
return price + slippage, slippage
~~~

- 無效價格直接停止。
- 10 bps 由 calculateBpsCeil 計算向上取整滑價。
- sell 使用低於參考價的價格，buy 使用高於參考價的價格。
- maxInt64 確保 sell 價格至少為 1。

## 16. maxInt64

~~~go
if left > right { return left }
return right
~~~

- 回傳兩個 int64 中較大的值。
- 目前用於 sell 滑價的最低價格保護。

## 資料流

~~~text
price-feed worker
  -> rpcIngestMatchCandlesHandler
  -> validateMatchCandle
  -> Nakama Storage
  -> rpcListMatchCandlesHandler
  -> listMarketCandles
  -> 前端 K 線與行情面板
~~~

- 行情 ingestion 由 server secret 保護。
- candles 與最新 price projection 由 storage 保存。
- authoritative match 從 server price projection 讀取價格。
