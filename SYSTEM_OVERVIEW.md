# 系統總覽

本文件說明 `nakama-duel` 目前的前後端架構、資料流與技術選型。專案是一個以 BTC 現貨模擬交易為主題的即時雙人對決系統；交易、配對、結算與戰績都由 Nakama Go authoritative runtime 判定。

## 1. 專案定位

系統包含兩個主要產品面向：

- 社交功能：帳號、好友、Community、Guild、排行榜與即時聊天室。
- Finance Duel：雙人配對、雙方確認、開局倒數、五分鐘 BTC 現貨交易、即時 snapshot、斷線／投降處理、結算、Rating 與歷史紀錄。

核心原則是「前端送意圖，後端產生結果」。瀏覽器可以送出 Ready、確認配對、買入、賣出、撤單、投降等意圖，但不能自行指定成交價、現金、BTC 持倉、NAV、勝方或 Rating。

## 2. Repository 結構

```text
nakama-duel/
├─ apps/
│  └─ web/                    Next.js 前端與 price-feed worker
│     ├─ app/                 App Router routes
│     ├─ components/          React 畫面與 UI 元件
│     ├─ lib/nakama/          Nakama client、RPC、socket service 與型別
│     └─ scripts/             smoke tests、行情 ingestion worker
├─ services/
│  └─ nakama/                 Nakama Go runtime、Docker 與資料庫設定
│     ├─ runtime*.go          authoritative backend
│     ├─ codereview/          後端架構與逐行 review 文件
│     ├─ Dockerfile           編譯 backend.so plugin
│     └─ docker-compose*.yml  開發與正式環境編排
├─ docs/                      專案／review 文件整理區（若有）
├─ package.json               Monorepo 指令入口
└─ SYSTEM_OVERVIEW.md         本文件
```

## 3. 整體架構

```text
┌─────────────────────────────────────────────────────────┐
│ Browser                                                   │
│ Next.js / React UI                                        │
│ - 登入、社交、配對、交易介面、圖表、歷史與手機版版面        │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP RPC / WebSocket
                        v
┌─────────────────────────────────────────────────────────┐
│ Nakama 3.38                                               │
│ - Authentication / Users / Groups / Chat / Leaderboards  │
│ - Matchmaker / Presence / Authoritative Match Tick       │
│ - Go plugin: backend.so                                  │
└───────────────┬─────────────────────────┬───────────────┘
                │                         │
                v                         v
┌─────────────────────────────┐  ┌────────────────────────┐
│ Go authoritative runtime     │  │ PostgreSQL 16           │
│ - Finance state machine      │  │ - Nakama core data      │
│ - Orders / fills / NAV       │  │ - Storage projections   │
│ - Market validation          │  │ - Leaderboards / groups │
│ - Guild / leaderboard rules  │  └────────────────────────┘
└───────────────┬─────────────┘
                │ protected ingestion RPC
                v
┌─────────────────────────────────────────────────────────┐
│ Node.js price-feed worker                                │
│ CCXT -> Binance BTC/USDT OHLCV -> HMAC signed payload    │
└─────────────────────────────────────────────────────────┘
```

## 4. 核心資料流

### 4.1 使用者登入與一般社交功能

1. React component 呼叫 `lib/nakama` service。
2. `@heroiclabs/nakama-js` 對 Nakama HTTP API 建立／恢復 session。
3. 前端使用 Nakama 原生 API 處理好友、group、chat 等通用功能。
4. 需要自訂規則的 guild／leaderboard 操作改呼叫 Go RPC。
5. Go runtime 驗證身分與角色後，寫入 Nakama Group、Storage 或 Leaderboard。

### 4.2 Finance 配對與確認

```text
玩家按下 Match
  -> HTTP RPC finance_matchmaking(action=begin)
  -> Go 寫入 searching record 與 QueueToken
  -> Nakama Matchmaker 配對最早兩位玩家
  -> Go 建立 authoritative finance match
  -> 雙方收到 matched snapshot
  -> 雙方送 confirmation intent
  -> 後端 3 秒開局倒數
  -> MatchLoop 進入 running
```

`QueueToken` 用來區分同一玩家不同次排隊，避免延遲到達的舊 matchmaker 結果誤配到新的排隊狀態。

### 4.3 下單、成交與畫面同步

