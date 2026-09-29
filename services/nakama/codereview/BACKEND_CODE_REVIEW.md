# Nakama 後端架構 Code Review 總覽

本文件是 `services/nakama` 後端的 top-down review 入口，涵蓋目前所有 Go 原始碼、測試、Nakama 設定、Docker、Compose、環境變數範本、Go module 與部署文件。

這份文件回答三個問題：

1. 每個後端檔案負責什麼。
2. 檔案之間如何串接成完整請求流程。
3. Review 時應從哪個入口往下追蹤。

逐行語法與變數解釋放在同目錄的 `*_go_review.md`；本文件不重複逐行內容，而是說明責任邊界、資料流和相依關係。

---

## 1. 整體架構

```text
瀏覽器 / apps/web
  | HTTP RPC：配對、歷史、K 線、公會、管理指標
  | WebSocket：確認、下單、撤單、狀態請求、投降
  v
Nakama HTTP / Realtime API
  | 驗證 session、維護 presence、執行 match tick
  v
backend.so（services/nakama/*.go）
  |-- runtime.go：註冊入口
  |-- runtime_security.go：RPC 限流
  |-- runtime_market*.go：市場資料
  |-- runtime_finance*.go：配對、交易與結算
  |-- runtime_community*.go：排行榜與公會
  |-- runtime_maintenance.go：租約與背景補償
  v
Nakama Storage / Leaderboard / Group API
  v
PostgreSQL

price-feed worker
  -> 交易所 OHLCV
  -> HMAC 簽章的 ingest_match_candles RPC
  -> market storage
  -> authoritative finance match
```

後端的 authoritative 邊界是：客戶端只能提交「意圖」，不能直接指定成交結果、投組餘額、NAV、勝方、Rating 或排行榜分數。這些結果必須由 Go runtime 計算並保存。

---

## 2. 啟動與部署檔案

### 2.1 `Dockerfile`

位置：[Dockerfile](../Dockerfile)

- 第一階段使用與 Nakama `3.38.0` ABI 相容的 plugin builder。
- 複製 `go.mod`、`go.sum` 後下載依賴，再複製所有 `*.go`。
- 使用 `go build --buildmode=plugin` 產生 `backend.so`。
- 第二階段使用 Nakama server image，將 plugin 放到 `/nakama/data/modules/`。
- 將 `local.yml` 放到容器內，讓 Nakama 啟動時載入 plugin。

Review 重點：Nakama image 與 plugin builder 版本必須一致；新增 Go 檔會被 `COPY *.go` 自動納入，但非 Go 資產不會自動複製。

### 2.2 `docker-compose.yml`

位置：[docker-compose.yml](../docker-compose.yml)

本機開發編排包含：

- `postgres`：保存 Nakama 核心資料、storage、leaderboard 與 group。
- `nakama`：先執行 migration，再啟動 Nakama 並載入 `backend.so`。
- `price-feed`：定期抓取 BTC/USDT candles，簽章後呼叫 ingestion RPC。

本機會暴露 PostgreSQL、HTTP、gRPC 與 Console port，方便開發，但不應直接套用到正式環境。

### 2.3 `docker-compose.production.yml`

位置：[docker-compose.production.yml](../docker-compose.production.yml)

- 正式環境用的獨立 Compose 設定。
- 重要 secret 必須由 `.env.production` 注入，不接受開發預設值。
- Nakama API 預設只綁定 `127.0.0.1:7350`，預期由 TLS reverse proxy 對外提供服務。
- 不公開 PostgreSQL、gRPC 與 Nakama Console。
- 關閉 client score submission、direct finance match 與 bootstrap market data。

Review 重點：確認部署主機前方有 TLS、WAF/API gateway、集中式限流及 secret manager。

### 2.4 `local.yml`

位置：[local.yml](../local.yml)

- 設定本機 Nakama node、logger、Console、runtime module path、session 與 socket。
- `runtime.path` 指向 Dockerfile 放置 `backend.so` 的目錄。
- `socket.server_key` 是 Nakama client 連線用 key，不等同管理員 secret。
- 目前內容含本機固定 key、DEBUG logger 與 Console 帳密，只適合本機開發。

