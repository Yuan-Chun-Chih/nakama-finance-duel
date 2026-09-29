# Week 3 開發紀錄與 Debug 紀錄

本文件整理 2026-05-24 至 2026-05-31 期間的主要開發、除錯、文件更新與目前專案狀態。此週重點是：前端 Nakama service 拆分、好友搜尋命名收斂、文件導讀補強、guild 退出 / 解散流程修正，以及導入 Nakama relayed multiplayer 第一版。

---

## 1. Commit 時間軸

| 日期時間 | Commit | 訊息 | 重點 |
| --- | --- | --- | --- |
| 2026-05-24 18:25:43 +0800 | `b1a58ca` | Split Nakama service, docs & friend-search rename | 拆分 `service.ts`、好友搜尋命名收斂、文件補強 |
| 2026-05-29 11:49:19 +0800 | `b2b01ea` | Split Nakama service and add relayed match | 新增 relayed match UI/service、match lobby/result RPC、文件更新 |
| 2026-05-29 12:21:34 +0800 | `26354ad` | Support relayed match snapshots & sequencing | 補 state sync、sequence、ping/pong、smoke test |
| 2026-05-31 16:43:35 +0800 | `3e38d5c` | Clear relayed match local state; improve resume/errors | 修 stale match resume、404 清理、錯誤訊息顯示 |

目前尚有未 commit 的修正：

- `components/realtime-match-panel.tsx`：補 relayed match 本地 optimistic state 更新，解決自己送出 timer/state/emote 後只有其他人看到的問題。

---

## 2. 本週主要開發

### 2.1 Nakama service 拆分

原本 [lib/nakama/service.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/service.ts:1) 承載過多責任，本週拆成較清楚的檔案：

- [lib/nakama/service.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/service.ts:1)：對外 re-export 入口，讓 component import 路徑維持穩定。
- [lib/nakama/types.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:1)：集中管理 dashboard、guild、chat、match 相關型別。
- [lib/nakama/client.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/client.ts:1)：Nakama client、session、env、錯誤處理、localStorage helper。
- [lib/nakama/dashboard.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/dashboard.ts:1)：登入、好友、group/guild、leaderboard、detail page 資料流程。
- [lib/nakama/chat.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/chat.ts:1)：realtime chat socket、channel、presence、typing、unread。
- [lib/nakama/match.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:1)：relayed match socket、matchmaker、match lobby、match data、resume cache。

影響：

- component 仍從 `@/lib/nakama/service` 匯入，避免大規模改動 UI import。
- service 層責任更清楚，後續 review 可依 `client / dashboard / chat / match` 分開閱讀。
- `CODE_REVIEW_GUIDE.md` 已同步改成依建議閱讀順序導讀。

---

### 2.2 好友搜尋命名收斂

本週釐清兩種不同搜尋：

- `existingFriendSearchQuery`：Friends tab 內搜尋已加好友，只是本地過濾 `snapshot.friends`。
- `friendInviteUsername`：Add friend dialog 內搜尋尚未加好友的玩家，會呼叫後端 `search_users` RPC。

調整目的：

- 避免「搜尋好友」與「搜尋可邀請玩家」在命名上混淆。
- UI 行為更清楚：一個是本地 filter，一個是後端模糊查詢。

---

### 2.3 Guild 退出與解散流程補強

本週處理過多個 guild lifecycle 問題：

- owner 不能在仍有成員時直接 leave guild。
- 新增 / 補強 `Disband guild` 功能，讓 owner 可明確解散公會。
- 修正「後端已退出 guild，但前端 `Current governance view` 還顯示 guild 面板」的同步問題。
- `leaveGuild()` 加上前後端狀態不同步容錯。
- dashboard 的 `primaryGuild` 只接受 `owner / admin / member`，避免 `visitor / requested` 出現在目前公會摘要。

相關檔案：

- [components/phase-one-dashboard.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx:1)
- [components/guild-detail-client.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx:1)
- [lib/nakama/dashboard.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/dashboard.ts:1)
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1)

---

### 2.4 文件與程式註解補強

本週大量補強文件與 code review 入口：

- [ARCHITECTURE.md](c:/Users/kdsam/Documents/nakamafrontend/ARCHITECTURE.md:1)：改為中文撰寫，描述目前 Go runtime 架構。
- [CODE_REVIEW_GUIDE.md](docs/reviews/CODE_REVIEW_GUIDE.md:1)：補檔案導讀、函式用途、資料模型、debug 指令。
- [nakama/local.yml](c:/Users/kdsam/Documents/nakamafrontend/nakama/local.yml:1)：標註哪些設定仍有效，哪些責任已轉交 Go runtime / Dockerfile / `.env.local`。
- [lib/nakama/client.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/client.ts:1)、[lib/nakama/dashboard.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/dashboard.ts:1)、[lib/nakama/chat.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/chat.ts:1)、[lib/nakama/match.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:1)：補中文註解。
- 主要 UI component 補充較詳細註解，尤其是 dashboard、guild detail、realtime chat / match。

