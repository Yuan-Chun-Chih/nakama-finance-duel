# 開發紀錄時間軸

本文件依照實際 `git commit` 順序與日期整理，記錄本專案從初始化到目前為止的主要功能開發、環境建置、除錯過程，以及近期 Nakama Go runtime 遷移結果。

---

## 1. Commit 時間軸總覽

| 日期時間 | Commit | 訊息 |
| --- | --- | --- |
| 2026-04-27 15:00:29 +0800 | `ac33c46` | Initial commit from Create Next App |
| 2026-04-28 18:40:55 +0800 | `8e3ca83` | Initial commit from local folder |
| 2026-04-29 12:20:10 +0800 | `df1e5b8` | 修正：完成第一次成功測試，確認能正常啟動且工會系統能正常運作 |
| 2026-05-03 13:43:00 +0800 | `61cd73d` | Add guild detail UI and guild/friend RPCs |
| 2026-05-03 13:43:58 +0800 | `1495dfe` | Create ARCHITECTURE.md |
| 2026-05-03 13:44:13 +0800 | `08a1473` | Update README.md |
| 2026-05-03 15:56:53 +0800 | `b5ec7dd` | Add comments and robustness for guild/workflow |
| 2026-05-03 16:50:50 +0800 | `42a301b` | Refactor Nakama runtime, update docs & configs |
| 2026-05-03 17:37:43 +0800 | `75eed38` | Add shadcn UI theme and refactor components |
| 2026-05-03 18:13:53 +0800 | `1dc2e9c` | Convert app to dark theme and update styles |
| 2026-05-05 15:57:45 +0800 | `0877b22` | Add glab toolchain and community UI updates |
| 2026-05-05 19:57:59 +0800 | `3fb289a` | Drop mock mode; refactor live Nakama flow and UI |
| 2026-05-05 21:06:59 +0800 | `4d744ba` | Add member management & realtime chat features |
| 2026-05-07 17:51:28 +0800 | `1564dac` | Use Go Nakama runtime; dashboard UI & search |

---

## 2. 逐次開發紀錄

### 2026-04-27 15:00:29 +0800
### Commit `ac33c46`
### 訊息

`Initial commit from Create Next App`

### 內容

- 使用 `Create Next App` 建立前端專案基礎骨架。
- 建立 `Next.js` 初始目錄結構。
- 建立基本前端啟動能力。

### 影響

- 專案從空白狀態進入可開發狀態。
- 提供後續整合 Nakama 的前端基礎。

---

### 2026-04-28 18:40:55 +0800
### Commit `8e3ca83`
### 訊息

`Initial commit from local folder`

### 內容

- 匯入本地開發中的專案內容。
- 專案從純前端骨架，進入實際功能原型階段。
- 納入後續 Nakama 整合所需的本地檔案與初始結構。

### 影響

- 專案不再只是 Create Next App 預設模板。
- 開始具備應用層邏輯與本地開發內容。

---

### 2026-04-29 12:20:10 +0800
### Commit `df1e5b8`
### 訊息

`修正：完成第一次成功測試，確認能正常啟動且工會系統能正常運作`

### 內容

- 完成第一輪可運作版本驗證。
- 確認前端與公會系統已有基本可用性。
- 專案進入「能啟動、能操作」的初步整合狀態。

### Debug 紀錄

這個階段代表至少完成了第一輪打通測試，包含：

- 專案啟動流程
- 公會基本操作流程
- 本地環境可用性確認

### 影響

- 專案進入可持續疊代狀態。
- 後續功能開始以擴充與收斂為主，而非從零建立。

---

### 2026-05-03 13:43:00 +0800
### Commit `61cd73d`
### 訊息

`Add guild detail UI and guild/friend RPCs`

### 功能開發

這次是第一階段功能面最重要的一次擴充，主要補齊公會治理與社交操作。

已加入：

- 公會詳情頁
- 公會成員列表
- 待審核申請列表
- 好友接受 / 拒絕
- 公會申請加入
- 公會申請批准
- 公會申請拒絕
- 離開公會
- 踢除公會成員