Review 重點：不要把此檔的固定 key 當正式 secret；正式 Compose 會用啟動參數覆寫敏感設定。

### 2.5 環境變數檔案

- [.env.example](../.env.example)：一般開發環境的完整變數範本。
- [.env.production.example](../.env.production.example)：正式部署必填與安全預設範本。
- `.env`：本機實際值，應由 `.gitignore` 排除，不應提交真實 secret。

主要變數群組：

- 市場 ingestion：`MATCH_PRICE_INGEST_SECRET`、簽章、nonce、symbol/source allowlist。
- 市場風控：最大 candle age、future skew、價格最大跳動與 bootstrap 開關。
- Finance 權限：管理員 user ID、client score 與 direct match 開關。
- Price worker：輪詢、退避、alert webhook 與交易所參數。
- PostgreSQL/Nakama：資料庫密碼、server key、session key、Console key。

### 2.6 Go module 與輔助檔

- [go.mod](../go.mod)：定義 module、Go 版本與 Nakama runtime/API 依賴。
- [go.sum](../go.sum)：鎖定依賴 checksum，確保可重現建置。
- [.dockerignore](../.dockerignore)：避免將無關檔案與 secret 傳入 Docker build context。
- [README.md](../README.md)：本機啟動、runtime ID 與基本操作入口。
- [DEPLOYMENT.md](../DEPLOYMENT.md)：正式環境 secret、網路邊界、備份及監控要求。

---

## 3. Runtime 核心與共用層

### 3.1 `runtime.go`

位置：[runtime.go](../runtime.go)
逐行文件：[runtime_go_review.md](runtime_go_review.md)

這是 Go plugin 唯一啟動入口：

- `InitModule` 建立 leaderboard、選擇性建立 bootstrap market data。
- 註冊 `finance_authoritative_match` authoritative handler。
- 註冊 Nakama matchmaker matched callback。
- 建立 RPC ID 與 handler 對照表。
- 每個 RPC 在註冊前都經過 `withRPCRateLimit` 包裝。

相依：`runtime_config.go`、`runtime_security.go`、所有 RPC handler 與 finance match handler。

### 3.2 `runtime_config.go`

位置：[runtime_config.go](../runtime_config.go)
逐行文件：[runtime_config_go_review.md](runtime_config_go_review.md)

集中保存跨模組 contract：

- RPC ID、match module name、leaderboard ID。
- Finance WebSocket opcode。
- Storage collection 名稱。
- 回合、倒數、斷線期限、價格 freshness、費率、滑價與 Rating 常數。
- 訊息限流、清理週期、保留期、maintenance lease 與 gRPC error code。

Review 重點：前後端 opcode 必須一致；修改金額比例、保留期或 collection 名稱都可能影響既有資料。

### 3.3 `runtime_rpc_helpers.go`

位置：[runtime_rpc_helpers.go](../runtime_rpc_helpers.go)
逐行文件：[runtime_rpc_helpers_go_review.md](runtime_rpc_helpers_go_review.md)

提供所有 RPC 共用的小型工具：

- 從 Nakama context 取得並驗證 user ID。
- 將 JSON payload 解析成泛型 struct。
- 將 response/storage record 序列化成 JSON。
- 產生一致的 invalid argument、permission denied、resource exhausted 等 gRPC error。

相依：幾乎所有 RPC handler。Review handler 時應先確認是否呼叫 `requireUserID` 與 `parsePayload`。

### 3.4 `runtime_security.go`

位置：[runtime_security.go](../runtime_security.go)
逐行文件：[runtime_security_go_review.md](runtime_security_go_review.md)

- `withRPCRateLimit` 包裝 RPC，先限流再執行實際 handler。
- 依 RPC 類型選擇不同 fixed-window policy。
- 優先以 authenticated user ID 建立限流 key，未登入時退回 client IP。
- 提供共用 environment bool、integer、list parser。

限制：計數器位於單一 Nakama process 記憶體；多節點正式環境仍需 gateway 或共享式限流。

### 3.5 `runtime_security_test.go`

位置：[runtime_security_test.go](../runtime_security_test.go)