---

### 2.5 Nakama relayed multiplayer 第一版

本週導入 Nakama 官方 relayed multiplayer 概念，建立前端第一版對戰面板。

新增 / 補強檔案：

- [components/realtime-match-panel.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1)：relayed match UI。
- [lib/nakama/match.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:1)：relayed match service。
- [lib/nakama/types.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:1)：match 型別。
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1)：match lobby / result RPC。
- [scripts/relayed-match-smoke.mjs](c:/Users/kdsam/Documents/nakamafrontend/scripts/relayed-match-smoke.mjs:1)：relayed match smoke test。

目前已具備：

- `Create match`：建立 Nakama client-relayed match。
- `Join by match id`：用 match id 加入對戰。
- `Create lobby`：在 group/guild detail 內建立 community match lobby。
- `Join lobby`：從 group/guild lobby 清單加入對戰。
- `Close lobby`：關閉 community lobby。
- `Matchmaker`：使用 query、string properties、numeric properties 加入 Nakama matchmaker。
- `Ready`：用 match data 廣播 ready state。
- `Start`：host 發送 round start。
- `Send state`：送出測試用 trade action，例如 `limit-order: buy 10 shares`。
- `State target`：支援 broadcast 或 directed send 給指定 presence。
- `Sync state`：非 host 可向 host 要目前 match state snapshot。
- `Timer sync`：host 可同步 timer 值。
- `Emote`：送出輕量表情訊號。
- `Ping / Pong`：測試 relayed match 內往返延遲。
- `Submit result`：呼叫 Go runtime `submit_match_result` RPC，保存 match result。

---

### 2.6 Match lobby / result 後端 RPC

Go runtime 新增 match 相關 RPC：

- `create_match_lobby`
- `list_match_lobbies`
- `close_match_lobby`
- `submit_match_result`

資料模型：

- `match_lobbies`：保存 group/guild match lobby，補足 Nakama relayed match 本身沒有依 community 查詢 lobby 的產品層需求。
- `match_results`：保存 match result，包含 score、summary、host、participants、ready users、event count、event hash。

目前定位：

- relayed match 負責玩家之間的即時資料轉送。
- Go runtime 負責產品層 lobby / result 保存與基本驗證。
- 尚未實作真正金融交易裁決器，因此 `limit-order: buy 10 shares` 目前是測試 state，不會自動分勝負。

---

## 3. 本週 Debug 紀錄

### 3.1 `submit_match_result` HTTP 500

症狀：

```text
Relayed match smoke test failed.
HTTP 500 Internal Server Error
url: /v2/rpc/submit_match_result
```

原因：

- `match_results` storage key 組合過長。
- 原本 key 包含 `communityId + matchId + userId + timestamp`，容易超過 Nakama storage key 長度限制。

處理：

- `runtime.go` 改短 `match_results` key。
- `matchId` 仍保存在 value 裡，不放入 key。

驗證：

- `cmd /c npm run test:relayed-match` 通過。

---

### 3.2 退出後重整仍出現 `Match not found`

症狀：

```text
HTTP 404 Not Found
{"code":4,"message":"Match not found"}
```

原因：

- 前端把 active relayed match 的 `matchId` 存在 localStorage 用於 refresh resume。
- 使用者 leave match 後，或 Nakama match 已不存在時，重整仍拿舊 `matchId` 去 `joinMatch()`。

處理：

- `leaveRelayedMatch()` 不管 leave 成功或失敗，都清除該 match 的本地 cache / listeners / presence / sequence throttle。
- resume 舊 match 時如果遇到 `Match not found` / 404，前端自動清除 resume，不再把錯誤留在畫面上。

相關檔案：

- [lib/nakama/match.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:1)
- [components/realtime-match-panel.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1)

---

### 3.3 React duplicate key

症狀：

```text
Encountered two children with the same key:
left:<sessionId>:<timestamp>
```

原因：

- presence join/leave event 使用 `action + sessionId + Date.now()` 作為 React key。
- 同一毫秒內產生多筆相同事件時，key 會重複。

處理：

- synthetic match event id 加上 sequence。
- key 格式改成 `kind + subject + Date.now + sequence`。

---

### 3.4 `Timer` 永遠顯示 `not synced`

症狀：

- host 按 `Timer sync` 後，其他玩家可以看到 timer。
- host 自己仍顯示 `not synced`。
- `Start / Emote / Send state` 也可能出現「其他人看得到，自己看不到」。

原因：

- relayed match 送出資料後，前端只等 Nakama match data echo。
- sender 不一定會用同一路徑收到自己的 match data。

處理：

- `Timer sync / Start / Emote / Send state / Submit result` 送出成功後，sender 端立即建立 local optimistic event。
- 本地同步更新 `Timer / Round / Last action / Last emote / event log`。

目前限制：

