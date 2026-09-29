# runtime_market_models.go 逐行 Code Review

此檔只定義 market payload 與 storage models，沒有 function。

## 1. Candle ingestion payload
```go
// L1
type matchCandleIngestPayload struct { Secret string `json:"secret"`; Symbol string `json:"symbol"`; Source string `json:"source"`; Candles []matchCandleRecord `json:"candles"` }
```
- `L1`：price worker 送入 ingestion RPC 時帶 secret、標的、來源與 candle 陣列；handler 仍會驗證 secret 與資料範圍。

## 2. Candle list payload
```go
// L1
type matchCandleListPayload struct { Symbol string `json:"symbol"`; Limit int `json:"limit"` }
```
- `L1`：前端請求 candles 時指定 symbol 與數量；後端會再限制 limit。

## 3. Price 與 candle record
```go
// L1
type matchPriceRecord struct { Symbol string `json:"symbol"`; Price int64 `json:"price"`; UpdatedAt string `json:"updatedAt"`; Source string `json:"source"` }
// L2
type matchCandleRecord struct { Symbol string `json:"symbol"`; Round int `json:"round"`; Open int64 `json:"open"`; High int64 `json:"high"`; Low int64 `json:"low"`; Close int64 `json:"close"`; Volume int64 `json:"volume"`; Timestamp int64 `json:"timestamp"`; Source string `json:"source"`; UpdatedAt string `json:"updatedAt"` }
```
- `L1`：最新價格保存 symbol、整數價格、server 更新時間與來源；freshness 依 UpdatedAt/Source 判定。
- `L2`：OHLCV candle 全以整數保存，並保留來源與更新時間供稽核。