- 驗證 fixed-window 內允許次數。
- 驗證超額請求被拒絕。
- 驗證時間窗切換後可重新請求。

### 3.6 `runtime_maintenance.go`

位置：[runtime_maintenance.go](../runtime_maintenance.go)
逐行文件：[runtime_maintenance_go_review.md](runtime_maintenance_go_review.md)

- 使用 Nakama Storage version CAS 取得 maintenance lease。
- 防止多個 match 或多節點同時執行相同清理工作。
- 重試尚未完成的 finance leaderboard projection outbox。
- 被 market nonce/candle 清理及 finance idempotency 清理共用。

Review 重點：maintenance 是 best-effort 補償，不應阻塞 match tick；失敗必須保留可重試資料。

---

## 4. 市場資料模組

### 4.1 `runtime_market_models.go`

位置：[runtime_market_models.go](../runtime_market_models.go)
逐行文件：[runtime_market_models_go_review.md](runtime_market_models_go_review.md)

定義市場資料 contract：

- ingestion payload：symbol、source、candles、sentAt、nonce、signature。
- nonce storage record：防止同一簽章重播。
- candle list payload：symbol 與 limit。
- latest price record：價格、來源與更新時間。
- OHLCV candle record。

市場安全測試逐行文件：[runtime_market_test_go_review.md](runtime_market_test_go_review.md)

### 4.2 `runtime_market.go`

位置：[runtime_market.go](../runtime_market.go)
逐行文件：[runtime_market_go_review.md](runtime_market_go_review.md)

主要責任：

- `rpcIngestMatchCandlesHandler` 接收受保護的 price-feed ingestion。
- 驗證 HMAC-SHA256、時間偏差、一次性 nonce、symbol/source allowlist。
- 驗證 OHLCV、最新 candle 時間與短期價格最大跳動。
- 寫入 symbol-specific candle collection 和 latest price projection。
- `rpcListMatchCandlesHandler` 讓已登入玩家讀取 candles。
- 在新 collection 尚無資料時，暫時讀取舊 shared collection 相容資料。
- 清理過期 candles 與 ingestion nonce。
- bootstrap market data 僅在明確環境開關下建立，而且永遠標記為不可交易。
- 計算 market order 的 server-side slippage。

主要資料流：

```text
price-feed
  -> HMAC payload
  -> rpcIngestMatchCandlesHandler
  -> 驗證 + nonce claim
  -> market candle/latest price storage
  -> financeRefreshPrice
  -> finance match state + marketStale
```

### 4.3 `runtime_market_test.go`

位置：[runtime_market_test.go](../runtime_market_test.go)

- 驗證 symbol/source allowlist。
- 驗證 HMAC 正確、錯誤與過期 payload。
- 驗證 stale/future candle。
- 包含 Node worker 與 Go runtime 共用簽章向量，避免 canonical payload 格式漂移。

---

## 5. Finance 模組

### 5.1 `runtime_finance_models.go`

位置：[runtime_finance_models.go](../runtime_finance_models.go)
逐行文件：[runtime_finance_models_go_review.md](runtime_finance_models_go_review.md)

定義 Finance 全部 state 與 storage schema：

- `financeAuthoritativeMatchState`：arena 的唯一 server state。
- `financePortfolio`：cash、BTC、平均成本、P&L、NAV、return。
- `financeOrder` / `financeOrderIntent`：server order 與 client intent。
- `financeFillRecord`：成交價、數量、fee、tax、slippage。
- `financePortfolioSnapshotRecord`：每回合投組時間序列。
- `financeGameRecord`：完成對局結果。
- `financePlayerStatsRecord` / `financeRatingChange`：Rating 與戰績 projection。
- `financeMatchmakingRecord`：queue token、status、確認期限、match ID、lease。
- `financeOrderIdempotencyRecord`：client order 的最近 authoritative 結果。
- `financeArenaIndexRecord`：arena 對 orders/fills/snapshots 的索引。
- `financeSystemMetrics`：等待時間、stale 秒數、拒單原因等營運指標。
- `financeLeaderboardProjectionRecord`：排行榜 outbox。

金額使用 cents、BTC 使用 micros，避免浮點誤差。

### 5.2 `runtime_finance_matchmaking.go`