- `Timer sync` 目前只同步數值，例如 `60s`。
- 尚未實作每秒遞減 countdown loop。

---

### 3.5 Hydration mismatch：`trancy-version`

症狀：

```text
A tree hydrated but some attributes of the server rendered HTML didn't match the client properties.
- trancy-version="7.8.6"
```

原因：

- 瀏覽器外掛 Trancy 在 React hydration 前修改 `<html>` attribute。
- 不是 Next.js layout 程式碼本身錯誤。

處理建議：

- 測試時關閉該外掛或使用無外掛視窗。
- 不建議為外掛造成的差異長期依賴 `suppressHydrationWarning` 掩蓋。

---

### 3.6 `Relayed match operation failed` 錯誤過於籠統

症狀：

- UI 只顯示 `Relayed match operation failed`。
- 不容易知道是 404、SDK error、RPC error 或 directed send 找不到 recipient。

處理：

- 改善 `describeRelayedMatchError()`。
- Error / string / Response / object 都會轉成較具體訊息。
- 後續使用者貼錯誤時更容易定位。

---

### 3.7 `.env.local` 與 `.env.example` 使用方式釐清

本週釐清：

- Next.js 實際讀取 `.env.local`。
- `.env.example` 是範本，不會被 runtime 自動讀取。
- 目前預設 Nakama 設定適合本機 Docker：

```text
NEXT_PUBLIC_NAKAMA_HOST=127.0.0.1
NEXT_PUBLIC_NAKAMA_PORT=7350
NEXT_PUBLIC_NAKAMA_SERVER_KEY=nakama-finance-dev-key
NEXT_PUBLIC_NAKAMA_USE_SSL=false
```

---

## 4. 本週驗證紀錄

本週多次執行：

```powershell
cmd /c npx tsc --noEmit
cmd /c npm run lint
```

relayed match 修正後曾執行：

```powershell
cmd /c npm run test:relayed-match
```

已確認：

- TypeScript compile 通過。
- ESLint 通過。
- relayed match smoke test 通過。
- `submit_match_result` 500 已修正。
- stale match resume 404 已處理。

---

## 5. 目前專案狀態總結

截至 2026-05-31，本專案目前具備：

- Next.js 前端可啟動。
- Nakama + PostgreSQL 本地 Docker 環境可啟動。
- Live-only Nakama 連線模式。
- Email 註冊 / 登入 / session restore。
- 好友邀請、接受、拒絕、刪除。
- Add friend by username 支援後端模糊搜尋。
- group / guild 建立。
- guild join request、approve、reject、leave、kick、disband。
- guild settings、announcement、join policy。
- guild audit log 與 detail page。
- leaderboard score submit 與 guild average leaderboard。
- realtime chat：DM、group、guild、presence、typing、unread。
- relayed multiplayer：create/join/leave、lobby、matchmaker、ready、state sync、timer sync、ping/pong、submit result。
- Go runtime authoritative RPC：guild governance、score、leaderboard、search、match lobby、match result。
- service 層已拆成 `client / dashboard / chat / match / types`。
- `CODE_REVIEW_GUIDE.md` 已具備較完整的檔案與函式導讀。

---

## 6. 目前限制與後續建議

建議下一步優先順序：

1. 實作真正 countdown timer。
   - 目前 `Timer sync` 只同步 `60s` 這類狀態值。
   - 建議改成同步 `secondsRemaining + startedAt`，各 client 本地倒數。

2. 實作金融對戰裁決器。
   - 目前 `limit-order: buy 10 shares` 只是測試 match state。
   - 後續應設計 order schema、portfolio state、成交規則、手續費、最終 NAV / return。
   - `submit_match_result` 應由 Go runtime 根據 orders 或 final portfolio 重算結果。

3. 強化 match result 驗證。
   - 目前已有 lobby、membership、host、participants、ready、event count、event hash 驗證。
   - 後續可加入 event signature、round id、result idempotency、anti replay。

4. 補 relayed match UI 測試與 e2e 測試。
   - 至少覆蓋 create lobby、join lobby、ready、timer sync、send state、submit result、leave、refresh resume。

5. 整理文件。
   - 將 relayed match 使用方式補進 `README.md` / `QUICKSTART.md`。
   - 將 match data op code 與 payload schema 補進 `CODE_REVIEW_GUIDE.md`。

---

## 7. 重要檔案索引

- [components/realtime-match-panel.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1)
- [lib/nakama/match.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:1)
- [lib/nakama/types.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:1)
- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1)
- [scripts/relayed-match-smoke.mjs](c:/Users/kdsam/Documents/nakamafrontend/scripts/relayed-match-smoke.mjs:1)
- [CODE_REVIEW_GUIDE.md](docs/reviews/CODE_REVIEW_GUIDE.md:1)
- [ARCHITECTURE.md](c:/Users/kdsam/Documents/nakamafrontend/ARCHITECTURE.md:1)
