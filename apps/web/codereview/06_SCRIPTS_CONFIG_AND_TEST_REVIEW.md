# 設定、行情 Worker 與前端測試 Code Review

## 1. 前端環境變數

檔案：[.env.example](/C:/Users/kdsam/Documents/nakama-duel/apps/web/.env.example)

- `NEXT_PUBLIC_NAKAMA_HOST`、`PORT`、`SERVER_KEY`、`USE_SSL`：瀏覽器建立 Nakama client 所需的公開連線設定。
- `NEXT_PUBLIC_NAKAMA_*_RPC_ID`：前端呼叫的 RPC 名稱；名稱必須與 Go runtime registry 一致。
- `NEXT_PUBLIC_NAKAMA_LEADERBOARD_ID`：前端讀取的 leaderboard id。
- `MATCH_PRICE_INGEST_SECRET` 與 `NAKAMA_INGEST_MATCH_CANDLES_RPC_ID`：行情 ingestion 使用，不能被 client bundle 讀取；目前這份 example 混合了 browser 與 worker 設定，正式部署應拆成 browser env 與 worker env。
- `MATCH_PRICE_EXCHANGE`、`SYMBOL`、`TIMEFRAME`、`LIMIT`、`POLL_INTERVAL_MS`：price worker 設定，不是交易 UI 的 authoritative rule。

凡是 `NEXT_PUBLIC_` 前綴的變數都會暴露到瀏覽器。secret、webhook、ingestion key、admin RPC 權限不能使用此前綴。

## 2. price-feed worker

檔案：[scripts/price-feed-worker.mjs](/C:/Users/kdsam/Documents/nakama-duel/apps/web/scripts/price-feed-worker.mjs)

- `loadEnvFile()`：讀取 worker 執行環境的 env file。
- `requireEnv()`：缺少必要設定時立即失敗。
- `toPrice()`：將交易所價格正規化為有限數字。
- `classifyExchangeError()`：區分 network、exchange rejected 等錯誤類型。
- `logEvent()`：輸出結構化 heartbeat/error log。
- `sendAlert()`：連續失敗時輸出告警或呼叫 webhook；webhook secret 不能出現在 browser env。
- `getSession()`：建立或重用 Nakama device session。
- `ingestOnce()`：從 CCXT 取得 OHLCV，驗證資料後呼叫 protected ingestion RPC。
- `main()`：依 poll interval 執行；成功後恢復正常週期，失敗後使用 exponential backoff。

worker 是 server-side 行情供應者，不是前端直接行情來源。Finance match 仍會檢查 storage 中的 `priceUpdatedAt` 與 stale deadline。

## 3. 一次性 ingestion

檔案：[scripts/ingest-btc-candles.mjs](/C:/Users/kdsam/Documents/nakama-duel/apps/web/scripts/ingest-btc-candles.mjs)

- `loadEnvFile()`：載入本地 worker 設定。
- `requireEnv()`：確認 RPC id、secret、Nakama endpoint 存在。
- `toPrice()`：把外部資料轉成可送 payload。
- `main()`：抓取一批 BTC/USDT OHLCV，呼叫 ingestion RPC 作 bootstrap。

## 4. Integration smoke

檔案：[scripts/integration-smoke.mjs](/C:/Users/kdsam/Documents/nakama-duel/apps/web/scripts/integration-smoke.mjs)

- `identity()` / `uniqueIdentity()`：建立一次性測試帳號，避免污染固定使用者。
- `parseRpc()`：檢查 RPC response 是否成功並解析 payload。
- `waitForMessage()`：等待 chat socket message，驗證即時送達。
- `main()`：驗證 auth、friend、community、guild、leaderboard 與 chat 基本流程。

## 5. Finance smoke

檔案：[scripts/finance-duel-smoke.mjs](/C:/Users/kdsam/Documents/nakama-duel/apps/web/scripts/finance-duel-smoke.mjs)

- `loadEnv()`：載入 Nakama endpoint 與 server key。
- `identity()`：建立兩個測試 identity。
- `waitForState()`：等待符合 predicate 的 authoritative snapshot，不以 sleep 猜對局狀態。
- `waitForMatchmaker()`：等待配對通知。
- `decode()`：解碼 socket data。
- `main()`：驗證配對、雙方加入、確認、fresh market、order、round snapshot、finish、rating 與 history。

測試應保持 price-feed 與 Nakama runtime 運行；若行情 stale，order 被拒絕是預期結果，不應在 test 裡繞過 stale protection。

## 6. package scripts

檔案：[package.json](/C:/Users/kdsam/Documents/nakama-duel/apps/web/package.json)

- `dev`：Next 開發 server。
- `build`：production compile、type check 與 static generation。
- `lint`：ESLint。
- `test:integration:smoke`：社群與聊天 smoke。
- `test:finance-duel`：finance E2E smoke。
- `price-feed:btc`：一次性行情 ingestion。
- `price-feed:worker`：長駐行情 worker。

## 7. Review 結論

目前有 TypeScript、ESLint、Next build 與兩組 smoke script。後續應再加入 component interaction test，至少涵蓋 mobile trade ticket、Dialog Escape/cancel、reconnect retry、history cursor merge；這些不是純 compile 可以發現的行為。