位置：[runtime_finance_matchmaking.go](../runtime_finance_matchmaking.go)
逐行文件：[runtime_finance_matchmaking_go_review.md](runtime_finance_matchmaking_go_review.md)

- `rpcFinanceMatchmakingHandler` 處理 begin、cancel、status。
- `QueueToken` 區分同一使用者不同次排隊，避免舊 matchmaker entry 配到新佇列狀態。
- `financeMatchmakerMatched` 接收 Nakama 配對結果並建立 authoritative arena。
- `claimFinanceMatchmaking` 以 storage 狀態與 queue token 原子式確認配對資格。
- 雙方必須在期限內主動確認。
- 對手取消時，留下者回到 searching；自己取消時回到 cooldown/大廳。
- lease recovery 修復卡在 searching、matching、matched 或 running 的過期 record。
- direct match RPC 正式環境預設停用，只保留測試／管理用途開關。

狀態流程：

```text
idle/cooldown -> searching -> matching -> matched -> running
                       |          |          |
                       |          |          +-> finished/canceled
                       |          +-> confirmation timeout
                       +-> cancel/recovery
```

### 5.3 `runtime_finance_match.go`

位置：[runtime_finance_match.go](../runtime_finance_match.go)
逐行文件：[runtime_finance_match_go_review.md](runtime_finance_match_go_review.md)

實作 Nakama `runtime.Match` lifecycle：

- `MatchInit`：建立 arena state、讀取 server market price、設定 tick rate。
- `MatchJoinAttempt`：限制只有配對玩家可加入。
- `MatchJoin`：綁定 presence、處理 reconnect、送 directed snapshot。
- `MatchLeave`：記錄離線 tick，開始斷線寬限期。
- `MatchLoop`：每秒處理訊息、確認倒數、開局、行情、回合、掛單、snapshot、結算、斷線與 maintenance。
- `financeFinish`：由 NAV 或 forfeit 規則決定結果，保存 game/stats 並投影排行榜。
- `financeBroadcastState`：依玩家產生隱藏對手敏感資訊的個人化 snapshot。
- `financeOpponentLeadStatus`：只提供模糊化領先狀態。
- `MatchTerminate` / `MatchSignal`：符合 Nakama match interface。

### 5.4 `runtime_finance_orders.go`

位置：[runtime_finance_orders.go](../runtime_finance_orders.go)
逐行文件：[runtime_finance_orders_go_review.md](runtime_finance_orders_go_review.md)

- `financeHandleMessage` 依 opcode 分派 ready、confirmation、order、cancel、state request、resign。
- `financeAllowMessage` 限制單一玩家每個 server tick 的交易與 state request 數量。
- `financeAcceptOrder` 驗證對局、行情、side、type、quantity、cash、持倉與 client order ID。
- idempotency lookup 防止重送建立重複訂單。
- `financeTryFillOrder` 依 server price、slippage、fee、tax 更新 cash 與 BTC。
- `financeProcessOpenOrders` 在價格變動後處理 limit orders。
- `financeRefreshPrice` 每回合重新讀取 server latest price。
- `financeMarkPortfolios` 重算 unrealized P&L、NAV 與 return。
- 其餘 helper 計算保留資金、可賣數量、名目金額、可負擔數量與 NAV winners。

### 5.5 `runtime_finance_math.go`

位置：[runtime_finance_math.go](../runtime_finance_math.go)
逐行文件：[runtime_finance_math_go_review.md](runtime_finance_math_go_review.md)

- `calculateBpsCeil` 以整數 basis points 計算並向上取整。
- 被 fee、tax、slippage 等金額計算使用。
- 集中整數運算，避免不同 handler 各自實作造成規則不一致。

### 5.6 `runtime_finance_persistence.go`

位置：[runtime_finance_persistence.go](../runtime_finance_persistence.go)
逐行文件：[runtime_finance_persistence_go_review.md](runtime_finance_persistence_go_review.md)

負責 Finance 寫入與 projection：