### 後端新增 RPC

- `create_guild`
- `request_guild_join`
- `approve_guild_join`
- `reject_guild_join`
- `leave_guild`
- `kick_guild_member`
- `list_guild_join_requests`
- `get_guild_detail`

### 主要檔案

- [components/guild-detail-client.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx)
- [app/guilds/[id]/page.tsx](c:/Users/kdsam/Documents/nakamafrontend/app/guilds/[id]/page.tsx)
- [lib/nakama/service.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/service.ts)
- [nakama/src/main.ts](c:/Users/kdsam/Documents/nakamafrontend/nakama/src/main.ts)

### 設計決策

- 公會治理改由 Nakama RPC 處理，不完全交由前端控制。
- 公會頁採用「整包重抓 detail」策略，不做局部 patch，優先保證資料一致性。

### 影響

- 第一階段的公會生命週期開始完整。
- 專案從單一 dashboard 原型，進入多頁治理 UI 階段。

---

### 2026-05-03 13:43:58 +0800
### Commit `1495dfe`
### 訊息

`Create ARCHITECTURE.md`

### 文件開發

- 新增 [ARCHITECTURE.md](c:/Users/kdsam/Documents/nakamafrontend/ARCHITECTURE.md)
- 整理專案架構、主要模組責任與關鍵資料流

### 目的

- 讓新加入的開發者可以理解：
  - 前端與 Nakama runtime 的責任邊界
  - dashboard bootstrap 的資料流
  - guild 與 leaderboard 的主要執行路徑

### 影響

- 專案開始具備基本交接文件。
- 降低後續 code review 與維護成本。

---

### 2026-05-03 13:44:13 +0800
### Commit `08a1473`
### 訊息

`Update README.md`

### 文件開發

- 更新 root [README.md](c:/Users/kdsam/Documents/nakamafrontend/README.md)
- 將啟動方式、專案用途與測試流程整理成可閱讀版本

### 補充內容

- 啟動 Nakama 的方式
- 前端啟動方式
- 建議測試順序
- 常用檢查指令
- 基本 troubleshooting

### 影響

- 專案不再只靠口頭說明啟動。
- 降低環境重建成本。

---

### 2026-05-03 15:56:53 +0800
### Commit `b5ec7dd`
### 訊息

`Add comments and robustness for guild/workflow`

### 功能與穩定性調整

- 針對 guild workflow 補強穩定性。
- 補上較完整的註解。
- 提高 UI 與 service 之間的容錯能力。

### 可能涵蓋的調整方向

- guild / friend handler 收斂
- mutation 後狀態刷新流程整理
- 錯誤處理與訊息回饋補強
- dashboard / guild detail 的可讀性強化

### Debug 紀錄

此階段的重點比較像「功能已存在，但需要變得更穩」：

- 降低 guild 操作中 UI state 不一致的風險
- 補足後續 code review 需要的上下文

### 影響

- 專案可維護性提升。
- 公會治理流程開始比較適合繼續疊代。

---

### 2026-05-03 16:50:50 +0800
### Commit `42a301b`
### 訊息

`Refactor Nakama runtime, update docs & configs`

### 核心調整

這是後端環境與 Nakama runtime 穩定化的關鍵節點。

調整內容包含：

- 重整 Nakama runtime TypeScript 程式
- 更新設定檔與文件
- 修正本地 Docker / Nakama 啟動問題
- 收斂環境配置

### Debug 紀錄

此階段實際處理過的重要問題如下：

#### 1. 舊版 `docker-compose.yml` 造成啟動入口混亂

- 根目錄殘留舊 compose 設定
- 與 `nakama/docker-compose.yml` 架構不一致
- 已統一為 `nakama/` 目錄內 compose

#### 2. Docker build 缺少 `git`

症狀：

- `RUN npm install` 失敗
- 錯誤包含 `spawn git` / `enoent`

