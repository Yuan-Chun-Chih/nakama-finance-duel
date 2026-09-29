# 專案架構說明

本文件說明目前專案的整體架構、主要模組責任、前後端資料流，以及與 `group / guild / leaderboard / realtime chat` 相關的核心設計。

目前專案已不再使用 mock mode，也不再依賴 Nakama JavaScript runtime。關鍵後端邏輯已改為 `Nakama Go runtime`。

## 1. 架構總覽

本專案分成兩大部分：

- `Next.js 前端`
  - 負責登入、好友、群組、公會、排行榜、聊天等 UI 與互動流程
  - 透過 `@heroiclabs/nakama-js` 連線到 Nakama
  - 由 `service.ts` 統一封裝 API、RPC、socket 與 session 邏輯

- `Nakama + PostgreSQL 後端`
  - Nakama 提供帳號、好友、群組、排行榜、聊天室、RPC 入口
  - PostgreSQL 負責 Nakama 主要資料持久化
  - Go runtime 負責權限規則、guild 治理、排行榜寫入、guild 設定、審計紀錄與使用者搜尋

核心資料流如下：

1. 使用者進入前端首頁
2. 前端從 local session 還原 Nakama session
3. 前端透過 `lib/nakama/service.ts` 取得 dashboard snapshot
4. 使用者操作好友、公會、排行榜、聊天室功能
5. 前端呼叫 Nakama 原生 API 或 Go runtime RPC
6. Nakama / Go runtime 更新 group membership、storage 與 leaderboard
7. 前端重新抓取 snapshot 或 detail，更新畫面

## 2. 目錄結構

```text
app/
  layout.tsx
  page.tsx
  globals.css
  guilds/[id]/page.tsx
  communities/[id]/page.tsx

components/
  phase-one-dashboard.tsx
  guild-detail-client.tsx
  community-detail-client.tsx
  realtime-chat-panel.tsx
  ui/

lib/
  nakama/service.ts
  utils.ts

nakama/
  docker-compose.yml
  Dockerfile
  local.yml
  go.mod
  runtime.go

scripts/
  integration-smoke.mjs
```

## 3. 前端架構

### 3.1 Route 層

#### [app/page.tsx](c:/Users/kdsam/Documents/nakamafrontend/app/page.tsx)

責任：

- 首頁入口
- 只負責掛載 `PhaseOneDashboard`

設計意圖：

- 保持 route 層極薄
- 實際業務與互動邏輯集中在 component / service

#### [app/layout.tsx](c:/Users/kdsam/Documents/nakamafrontend/app/layout.tsx)

責任：

- 載入全域樣式
- 定義 HTML 基本骨架
- 啟用 dark theme

#### [app/guilds/[id]/page.tsx](c:/Users/kdsam/Documents/nakamafrontend/app/guilds/[id]/page.tsx)

責任：

- 公會治理頁入口
- 將 `guildId` 傳給 `GuildDetailClient`

#### [app/communities/[id]/page.tsx](c:/Users/kdsam/Documents/nakamafrontend/app/communities/[id]/page.tsx)

責任：

- group / guild detail 共用入口
- 給一般 community detail 頁使用

### 3.2 Dashboard 與功能頁

#### [components/phase-one-dashboard.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx)

這是整個前端的主操作殼層，負責：

- 註冊 / 登入 / 登出
- 好友邀請、接受、刪除
- group / guild 建立
- group 加入 / 離開
- guild 申請加入 / 審核 / 離開
- leaderboard 分數提交
- dashboard 搜尋
- chat 入口

重要特點：

- 使用單一 `DashboardSnapshot` 當首頁讀模型
- 未登入只顯示產品介紹與 Access 區塊
- 已登入才顯示 `Friends / Communities / Leaderboards / Chats`
- 透過 `runMutation()` 統一處理 loading / success / error

#### [components/guild-detail-client.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx)

這是 guild 治理頁，負責：

- 成員列表
- pending requests
- guild chat
- 邀請成員
- admin 升降
- owner 轉移
- kick member
- guild settings
  - announcement
  - join policy
- audit log
- member contribution panel

目前這頁已從「單純詳情頁」提升為 guild admin console。

#### [components/community-detail-client.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/community-detail-client.tsx)

責任：

- 顯示一般 group 或 guild 的 roster / metadata / chat
- 提供較輕量的 community 檢視
- guild 導向更完整的 guild governance page

#### [components/realtime-chat-panel.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx)