| Collection | 內容 | 性質 |
| --- | --- | --- |
| `finance_snapshots` | arena 最新 state | 可覆寫 projection |
| `finance_events` | authoritative event | append-only |
| `finance_orders` | order 最新狀態 | 可覆寫 projection |
| `finance_fills` | 每筆成交 | append-only |
| `finance_portfolio_snapshots` | 每回合玩家投組 | append-only |
| `finance_games` | 完成對局 | final record |
| `finance_player_stats` | Rating、勝敗和平 | CAS projection |
| `finance_player_history` | 個人歷史索引 | cursor source |
| `finance_order_idempotency` | client order 結果 | 有保留期限 |
| `finance_arena_index` | arena 子資料 key | 查詢索引 |
| `finance_metrics` | 分片營運指標 | 管理員資料 |
| `finance_leaderboard_projection` | 待投影排行榜 | outbox |

關鍵機制：

- append event 後透過 WebSocket 即時廣播。
- order 與 fill 保存完整費用明細。
- 每回合保存 portfolio snapshot。
- 使用 CAS retry 更新玩家 stats，降低並行 read-modify-write 遺失更新。
- 完成對局與 leaderboard outbox 同批寫入；排行榜失敗時可由 maintenance 重試。
- idempotency record 設有到期時間並分頁清理。
- metrics 以時間 shard 累加，降低單一 key 寫入競爭。

### 5.7 `runtime_finance_history.go`

位置：[runtime_finance_history.go](../runtime_finance_history.go)
逐行文件：[runtime_finance_history_go_review.md](runtime_finance_history_go_review.md)

- `rpcListFinanceHistoryHandler` 只回傳目前玩家可讀的 stats、games、orders、fills 與 snapshots。
- history 使用 storage cursor 分頁，不固定掃描全部對局。
- arena 資料先驗證使用者是否為該局玩家，再依 user ID 過濾。
- arena index 避免每次掃描整個 collection；legacy backfill 僅供舊資料過渡。
- `rpcGetFinanceMetricsHandler` 與玩家 history 分離，只允許管理員 allowlist。
- 讀取 BTC price 並判定 freshness 的 helper 供 match 使用。

### 5.8 `runtime_finance_test.go`

位置：[runtime_finance_test.go](../runtime_finance_test.go)
逐行文件：[runtime_finance_test_go_review.md](runtime_finance_test_go_review.md)

涵蓋：

- BTC micros 與 cents 精度。
- 每 tick 訊息限流。
- basis points fee/slippage。
- 行情 freshness 與 bootstrap 不可交易。
- idempotency retention cleanup。
- candle index key。
- matchmaking lease recovery。
- metrics shard merge。

這些是純 Go 單元測試；WebSocket、Storage 與雙玩家流程仍要由 integration/smoke test 補足。

---

## 6. Community 與 Guild 模組

Community top-down 索引：[runtime_community_go_review.md](runtime_community_go_review.md)

### 6.1 `runtime_community_models.go`

位置：[runtime_community_models.go](../runtime_community_models.go)
逐行文件：[runtime_community_models_go_review.md](runtime_community_models_go_review.md)

定義 guild RPC payload、membership/config/join request/audit/idempotent operation storage record，以及 leaderboard response view。

### 6.2 `runtime_community_helpers.go`

位置：[runtime_community_helpers.go](../runtime_community_helpers.go)
逐行文件：[runtime_community_helpers_go_review.md](runtime_community_helpers_go_review.md)

- 查找 group user 與正規化 membership state。
- 檢查 community membership、guild manager/owner 權限。
- 計算角色升級到 owner 所需步驟。
- 驗證分數與 score submission policy。
- 將 Nakama leaderboard record 轉成前端摘要。

### 6.3 `runtime_community_storage.go`

位置：[runtime_community_storage.go](../runtime_community_storage.go)
逐行文件：[runtime_community_storage_go_review.md](runtime_community_storage_go_review.md)

- 讀寫 guild membership、config、join request、audit 與 operation idempotency。
- 列出 guild members、join requests、audit log。
- 驗證 manager/owner 權限。
- reconciliation 修復 Nakama group roster 與 storage projection 差異。
- 建立穩定 storage key。
- `newGuildAudit` 建立事件；`appendGuildAudit` 負責保存既有事件 record。

### 6.4 `runtime_community_views.go`