處理：

- 在 [nakama/Dockerfile](c:/Users/kdsam/Documents/nakamafrontend/nakama/Dockerfile) 補 `apk add --no-cache git`

#### 3. Nakama runtime TypeScript 編譯失敗

症狀：

- `docker compose up --build` 卡在 `npm run build`
- `nakama/src/main.ts` 型別與 API 使用不相容

處理：

- 重寫 / 重整 [nakama/src/main.ts](c:/Users/kdsam/Documents/nakamafrontend/nakama/src/main.ts)
- 修正 [nakama/src/nkruntime.d.ts](c:/Users/kdsam/Documents/nakamafrontend/nakama/src/nkruntime.d.ts)
- 修正 [nakama/tsconfig.json](c:/Users/kdsam/Documents/nakamafrontend/nakama/tsconfig.json)

#### 4. `ignoreDeprecations` 設定不相容

症狀：

- TypeScript build 報 `Invalid value for '--ignoreDeprecations'`

處理：

- 將值改成目前容器內 TypeScript 可接受的設定

#### 5. `local.yml` 的 `name` 長度超限

症狀：

- Nakama container 一直重啟
- `7351` 無法打開
- log 顯示 `Name must be 1-16 characters`

處理：

- 將節點名稱改為合法長度

#### 6. Runtime 啟動時 `nkruntime is not defined`

症狀：

- Nakama 啟動後立即崩潰

原因：

- 將 `nkruntime.*` 當成 JS 執行期全域變數使用

處理：

- 改成字串 / 數值常數
- 同步修正型別

### 結果

- Nakama API `7350` 正常啟動
- Nakama Console `7351` 正常啟動
- PostgreSQL 與 runtime 完成整合

### 影響

- 本地後端環境正式穩定。
- 專案可在本機完整跑起來，而不是只有 mock mode。

---

### 2026-05-03 17:37:43 +0800
### Commit `75eed38`
### 訊息

`Add shadcn UI theme and refactor components`

### UI / 前端重構

- 正式安裝 `shadcn/ui`
- 導入 `Radix UI`
- 建立 `components/ui/*` 基礎元件
- 將主要頁面重構成較一致的元件化介面

### 新增 / 使用的元件類型

- `Button`
- `Card`
- `Alert`
- `Badge`
- `Dialog`
- `Tabs`
- `ScrollArea`
- `Avatar`
- `Select`
- `Separator`

### 主要影響檔案

- [components.json](c:/Users/kdsam/Documents/nakamafrontend/components.json)
- [components/phase-one-dashboard.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx)
- [components/guild-detail-client.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx)
- [app/globals.css](c:/Users/kdsam/Documents/nakamafrontend/app/globals.css)

### 設計意圖

- 從原型 UI 轉向可維護的設計系統
- 提升 dashboard 與 guild detail 的一致性
- 為後續美化與擴充建立可重用基礎

### 影響

- 專案從功能原型，進一步變成較完整的產品型介面。

---

### 2026-05-03 18:13:53 +0800
### Commit `1dc2e9c`
### 訊息

`Convert app to dark theme and update styles`

### UI 美化

- 將整體介面改為深色主題
- 將風格往正式 SaaS / 金融產品方向收斂
- 以深藍 / 石墨 / 青綠 / 琥珀作為主視覺語言

### 調整內容

- 將全域設計 token 改為深色預設
- 在 [app/layout.tsx](c:/Users/kdsam/Documents/nakamafrontend/app/layout.tsx) 直接啟用 `dark`
- 調整首頁與公會頁的 panel、card、surface 層級
- 將殘留的白底黑字卡片改為深色玻璃感風格

### 主要檔案

- [app/globals.css](c:/Users/kdsam/Documents/nakamafrontend/app/globals.css)
- [app/layout.tsx](c:/Users/kdsam/Documents/nakamafrontend/app/layout.tsx)
- [components/phase-one-dashboard.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx)
- [components/guild-detail-client.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx)

### 影響

