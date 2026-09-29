# 前端 Top-down Code Review

本目錄以目前 `apps/web` 的實際程式為準，從使用者進入頁面開始，往下追蹤到 React 元件、Nakama service、session、WebSocket、RPC 與共用 UI。

這份文件只負責建立架構與閱讀順序；各層的詳細說明分散在下列文件。閱讀時建議由上往下，不要先從單一按鈕或單一 RPC 開始。

## 1. 前端邊界

```text
Browser
  |
  +-- Next App Router
  |     +-- /                         -> PhaseOneDashboard
  |     +-- /matches                  -> MatchArenaClient
  |     +-- /matches/[kind]/[id]      -> MatchArenaClient + community context
  |     +-- /communities/[id]          -> CommunityDetailClient
  |     +-- /guilds/[id]               -> GuildDetailClient
  |
  +-- React client components
  |     +-- FinanceDuelMatchPanel
  |     +-- RealtimeChatPanel
  |     +-- PhaseOneDashboard
  |     +-- CommunityDetailClient / GuildDetailClient
  |
  +-- lib/nakama service layer
  |     +-- client.ts     session、RPC context、storage-safe helpers
  |     +-- dashboard.ts  auth、community、guild、friend、leaderboard RPC
  |     +-- match.ts      matchmaking、match socket、resume、finance RPC
  |     +-- chat.ts       chat socket、channel、unread、typing
  |     +-- types.ts      前後端 view model 與 payload 型別
  |
  +-- Nakama HTTP RPC / WebSocket
        +-- backend authoritative state、交易、戰績與保存
```

前端只傳送使用者意圖，例如 `begin`、`ready`、`order`、`resign`；前端不應自行決定成交價、portfolio、勝負、Rating 或後端資料庫內容。

## 2. 建議閱讀順序

1. [01_ROUTING_AND_APP_SHELL_REVIEW.md](./01_ROUTING_AND_APP_SHELL_REVIEW.md)：先理解 Next route 如何選擇頁面與 client component。
2. [02_FINANCE_DUEL_REVIEW.md](./02_FINANCE_DUEL_REVIEW.md)：理解目前主要產品流程，從配對、確認、倒數、交易到重連。
3. [03_NAKAMA_SERVICE_REVIEW.md](./03_NAKAMA_SERVICE_REVIEW.md)：追蹤 component 呼叫如何轉成 RPC、WebSocket 與 resume。
4. [04_DASHBOARD_COMMUNITY_CHAT_REVIEW.md](./04_DASHBOARD_COMMUNITY_CHAT_REVIEW.md)：理解 Phase 1 社群、好友、公會、排行榜與聊天資料流。
5. [05_SHARED_UI_AND_STYLING_REVIEW.md](./05_SHARED_UI_AND_STYLING_REVIEW.md)：理解共用 UI primitive、主題、RWD 與可存取性。
6. [06_SCRIPTS_CONFIG_AND_TEST_REVIEW.md](./06_SCRIPTS_CONFIG_AND_TEST_REVIEW.md)：理解環境變數、price feed、smoke test 與部署邊界。

## 3. 核心資料流

### 3.1 頁面載入

`RootLayout` 設定 metadata、全域 CSS、字型與 dark class。頁面 route 再將參數傳給 server page 或 client component。client component 呼叫 `bootstrapPhaseOne()`，恢復 Nakama session 並取得 dashboard snapshot。

### 3.2 Finance 配對

`FinanceDuelMatchPanel` 呼叫 `updateFinanceMatchmaking("begin")`，後端產生 queue projection 與 `queueToken`；前端再用 token 呼叫 Nakama matchmaker。配對成功後加入 authoritative match，接收 server snapshot，雙方確認後才進入 countdown。

### 3.3 Finance 對局

```text
match socket data
  -> normalizeMatchData()
  -> subscribeToRealtimeMatchData()
  -> FinanceDuelMatchPanel setGame()
  -> derived display only
```

按下買入或賣出時，前端只送 `side`、`quantityMicros` 與 `clientOrderId`。成交、fee、tax、cash、BTC、NAV 與 finish result 必須由 backend snapshot 回傳。

### 3.4 刷新與斷線

`persistRealtimeMatchResume()` 保存目前 match id。重新整理後，component 先查詢後端 matchmaking projection，再讀取 local resume metadata；若仍有對局，重新 `joinRealtimeMatch()`，由 server directed snapshot 恢復畫面。

## 4. Review 重點

- `apps/web/app` 是路由入口，不應把交易規則放在 page component。
- `components` 負責呈現與使用者意圖，不應直接存取 PostgreSQL。
- `lib/nakama` 是前端與 Nakama 的唯一整合層；RPC 名稱、opcode、payload 型別應集中管理。
- `types.ts` 是 view model 合約，但 authoritative 真相仍是 Go runtime。
- `localStorage` 只適合保存 session/resume metadata，不適合保存現金、持倉或勝負。
- 交易對局需要處理 stale snapshot、重複 event、斷線重連、action loading 與手機操作空間。

## 5. 目前主要風險

- `lib/nakama/match.ts` 仍保留 `Relayed` 舊命名與 alias，功能已支援 authoritative finance，但名稱容易讓維護者誤判責任邊界。
- `PhaseOneDashboard`、`FinanceDuelMatchPanel` 仍是大型 client component，後續可再按資料責任拆成 hooks 與 feature components。
- 前端的技術指標是行情 view projection，只能供 UI 情報使用，不能當成成交或結算依據。
- 前端 history refresh 必須避免每一個 socket event 都完整重抓所有 history；目前 finance panel 已對 order event 做 debounce。
- `.env` 的 `NEXT_PUBLIC_*` 會暴露給瀏覽器，不能放入 secret、ingestion key 或管理員權限。

## 6. 對應後端文件

前端送出的 RPC、opcode 與 storage projection 對應到 `services/nakama/codereview/BACKEND_CODE_REVIEW.md` 及其下層 runtime review。前端 review 只描述呼叫端與資料流，不取代後端 authoritative 規則的 review。