位置：[runtime_community_views.go](../runtime_community_views.go)
逐行文件：[runtime_community_views_go_review.md](runtime_community_views_go_review.md)

- 將 Nakama group members 與 leaderboard contribution 組合成 UI view。
- 計算 guild total/average contribution。
- 將 guild average leaderboard record 轉成摘要。

### 6.5 `runtime_community_score.go`

位置：[runtime_community_score.go](../runtime_community_score.go)
逐行文件：[runtime_community_score_go_review.md](runtime_community_score_go_review.md)

- 回傳 phase config 與 authoritative score policy。
- client 直接提交 portfolio score 正式環境預設拒絕。
- Finance 對局結算後，以 server 計算的 `ReturnBps` 投影個人與 guild leaderboard。
- 更新 guild weekly average leaderboard。
- leaderboard 投影失敗時由 finance outbox/maintenance 補償。

### 6.6 `runtime_community_guild_lifecycle.go`

位置：[runtime_community_guild_lifecycle.go](../runtime_community_guild_lifecycle.go)
逐行文件：[runtime_community_guild_lifecycle_go_review.md](runtime_community_guild_lifecycle_go_review.md)

- 建立 guild 並建立 owner membership/config/audit。
- 玩家離開 guild，owner 不可直接離開而必須先轉移或解散。
- owner 解散 guild，清理 membership/config/request projection 並留下 audit/operation 結果。

### 6.7 `runtime_community_guild_members.go`

位置：[runtime_community_guild_members.go](../runtime_community_guild_members.go)
逐行文件：[runtime_community_guild_members_go_review.md](runtime_community_guild_members_go_review.md)

- 邀請玩家加入 guild。
- 建立 join request。
- manager 核准或拒絕 request。
- manager 踢除一般成員。
- 每次操作同步 Nakama group roster、storage projection 與 audit。

### 6.8 `runtime_community_guild_governance.go`

位置：[runtime_community_guild_governance.go](../runtime_community_guild_governance.go)
逐行文件：[runtime_community_guild_governance_go_review.md](runtime_community_guild_governance_go_review.md)

- 升級／降級 guild admin。
- 轉移 owner。
- 更新 guild settings。
- 以 manager/owner 權限與 operation idempotency 保護治理操作。

### 6.9 `runtime_community_guild_queries.go`

位置：[runtime_community_guild_queries.go](../runtime_community_guild_queries.go)
逐行文件：[runtime_community_guild_queries_go_review.md](runtime_community_guild_queries_go_review.md)

- 列出 guild join requests。
- 組合 guild detail、member、contribution、settings 與 audit view。
- 使用受限制的 SQL 查詢搜尋使用者。

### 6.10 `runtime_community_test.go`

位置：[runtime_community_test.go](../runtime_community_test.go)

- 驗證 guild role authorization。
- 驗證 owner promotion 步數。
- 驗證 explicit operation ID 會形成穩定 idempotency key。

### 6.11 舊索引文件說明

`runtime_community_guild_handlers_go_review.md` 是拆分 guild handler 前的導覽索引，不對應目前單一 `.go` 檔。應由它連到 lifecycle、members、governance、queries 四份實際 review，而不應再把它視為可編譯原始碼。

---

## 7. 完整請求流程

### 7.1 玩家按下 Match

```text
apps/web
  -> finance_matchmaking RPC(action=begin)
  -> runtime.go RPC registry
  -> withRPCRateLimit
  -> rpcFinanceMatchmakingHandler
  -> writeFinanceMatchmaking(status=searching, QueueToken=...)
  -> Nakama MatchmakerAdd
  -> financeMatchmakerMatched
  -> claimFinanceMatchmaking
  -> MatchCreate(finance_authoritative_match)
  -> 雙方確認
  -> MatchLoop 進入 3 秒開局倒數
```

### 7.2 玩家下單

```text
WebSocket financeOrderOpCode
  -> MatchLoop
  -> financeHandleMessage
  -> financeAllowMessage
  -> financeAcceptOrder
  -> idempotency lookup
  -> financeTryFillOrder / open limit order
  -> financeMarkPortfolios
  -> persist order/fill/idempotency/event/snapshot
  -> financeBroadcastState
```