- 視覺表現更接近正式金融產品控制台
- 與 `shadcn/ui` / `Radix` 的 dark variant 整合完成

---

### 2026-05-05 15:57:45 +0800
### Commit `0877b22`
### 訊息

`Add glab toolchain and community UI updates`

### 功能 / 工具調整

- 建立 `glab` 工具鏈與登入流程，讓後續 GitLab issue / board 操作可直接在本機完成
- 補強 community UI，包括 group / guild detail 頁面、操作入口與畫面結構
- 更新部分文件與操作指引，讓專案從純本地開發轉向可協作狀態

### 影響

- GitLab 整合能力落地
- 社群相關頁面的資訊密度與可操作性提升

---

### 2026-05-05 19:57:59 +0800
### Commit `3fb289a`
### 訊息

`Drop mock mode; refactor live Nakama flow and UI`

### 核心調整

- 從前端 `service.ts` 物理移除 mock state、mock dashboard、mock 社群與排行榜資料
- 專案改成 `Nakama Live only`
- 移除先前在 live mode 失敗時偷偷 fallback 到 mock 的路徑
- 文件同步改寫成 live-only 啟動方式

### 主要影響檔案

- [lib/nakama/service.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/service.ts)
- [README.md](c:/Users/kdsam/Documents/nakamafrontend/README.md)
- [QUICKSTART.md](c:/Users/kdsam/Documents/nakamafrontend/QUICKSTART.md)
- [SYSTEM_OVERVIEW.md](c:/Users/kdsam/Documents/nakamafrontend/SYSTEM_OVERVIEW.md)

### Debug 紀錄

#### 1. Nakama Live 失敗時被誤導成 Mock Runtime

症狀：

- Docker 中 `nakama` 與 `postgres` 都是 `Up (healthy)`
- 畫面本應顯示 `Nakama Live`
- 但註冊或登入失敗後畫面卻回到 `Mock Runtime`

原因：

- `bootstrapPhaseOne()`、`registerWithEmail()`、`loginWithEmail()` 等 live mode 流程在 `catch` 後直接 fallback 到 mock snapshot

處理：

- live mode 失敗時不再 fallback
- 統一改成丟出 `[live:action] ...` 型別的真實錯誤

#### 2. `listUserGroups()` 參數順序 bug

症狀：

- `[live:bootstrapPhaseOne] HTTP 400 Bad Request: Invalid state - state must be between 0 and 4.`

原因：

- `@heroiclabs/nakama-js` 某版 `listUserGroups()` wrapper 在 `state / limit` 上有錯位問題

處理：

- 將呼叫改為 workaround 形式
- 並在文件中留下這個坑位紀錄

### 影響

- Live mode 錯誤不再被遮蔽
- 前端與後端連線問題更容易定位
- 專案正式告別 mock 模式

---

### 2026-05-05 21:06:59 +0800
### Commit `4d744ba`
### 訊息

`Add member management & realtime chat features`

### 功能開發

- 補齊 group / guild member management
- 新增 realtime chat 最小可用版本
- 建立 DM、group chat、guild chat 基礎流程
- 補上未讀數、typing 狀態、在線狀態與訊息送達狀態的 UI 結構
- 補最小整合測試腳本，覆蓋 `register -> friend -> guild join -> submit score -> chat`

### 主要檔案

- [components/realtime-chat-panel.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx)
- [components/community-detail-client.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/community-detail-client.tsx)
- [components/guild-detail-client.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx)
- [lib/nakama/service.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/service.ts)
- [scripts/integration-smoke.mjs](c:/Users/kdsam/Documents/nakamafrontend/scripts/integration-smoke.mjs)

### 影響

- 專案從單純社交與排行榜骨架，進一步具備即時互動能力
- 後續能用整合測試驗證主要使用者旅程

---

### 2026-05-07 17:51:28 +0800
### Commit `1564dac`
### 訊息

`Use Go Nakama runtime; dashboard UI & search`

### 核心調整