```text
交易票券
  -> WebSocket order intent
  -> authoritative MatchLoop
  -> 驗證玩家、行情 freshness、現金、持倉、數量與冪等鍵
  -> server price + slippage + fee + tax 計算成交
  -> 更新 cash / BTC / P&L / NAV
  -> 保存 order、fill、event、portfolio snapshot
  -> 廣播個人化 state snapshot
  -> 兩位玩家畫面更新
```

對手只收到名稱、連線狀態、確認狀態與模糊化的領先資訊，不會收到完整即時資產資料。

### 4.4 市場資料

```text
CCXT 讀取 Binance BTC/USDT OHLCV
  -> Node price-feed worker
  -> HMAC-SHA256 signature + timestamp + nonce
  -> ingest_match_candles RPC
  -> Go 驗證簽章、allowlist、時間、重播與價格跳動
  -> Nakama Storage candles + latest price
  -> finance match 每回合讀取 server price
```

行情超過 freshness 期限時，後端將 `marketStale` 設為 true 並拒絕新訂單，避免使用過期價格成交。

### 4.5 結算、戰績與排行榜

1. 五分鐘到期、投降或斷線判負時，Go runtime 依 authoritative NAV／規則結算。
2. 同批保存 final game、玩家 Rating/stats、個人 history index 與 leaderboard projection outbox。
3. 立即嘗試更新 Nakama leaderboard。
4. 若 leaderboard 更新失敗，maintenance job 用 Storage CAS lease 重試 outbox。

## 5. 前端技術選型

| 技術 | 使用位置 | 用途 | 為何採用 |
| --- | --- | --- | --- |
| Next.js 16 | `apps/web` | 路由、SSR/Client Component、開發與正式建置 | React 生態完整，App Router 適合將大廳、arena route、社群頁面分開管理。 |
| React 19 | `components/` | 交易畫面、表單、即時 state render | 元件化適合將市場、order ticket、歷史、配對與社群畫面拆分；state 更新可直接反映 WebSocket snapshot。 |
| TypeScript 5 | 前端與 Node scripts | 型別、payload contract、UI 邏輯 | 在編譯期檢查 snapshot、order、RPC response 欄位，降低前後端 contract 漂移。 |
| Tailwind CSS 4 | `globals.css`、components | 響應式 layout、樣式 | 可以在同一元件中明確管理 desktop/mobile breakpoints，適合交易面板這種密集資訊版面。 |
| shadcn/ui | UI 元件組合 | Button、Dialog、Sheet、表單外觀模式 | 元件程式碼可留在專案內調整，不會被黑盒元件庫限制。 |
| Radix UI | shadcn 底層 primitives | Dialog、Popover、可及性行為 | 提供鍵盤操作、focus management、ARIA 等成熟基礎。 |
| lucide-react | `components/` | 圖示 | SVG 圖示風格一致、可 tree-shake，適合交易操作與狀態提示。 |
| clsx + tailwind-merge + class-variance-authority | UI helper | 合併 class、建立 variant | 避免條件 class 衝突，讓買／賣、危險操作、disabled 狀態能維持一致設計。 |
| @heroiclabs/nakama-js | `lib/nakama/` | Session、HTTP API、RPC、Socket、Match、Chat | 官方 JavaScript client，前端不需要自行實作 Nakama protocol。 |
| UUID | scripts／前端 request | 產生 client operation/order 識別值 | 和後端 idempotency 配合，讓網路重送不會產生重複副作用。 |

前端不負責任何最終交易計算。即使 UI 會先 disable 按鈕或預估金額，這只是 UX；實際是否可成交仍由後端重驗證。

## 6. Node.js 行情服務技術選型

| 技術 | 使用位置 | 用途 | 為何採用 |
| --- | --- | --- | --- |
| Node.js | `apps/web/scripts/*.mjs` | 執行 price-feed 與 smoke tests | 與前端同樣使用 JavaScript ecosystem，部署腳本簡單。 |
| CCXT | `price-feed-worker.mjs` | 讀取交易所 OHLCV | 用統一 API 抽象交易所；日後更換交易所或增加備援來源成本較低。 |
| Node `crypto` | price-feed scripts | 建立 HMAC-SHA256 signature | 讓 Nakama 能確認行情 payload 確實來自持有 ingestion secret 的 worker。 |
| 指數退避與 webhook | price-feed worker | 故障分類、重試、告警 | 區分交易所、網路、登入、ingestion RPC 失敗，避免失敗時高頻重試。 |