### 7.3 每回合與結算

```text
MatchLoop tick
  -> financeRefreshPrice
  -> freshness check
  -> process open orders
  -> mark portfolios
  -> persist round portfolios
  -> 5 分鐘結束或 forfeit
  -> financeFinish
  -> persist game + CAS stats + history + leaderboard outbox
  -> immediate leaderboard projection
  -> maintenance retry（失敗時）
```

### 7.4 公會治理操作

```text
Guild RPC
  -> session + RPC rate limit
  -> parse payload
  -> manager/owner authorization
  -> operation idempotency lookup
  -> Nakama Group API mutation
  -> membership/config projection
  -> guild audit
  -> operation result storage
```

---

## 8. Storage 與一致性模型

後端不是把所有資料都當成同一種紀錄：

- **Authoritative in-memory state**：正在執行的 finance match 真相來源。
- **Latest projection**：snapshot、order、stats，可由同 key 更新。
- **Append-only log**：event、fill、round portfolio，供稽核與 replay。
- **Index projection**：player history、arena index，避免全 collection 掃描。
- **Idempotency record**：記錄已處理 client intent/operation，防止重送副作用。
- **Outbox**：完成對局與待投影 leaderboard 同批保存，外部投影可重試。
- **Maintenance lease**：用 CAS 確保同一背景工作在租約內只由一個執行者處理。

Review 每次 storage 寫入時要問：

1. 這筆資料是 final record、append-only log 還是可重建 projection？
2. 重送同一請求是否會重複扣款、成交或改變 guild roster？
3. 多個 match/node 同時寫入時是否需要 CAS？
4. 外部 API 成功但 storage 失敗時如何 reconciliation？
5. 資料是否有 index、cursor、保留期與清理策略？

---

## 9. 權限與安全 Review

### 玩家可提交

- Matchmaking begin/cancel/status。
- Ready/confirmation、order intent、cancel intent、state request、resign。
- 自己有權執行的 guild intent。
- 已登入後讀取 candles 與自己的 history。

### 玩家不可直接指定

- 成交價、fee、tax、slippage。
- cash、BTC、P&L、NAV、return。
- winner、finish reason、Rating、leaderboard score。
- 對手完整即時 portfolio。
- 管理員 finance metrics。
- 市場 ingestion 結果。

### 現有防線

- Nakama session context 與 `requireUserID`。
- RPC process-local rate limit。
- Match participant 驗證與 per-tick intent limit。
- HMAC、timestamp、nonce、allowlist 保護 price ingestion。
- Order/guild operation idempotency。
- Storage permission 設定與 server-only collection。
- Admin user ID allowlist。
- 正式環境停用 direct score/direct match/bootstrap price。

### 仍需外部基礎設施補強

- TLS reverse proxy、WAF/API gateway。
- 多節點共享限流。
- Secret manager 與定期 rotation。
- PostgreSQL 最小權限、備份、PITR 與還原演練。
- Prometheus/OpenTelemetry、集中式 log 與告警。

---

## 10. 測試與驗證順序

### Go 靜態與單元測試

```powershell
cd C:\Users\kdsam\Documents\nakama-duel\services\nakama
gofmt -w *.go
go test ./...
go vet ./...
```

### Compose 設定

```powershell
docker compose config --quiet
docker compose --env-file .env.production -f docker-compose.production.yml config --quiet
```

### 完整環境

```powershell
docker compose up --build
docker compose logs -f nakama price-feed
```

### 前端與端到端

```powershell
cd C:\Users\kdsam\Documents\nakama-duel
cmd /c npm run lint
cmd /c npm run build
cmd /c npm run test:finance-duel
```

Review 不應只看 `go test`。市場 ingestion、雙玩家 WebSocket、reconnect、matchmaking timeout、Storage CAS、outbox retry 與 Docker plugin 載入都需要實際 integration test。

---

## 11. 建議的 Top-down Review 順序