這次是目前後端演進中最重要的一次架構轉換：將關鍵 Nakama RPC 從 JavaScript runtime 轉成 Go runtime。

### 遷移內容

- 新增 Go runtime plugin：
  - [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go)
  - [nakama/go.mod](c:/Users/kdsam/Documents/nakamafrontend/nakama/go.mod)
- Dockerfile 改為使用 `nakama-pluginbuilder` 編譯 `backend.so`
- `local.yml` 移除 `js_entrypoint`
- Nakama 啟動後改由 Go runtime 註冊 RPC

### 轉移到 Go runtime 的 RPC

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

### 前端 / UI 補充調整

- dashboard 搜尋能力補齊：
  - 好友模糊搜尋
  - groups / guilds 模糊搜尋
- 登入前只顯示產品介紹與 Access 區塊
- 登入後才顯示 Friends / Communities / Leaderboards / Chats
- 補強 `Submit score` 狀態回饋與 guild 建立相關 UI 行為

### Debug 紀錄

#### 1. JavaScript runtime RPC 錯綁

症狀：

- 呼叫 `/v2/rpc/submit_portfolio_score`
- Nakama log 卻顯示 `rpcGetPhaseConfig invoked`
- `list_guild_join_requests` 也被錯綁到同一個 handler

定位結果：

- TypeScript 原始碼正確
- 容器內 `/nakama/data/modules/build/main.js` 也正確
- 問題不在前端，也不在 Docker cache，而是 JS runtime 的 RPC dispatch 不可信

結論：

- 關鍵 authoritative RPC 必須脫離 JS runtime
- 改由 Go runtime 接手

#### 2. Go runtime 初始遷移的編譯問題

在導入 Go plugin 時，實際透過 Docker build 抓到並修正：

- 缺少 `go.sum` 依賴資訊
- `GroupCreate` 回傳型別判斷錯誤
- `GroupUsersAdd / Promote / Demote / Kick` 需要 `callerID`
- `GroupUser.state` 在 Go 端是 wrapper，不是純 `int`
- `StorageList` 與 `GroupUsersList` 的實際簽名與預估不同

這些都已透過反覆 `docker compose build --no-cache` 修正完成。

#### 3. Go runtime 驗證結果

已驗證：

- `docker compose build --no-cache` 成功
- `docker compose up -d` 成功
- Nakama log 顯示：
  - `Nakama finance Go runtime initialized.`
  - `Registered Go runtime RPC function invocation`

並且直接查 PostgreSQL 可見 leaderboard 寫入結果，例如：

- `portfolio_return_global`
- `portfolio_return_weekly`
- `guild_average_return_weekly`

代表 `submit_portfolio_score` 已能透過 Go runtime 真正寫入後端資料庫，而不是只在前端顯示成功訊息。

### 目前殘留問題

- 整合測試最後仍失敗在 realtime chat：
  - `Group not found: Invalid channel target`
- 這表示：
  - `register -> friend -> guild join -> submit score` 已能走到 chat
  - 但聊天室的 channel target 組裝仍需後續修正

### 影響

- 關鍵 guild / score authoritative server logic 從不穩定的 JS runtime 轉到 Go runtime
- leaderboard 與 guild 操作的可信度大幅提升
- 專案後端架構正式進入較穩定的可維護階段

---

## 3. 補充除錯紀錄

以下問題不一定都能精確對應單一 commit，但都發生在本階段開發期間，且對專案可用性有直接影響。

### 3.1 前端註冊時 React DOM 錯誤

症狀：

```text
Failed to execute 'removeChild' on 'Node'
```

處理：

- 避免重用同一份表單初始 reference
- 調整 form reset 策略
- 修正列表 key 的穩定性

---

### 3.2 Windows `spawn EPERM`

症狀：

- `npm run dev` 啟動失敗

判斷：

- 主要是 Windows 權限 / child process 問題
- 不是業務程式本身的 TypeScript 錯誤

處理建議：