責任：

- DM / group / guild chat UI
- 未讀數
- typing indicator
- 在線狀態
- 訊息歷史與分頁載入

目前聊天室架構：

- friend chat：使用 Nakama DM channel
- group / guild chat：使用 deterministic room channel
  - `community:group:<id>`
  - `community:guild:<id>`

這是為了避開原本 group target 不穩定的 channel join 行為。

## 4. 前端 Service Layer

### [lib/nakama/service.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/service.ts)

這是前端最重要的業務邊界。

它的責任包括：

- 管理 Nakama client / socket / session
- 讀取 dashboard snapshot
- 封裝所有 user action
- 封裝 guild detail / community detail 資料轉換
- 封裝 realtime chat 狀態
- 統一 live mode 錯誤格式

### 4.1 RuntimeContext

`RuntimeContext` 透過 `.env.local` 決定：

- leaderboard id
- guild leaderboard id
- score RPC id
- guild governance RPC id
- `search_users` RPC id

目前專案是 `live-only`：

- 沒有 mock snapshot
- 沒有 mock fallback
- live mode 失敗會直接拋錯

### 4.2 Dashboard Snapshot

`DashboardSnapshot` 是首頁的單一讀模型，包含：

- `profile`
- `friends`
- `communities`
- `leaderboards`
- `runtime`

`bootstrapPhaseOne()` 的責任：

1. 還原 local session
2. 驗證 session 是否仍可用
3. 載入 live dashboard

### 4.3 Action 路由策略

`service.ts` 會根據功能種類決定：

- 直接走 Nakama 原生 API
- 或走 Go runtime RPC

例如：

- friend invite：Nakama native `addFriends`
- group create：Nakama native `createGroup`
- guild create：`createGroup` + `create_guild` RPC
- score submit：`submit_portfolio_score` RPC
- guild settings：`update_guild_settings` RPC
- add friend 模糊搜尋：`search_users` RPC

### 4.4 Guild / Group 職責切分

目前設計上：

- `group`
  - 走較輕量的原生 API
  - 適合一般 community

- `guild`
  - 走 authoritative RPC
  - 有更完整的治理、設定、審計、排行榜聚合

這是目前專案中最重要的邊界之一。

## 5. 後端架構

### 5.1 Nakama 核心

本地後端由以下組成：

- Nakama 3.38.0
- PostgreSQL 16
- Go runtime plugin

相關檔案：

- [nakama/docker-compose.yml](c:/Users/kdsam/Documents/nakamafrontend/nakama/docker-compose.yml)
- [nakama/Dockerfile](c:/Users/kdsam/Documents/nakamafrontend/nakama/Dockerfile)
- [nakama/local.yml](c:/Users/kdsam/Documents/nakamafrontend/nakama/local.yml)

### 5.2 Go Runtime

#### [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go)

這是目前後端 authoritative logic 的核心。

`InitModule()` 會註冊：

- `get_phase_config`
- `submit_portfolio_score`
- `create_guild`
- `invite_guild_member`
- `promote_guild_admin`
- `demote_guild_admin`
- `transfer_guild_owner`
- `request_guild_join`
- `approve_guild_join`
- `reject_guild_join`
- `leave_guild`
- `kick_guild_member`
- `list_guild_join_requests`
- `get_guild_detail`
- `update_guild_settings`
- `search_users`

### 5.3 Leaderboard 設計

Go runtime 啟動時會建立三張榜：

- `portfolio_return_global`
- `portfolio_return_weekly`
- `guild_average_return_weekly`

寫榜流程：

1. 前端送 `submit_portfolio_score`
2. Go runtime 驗證分數與 cooldown
3. 寫入 `portfolio_scores` storage
4. 寫入 global / weekly leaderboard
5. 讀 guild membership
6. 重算 guild average leaderboard

這代表 guild 榜不是前端直接送平均值，而是 server 依成員最新分數重算。

### 5.4 Guild Storage 設計

目前有幾個關鍵 collection：

- `guild_membership`
  - 記錄某使用者目前所屬 guild 與角色

- `guild_join_requests`
  - 記錄加入申請

- `guild_config`
  - announcement
  - join policy
  - 最後更新資訊

- `guild_audit_log`
  - 所有治理相關事件

- `portfolio_scores`
  - 個人最新分數與時間

### 5.5 Guild 治理規則

Go runtime 目前已做的規則包括：