1. 先讀 `DEPLOYMENT.md`、兩份 Compose、`Dockerfile`、`local.yml`，確認信任邊界與啟動方式。
2. 讀 `runtime.go`，列出所有公開 RPC、match handler 與 callback。
3. 讀 `runtime_config.go`、`runtime_rpc_helpers.go`、`runtime_security.go`，理解 contract、錯誤與共用防線。
4. 讀 `runtime_market_models.go`、`runtime_market.go`，追蹤價格如何成為可交易的 server price。
5. 讀 `runtime_finance_models.go`、`runtime_finance_matchmaking.go`、`runtime_finance_match.go`，理解配對與 state machine。
6. 讀 `runtime_finance_orders.go`、`runtime_finance_math.go`，核對現貨限制與所有資金公式。
7. 讀 `runtime_finance_persistence.go`、`runtime_finance_history.go`、`runtime_maintenance.go`，檢查一致性、分頁、補償與清理。
8. 讀 Community 的 models/helpers/storage，再讀 lifecycle/members/governance/queries/score/views。
9. 最後讀全部 `*_test.go`，將每項重要規則對應到測試；沒有對應測試的規則就是 residual risk。

每個模組固定檢查：呼叫者、輸入信任程度、authoritative owner、冪等性、並行安全、失敗恢復、可觀測性、保留期與測試覆蓋。

---

## 12. Code Review 文件索引

### 共用與核心

- [CODE_REVIEW_QA.md](CODE_REVIEW_QA.md)：常見口頭 review 問答與程式碼位置。
- [FUNCTION_REVIEW_ORDER.md](FUNCTION_REVIEW_ORDER.md)：函式閱讀順序。
- [GO_BACKEND_GUIDE.md](GO_BACKEND_GUIDE.md)：本專案 Go 語法與關鍵概念。
- [runtime_go_review.md](runtime_go_review.md)
- [runtime_config_go_review.md](runtime_config_go_review.md)
- [runtime_rpc_helpers_go_review.md](runtime_rpc_helpers_go_review.md)
- [runtime_security_go_review.md](runtime_security_go_review.md)
- [runtime_maintenance_go_review.md](runtime_maintenance_go_review.md)

### Market

- [runtime_market_models_go_review.md](runtime_market_models_go_review.md)
- [runtime_market_go_review.md](runtime_market_go_review.md)
- [runtime_market_test_go_review.md](runtime_market_test_go_review.md)

### Finance

- [runtime_finance_go_review.md](runtime_finance_go_review.md)：Finance top-down 索引。
- [runtime_finance_models_go_review.md](runtime_finance_models_go_review.md)
- [runtime_finance_matchmaking_go_review.md](runtime_finance_matchmaking_go_review.md)
- [runtime_finance_match_go_review.md](runtime_finance_match_go_review.md)
- [runtime_finance_orders_go_review.md](runtime_finance_orders_go_review.md)
- [runtime_finance_math_go_review.md](runtime_finance_math_go_review.md)
- [runtime_finance_persistence_go_review.md](runtime_finance_persistence_go_review.md)
- [runtime_finance_history_go_review.md](runtime_finance_history_go_review.md)
- [runtime_finance_test_go_review.md](runtime_finance_test_go_review.md)

### Community

- [runtime_community_go_review.md](runtime_community_go_review.md)：Community top-down 索引。
- [runtime_community_models_go_review.md](runtime_community_models_go_review.md)
- [runtime_community_helpers_go_review.md](runtime_community_helpers_go_review.md)
- [runtime_community_storage_go_review.md](runtime_community_storage_go_review.md)
- [runtime_community_views_go_review.md](runtime_community_views_go_review.md)
- [runtime_community_score_go_review.md](runtime_community_score_go_review.md)
- [runtime_community_guild_lifecycle_go_review.md](runtime_community_guild_lifecycle_go_review.md)
- [runtime_community_guild_members_go_review.md](runtime_community_guild_members_go_review.md)
- [runtime_community_guild_governance_go_review.md](runtime_community_guild_governance_go_review.md)
- [runtime_community_guild_queries_go_review.md](runtime_community_guild_queries_go_review.md)

`runtime_player_go_review.md`、`runtime_user_go_review.md` 與舊 guild handlers review 是歷史導覽文件，目前沒有同名可編譯 `.go` 檔；review 時應以本文件列出的現行原始碼為準。