Price-feed 不直接修改 PostgreSQL，而是透過受保護 RPC 寫入。這樣所有市場資料規則仍集中在 Go runtime。

## 7. 後端技術選型

| 技術 | 使用位置 | 用途 | 為何採用 |
| --- | --- | --- | --- |
| Nakama 3.38 | `services/nakama` | 遊戲後端平台 | 內建帳號、session、好友、Group、Chat、Leaderboard、Matchmaker、Presence、RPC 與 authoritative multiplayer，避免自行組合多個即時服務。 |
| Go runtime plugin | `runtime*.go` -> `backend.so` | authoritative 規則、交易、配對、Guild 規則 | 適合精確 `int64` 金額運算、HMAC、Storage CAS、match state machine 與完整標準函式庫；前端無法竄改結算。 |
| Nakama authoritative match | `runtime_finance_match.go` | 對局唯一 state owner | 以固定 tick 執行 `MatchLoop`，統一處理倒數、行情、訂單、斷線與結算，兩位玩家以 server snapshot 同步。 |
| Nakama Matchmaker | `runtime_finance_matchmaking.go` | 尋找對手 | 使用 Nakama 的 realtime matchmaking 基礎能力，後端再加上 QueueToken、確認期限與取消規則。 |
| Nakama Storage | Finance／Market／Guild modules | 保存 snapshots、events、orders、fills、stats、config | 由 Nakama 管理資料權限與 JSON records；適合和 RPC/match runtime 整合。 |
| Nakama Leaderboards | Community score module | 全域、週榜與 Guild 榜 | 不需要自行設計排名查詢、分數排序與週期重置；Finance 結算後由後端投影。 |
| PostgreSQL 16 | Compose `postgres` | Nakama 實際資料庫 | Nakama 官方支援的關聯式資料庫；同時保存 users、groups、storage、leaderboard records。 |
| Go `int64` | Finance models/math | cents、BTC micros、basis points | 避免 JavaScript 浮點誤差。美元用 cents，BTC 用 micros，所有資金規則可重現。 |
| Go `context` | RPC/match handlers | Nakama request metadata、取消與 user ID | 讓 handler 從 Nakama context 取得已驗證使用者與環境資料。 |
| HMAC-SHA256 + nonce | Market ingestion | 行情來源驗證、防重播 | 保護 `ingest_match_candles`，不能只靠前端／worker 自稱來源。 |
| Storage version CAS | stats/lease/maintenance | 並行更新與單一執行者租約 | 避免多局對戰同時更新同一 stats record 時遺失資料，也避免多個節點重複清理。 |
| Outbox projection | Finance persistence | game 結算與 leaderboard 同步 | 先可靠保存待投影資料；外部 leaderboard 寫入失敗後可重試，不讓結果遺失。 |

### 為什麼 authoritative 規則使用 Go，而不是放在前端

交易對決會處理現金、BTC、成交、fee、tax、P&L、NAV、勝負與 Rating。若讓前端計算，使用者可以在瀏覽器修改 state 或重送偽造結果。因此 Go runtime 是唯一能決定結果的位置。

Go 並不是因為「一定比 TypeScript 快」才被選用。Nakama 官方一般建議 JavaScript VM 作為容易上手的 runtime；本專案選 Go 的理由是完整標準函式庫、`int64` 精度、HMAC／時間驗證、CAS、複雜 state machine 與後端維護邏輯更適合集中在強型別 server plugin。前端 TypeScript 仍是畫面與行情 worker 的主要語言。

## 8. 容器、設定與部署技術

| 技術 | 檔案 | 用途 | 為何採用 |
| --- | --- | --- | --- |
| Docker | `services/nakama/Dockerfile` | 編譯並封裝 Go plugin | 確保 Go plugin builder 與 Nakama server 使用相容版本，降低本機與部署環境差異。 |
| Docker Compose | `docker-compose.yml` | 本機 PostgreSQL、Nakama、price-feed | 一個指令即可建立完整開發環境，service name 也可當作內部網路 DNS。 |
| Production Compose | `docker-compose.production.yml` | 正式環境安全設定 | 不公開 DB/gRPC/Console，只讓 API 交給 reverse proxy；強制使用 production env。 |
| local.yml | `services/nakama/local.yml` | Nakama 本機設定 | 指定 logger、Console、session、socket、runtime module path。 |
| `.env` / env examples | `services/nakama/.env*` | secret 與規則參數 | 把 ingestion secret、allowlist、管理員 ID、風控閾值與 feature flags 從程式碼分離。 |
| npm workspace scripts | 根目錄 `package.json` | 統一前端指令 | 從 repository root 執行 dev、build、lint、smoke test 與 price-feed 指令。 |