- 一人只能在一個 guild
- guild owner 不能在仍有成員時直接離開
- owner 才能轉移 owner、升降 admin
- join policy 支援：
  - `request`
  - `invite_only`
- 所有關鍵 guild action 都會寫 audit log

## 6. 搜尋與聊天室

### 6.1 好友模糊搜尋

目前 `Add friend by username` 已不是單純輸入精確 username。

流程是：

1. 前端輸入至少 2 個字元
2. 呼叫 `search_users`
3. Go runtime 對 `username / display_name` 做模糊搜尋
4. 前端顯示候選清單
5. 使用者選取候選後送出 `addFriends`

### 6.2 Dashboard 搜尋

首頁已有兩類前端 fuzzy search：

- friends
- communities

這兩者是針對已載入 snapshot 的前端過濾，不是後端搜尋。

### 6.3 Realtime Chat

目前聊天室有：

- DM
- group chat
- guild chat
- 未讀數
- typing
- presence
- delivery state
- 歷史訊息分頁

群組型聊天目前採 deterministic room target，而不是直接依賴 Nakama 的 group-channel target。

## 7. 重要資料流

### 7.1 登入

1. `PhaseOneDashboard` 載入
2. `bootstrapPhaseOne()`
3. `restoreLiveSession()`
4. `loadLiveDashboard()`
5. `setSnapshot()`

### 7.2 Guild 建立

1. 前端 `createGroup(lang_tag="guild")`
2. RPC `create_guild`
3. Go runtime 驗證/寫入 owner membership
4. 初始化 guild config
5. 寫入 guild audit

### 7.3 Guild 詳情

1. 前端呼叫 `get_guild_detail`
2. Go runtime 回傳：
   - guild metadata
   - members
   - join requests
   - config
   - audit
   - contributions
   - metrics

### 7.4 送分

1. 前端呼叫 `submit_portfolio_score`
2. Go runtime 驗證分數
3. 寫 storage
4. 寫 leaderboard
5. 回傳最新 record summary
6. 前端再重抓 dashboard

## 8. 目前重要設計決策

### 8.1 已移除 mock mode

這是目前架構上的明確前提：

- 不再保留 mock dashboard
- 不再 silent fallback
- 問題會直接顯示 live error

### 8.2 關鍵 RPC 改為 Go runtime

原因：

- 先前 JS runtime 發生 RPC 錯綁
- `submit_portfolio_score` 與 guild RPC 無法可信運作

因此目前 authoritative 邏輯全部收斂到 Go runtime。

### 8.3 Guild detail 採整包重抓

在 member / request / settings / ownership action 後，前端傾向：

- 不做細碎 local patch
- 直接重抓 detail

這樣可降低治理狀態不一致的風險。

### 8.4 Chat target 使用 deterministic room key

這是目前聊天室穩定性的核心 workaround：

- friend：DM channel
- community：room channel

這讓 `group/guild` 聊天 target 更可控。

## 9. 目前最重要的檔案

如果只看少數幾個檔案，優先順序如下：

1. [components/phase-one-dashboard.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx)
2. [lib/nakama/service.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/service.ts)
3. [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go)
4. [components/guild-detail-client.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx)
5. [components/realtime-chat-panel.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx)

## 10. 建議閱讀順序

新加入開發者建議依序閱讀：

1. [README.md](c:/Users/kdsam/Documents/nakamafrontend/README.md)
2. [QUICKSTART.md](c:/Users/kdsam/Documents/nakamafrontend/QUICKSTART.md)
3. [SYSTEM_OVERVIEW.md](c:/Users/kdsam/Documents/nakamafrontend/SYSTEM_OVERVIEW.md)
4. [ARCHITECTURE.md](c:/Users/kdsam/Documents/nakamafrontend/ARCHITECTURE.md)
5. [components/phase-one-dashboard.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx)
6. [lib/nakama/service.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/service.ts)
7. [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go)
8. [components/guild-detail-client.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx)

## 11. 後續建議

目前最值得往下做的方向：

- 將 `lib/nakama/service.ts` 拆模組
  - `auth`
  - `friends`
  - `communities`
  - `leaderboards`
  - `chat`

- 補強 chat 與治理整合
  - system event message
  - pinned announcement
  - moderation control

- 補整合測試
  - guild settings
  - audit log
  - friend search
  - realtime chat

- 補 dashboard 層對 guild join policy 的更明確呈現

- 長期把分數上傳模式改成事件驅動或交易結果重算
  - 避免直接送分數成為正式長期方案