- 以系統管理員重新開 terminal
- 使用 `cmd /c npm run dev`

---

### 3.3 文件與註解編碼問題

症狀：

- 部分中文文件與註解曾出現亂碼

影響：

- 增加 code review 與文件閱讀成本

目前狀態：

- 正式文件已逐步補齊
- 歷史文件在本次更新中已重新整理為正常 UTF-8 中文

---

## 4. 目前專案狀態總結

截至最新 commit，專案已具備：

- 可啟動的 Next.js 前端
- 可啟動的本地 Nakama + PostgreSQL 環境
- Live-only Nakama 連線模式
- 使用者註冊 / 登入
- 好友邀請 / 接受 / 拒絕 / 刪除
- 群組 / 公會建立
- 公會申請 / 核准 / 拒絕
- 公會離開 / 踢人 / 邀請 / 權限升降 / owner 轉移
- 公會詳情頁與 group detail 頁
- 全站排行榜
- 公會平均報酬排行榜
- 深色 SaaS / 金融產品風格 UI
- Nakama Go runtime authoritative RPC
- DM / group / guild realtime chat 基礎能力

---

## 5. 後續建議

建議下一步優先順序：

1. 修正 realtime chat 的 group / guild channel target
   - 先處理 `Group not found: Invalid channel target`
   - 讓 smoke test 能真正跑完整條主流程

2. 收斂 [lib/nakama/service.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/service.ts)
   - 持續拆模組
   - 減少單檔責任過重

3. 補強 guild 治理
   - audit log
   - 更完整的 owner / admin 權限說明

4. 補強排行榜可信度
   - 長期應改為送交易結果或回合摘要，由 server 重算
   - 避免直接送分數成為正式方案

5. 補測試與文件
   - RPC API 文件
   - data model 文件
   - chat / guild / leaderboard 的整合測試

---

## 6. 參考文件

- [README.md](c:/Users/kdsam/Documents/nakamafrontend/README.md)
- [QUICKSTART.md](c:/Users/kdsam/Documents/nakamafrontend/QUICKSTART.md)
- [ARCHITECTURE.md](c:/Users/kdsam/Documents/nakamafrontend/ARCHITECTURE.md)
- [SYSTEM_OVERVIEW.md](c:/Users/kdsam/Documents/nakamafrontend/SYSTEM_OVERVIEW.md)
- [nakama/README.md](c:/Users/kdsam/Documents/nakamafrontend/nakama/README.md)

---

## 7. Week 3 補充紀錄：2026-05-24 至 2026-05-31

完整細節已整理到獨立文件：

- [DEVELOPMENT_Week3.md](c:/Users/kdsam/Documents/nakamafrontend/DEVELOPMENT_Week3.md)

### 7.1 本週主要開發

- 拆分 [lib/nakama/service.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/service.ts)，將原本過大的 Nakama service 分成 `client / dashboard / chat / match / types`。
- 收斂好友搜尋命名，區分「已加好友本地搜尋」與「Add friend by username 後端模糊搜尋」。
- 補強 guild 退出與解散流程，包含 owner 不能直接離開仍有成員的 guild、`Disband guild`、以及 dashboard `Current governance view` 同步問題。
- 大量補強中文文件與程式註解，包含 [ARCHITECTURE.md](c:/Users/kdsam/Documents/nakamafrontend/ARCHITECTURE.md) 與 [CODE_REVIEW_GUIDE.md](docs/reviews/CODE_REVIEW_GUIDE.md)。
- 導入 Nakama relayed multiplayer 第一版，新增 [components/realtime-match-panel.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx) 與 [lib/nakama/match.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts)。
- Go runtime 新增 match lobby / result RPC：`create_match_lobby`、`list_match_lobbies`、`close_match_lobby`、`submit_match_result`。
- 新增 relayed match smoke test：[scripts/relayed-match-smoke.mjs](c:/Users/kdsam/Documents/nakamafrontend/scripts/relayed-match-smoke.mjs)。

### 7.2 本週 Debug 紀錄摘要