正式環境仍應在 Compose 外加上 TLS reverse proxy、WAF／共享限流、secret manager、備份與監控；Go runtime 內的 RPC limiter 是單一 Nakama process 的第一層防線，不是完整邊界。

## 9. 主要程式責任

### 前端

- `apps/web/app/`：頁面 route 與 arena route。
- `apps/web/components/`：Finance duel、配對、交易面板、市場圖表、社群、聊天室與手機版 layout。
- `apps/web/lib/nakama/client.ts`：Nakama client/session 基礎設定。
- `apps/web/lib/nakama/match.ts`：RPC、WebSocket、match join、snapshot listener、reconnect resume。
- `apps/web/lib/nakama/types.ts`：前後端共享的前端 view type。
- `apps/web/scripts/price-feed-worker.mjs`：長駐行情抓取、簽章、退避與告警。
- `apps/web/scripts/*smoke.mjs`：端到端驗證。

### 後端

- `runtime.go`：plugin 入口，註冊 RPC、match handler、matchmaker callback 與 leaderboard。
- `runtime_config.go`：RPC ID、opcode、collection、交易與保留期常數。
- `runtime_security.go`：RPC rate limit 與 environment parser。
- `runtime_market*.go`：candle ingestion、HMAC/nonce 驗證、行情 freshness、保留期清理。
- `runtime_finance_matchmaking.go`：排隊、配對、確認、取消、lease recovery。
- `runtime_finance_match.go`：authoritative match lifecycle 與 snapshot broadcast。
- `runtime_finance_orders.go`：下單驗證、成交、限價單、投組 mark-to-market。
- `runtime_finance_persistence.go`：events、orders、fills、snapshots、stats、idempotency、metrics、outbox。
- `runtime_finance_history.go`：歷史 cursor、arena index、管理員 metrics RPC。
- `runtime_community*.go`：Guild lifecycle、成員、治理、查詢、audit、leaderboard projection。
- `runtime_maintenance.go`：CAS lease 與背景清理／重試。

更完整的後端檔案關係與 review 順序請看：[BACKEND_CODE_REVIEW.md](services/nakama/codereview/BACKEND_CODE_REVIEW.md)。

## 10. 安全與資料一致性設計

- 所有交易結果由 authoritative match 產生，前端只送 intent。
- 行情 ingestion 使用 secret、HMAC、timestamp、nonce、symbol/source allowlist 與價格跳動限制。
- stale market 時拒絕新訂單。
- order 使用 client order ID 與 storage idempotency record，避免重送造成重複成交。
- Guild 操作有 operation idempotency、角色檢查與 audit log。
- 玩家 stats 使用 CAS retry，降低同一使用者多局同時結算的寫入競爭。
- 完成對局寫入 leaderboard outbox；投影失敗由 maintenance retry。
- 財務金額使用整數，不使用浮點數作 authoritative 計算。
- 管理指標 `get_finance_metrics` 與玩家 history RPC 分開，僅允許管理員 user ID allowlist。

## 11. 本機開發與驗證

啟動後端：

```powershell
cd C:\Users\kdsam\Documents\nakama-duel\services\nakama
docker compose up --build
```

啟動前端：

```powershell
cd C:\Users\kdsam\Documents\nakama-duel
cmd /c npm run dev
```

常用驗證：

```powershell
cd C:\Users\kdsam\Documents\nakama-duel
cmd /c npm run lint
cmd /c npm run build
cmd /c npm run test:finance-duel

cd services\nakama
go test ./...
go vet ./...
```

## 12. 後續演進方向

- 將 process-local RPC limiter 升級為 reverse proxy 或 Redis 等共享限流。
- 加入 Prometheus/OpenTelemetry，追蹤配對等待時間、行情 stale 秒數、拒單原因、CAS retry 與 outbox backlog。
- 為 events、fills、orders、portfolio snapshots 設定歸檔與 retention job。
- 增加對局 replay，使用 append-only events、fills 與 round snapshots 重播決策。
- 增加壓力、斷線、行情故障、雙節點與資料庫還原測試。
- 為正式環境建立 PostgreSQL PITR、secret rotation 與 deployment rollback 流程。