- 修正 `submit_match_result` HTTP 500：原因是 `match_results` storage key 過長，已縮短 key 並將 `matchId` 保存在 value。
- 修正 relayed match 退出後重整仍出現 `HTTP 404 Not Found` / `Match not found`：自動 resume 舊 match 失敗時會清除 localStorage resume 與本地 match cache。
- 修正 React duplicate key：presence join/leave synthetic event id 加入 sequence，避免同一毫秒內 key 重複。
- 修正 `Timer` 永遠 `not synced` 與「自己送出後只有其他人看到」：送出 `Timer sync / Start / Emote / Send state / Submit result` 後，sender 端會建立 local optimistic event。
- 釐清 hydration mismatch：`trancy-version="7.8.6"` 來自瀏覽器外掛，不是 Next.js layout bug。
- 改善 `Relayed match operation failed` 錯誤顯示，讓 UI 能顯示更具體的 Error / Response / SDK object。

### 7.3 目前狀態摘要

截至 2026-05-31，專案已具備：

- Live-only Next.js + Nakama + PostgreSQL 本地開發環境。
- 使用者登入、好友、group/guild、guild governance、leaderboard、realtime chat。
- Go runtime authoritative RPC，負責 guild、score、leaderboard、search、match lobby、match result。
- Relayed multiplayer 原型，支援 create/join/leave、community lobby、matchmaker、ready、state sync、timer sync、ping/pong、submit result。

目前限制：

- `Timer sync` 目前只同步秒數狀態，尚未實作真正每秒倒數。
- `limit-order: buy 10 shares` 目前只是測試 match state，尚未接上真正金融交易裁決器。
- `submit_match_result` 已有基本驗證，但正式對戰仍應由 Go runtime 根據 orders / portfolio 重算結果。

---

## 8. Week 4 開發紀錄摘要：2026-06-01 至 2026-06-14

完整紀錄見：

- [DEVELOPMENT_Week4.md](c:/Users/kdsam/Documents/nakamafrontend/DEVELOPMENT_Week4.md)

### 8.1 Match 功能完善

- Relayed match 從單純 demo 推進到基本回合制流程。
- 雙方 ready 後由 host start game。
- 每 10 秒一輪，host 依 `roundStartedAt + durationSeconds` 推進回合。
- 前端新增 portfolio sync，會傳輸目前現金與 P&L 給對手。
- 原本只有文字用途的 `limit-order: buy 10 shares` 改為結構化 order：symbol、side、quantity、limitPrice、round、createdAt。
- 前端送出 order 時會先呼叫 `submit_match_order` RPC，runtime 驗證後才用 relayed match 廣播 normalized order。

### 8.2 Go Runtime Authoritative Settlement

- 新增 `submit_match_order` RPC。
- 新增 `match_orders` storage collection。
- `submit_match_result` 不再信任前端提交的 score 或 client payload orders。
- 結算只讀 runtime 已保存的 `match_orders`。
- runtime 會重算 fills、cash、positions、NAV、P&L、return bps、score、winner。
- order storage key 改用短 hash，避免 match id + order id 過長造成 Nakama storage key 錯誤。

### 8.3 驗證紀錄

已通過：

```powershell
cmd /c npx tsc --noEmit
cmd /c npm run lint
cd C:\Users\kdsam\Documents\nakamafrontend\nakama
docker compose build nakama
cd C:\Users\kdsam\Documents\nakamafrontend
cmd /c npm run test:relayed-match
```

注意：

- 本機未安裝 `gofmt`，已透過 Nakama pluginbuilder Docker image 執行 `gofmt -w runtime.go`。
- `test:relayed-match` 已覆蓋 `submit_match_order`、relayed order broadcast、`submit_match_result` 與 settlement fills / winner 檢查。
- 目前 price source 仍是 deterministic table，尚未接正式行情或 historical candles。
- fills 目前保存在 `match_results.settlement`，尚未拆成獨立 `match_fills` collection。
