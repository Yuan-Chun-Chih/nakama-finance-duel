# Dashboard、Community、Guild 與 Chat Code Review

## 1. PhaseOneDashboard

檔案：[components/phase-one-dashboard.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/phase-one-dashboard.tsx)

- `createEmptyAuth()`：建立 auth form 初始值。
- `createEmptyCommunity()`：建立 community form 初始值。
- `PhaseOneDashboard()`：首頁大型 client component，整合 auth、好友、community、guild、leaderboard、finance panel 與 chat。
- `snapshot`：保存 `bootstrapPhaseOne()` 回傳的總覽資料。
- `booting`：控制首次 bootstrap loading。
- `busy`：目前 dashboard mutation 的共用 loading；後續可改為 operation map，避免邀請好友時整頁按鈕都被鎖住。
- auth state：`authMode`、`authForm`、register/login dialog。
- friend state：邀請 username、搜尋 query、候選人與搜尋 loading。
- community state：建立表單、搜尋與 dialog。
- score state：score input、dialog、submit status。
- `useEffect` bootstrap：恢復 session 並取得 dashboard snapshot；cleanup 防止卸載後更新。
- `startTransition`：將非立即畫面更新降為 transition，避免大型 dashboard 操作阻塞輸入。
- mutation handlers：呼叫 `dashboard.ts` wrapper，成功後以 backend 回傳 snapshot 更新畫面。
- `CommunityCard`：單一 group/guild card 的顯示與 action。
- `Panel`、`MetricCard`、`Field`、`InfoPill`：dashboard 內部的共用視覺元件。
- `ListState<T>`：統一 loading、empty、error、list 狀態。
- `LeaderboardList`：顯示 backend leaderboard records，不自行重新排名。
- `fuzzyMatch()`、`normalizeSearch()`：只負責本地顯示過濾，不代表 server search authorization。

## 2. CommunityDetailClient

檔案：[components/community-detail-client.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/community-detail-client.tsx)

- `CommunityDetailClient({ communityId })`：community detail client entry。
- detail loading effect：呼叫 `fetchCommunityDetail()`，以 cancellation flag 防止 race。
- membership actions：join、leave、invite、role mutation 都只送 intent，成功後重新讀取 detail。
- tabs/sections：將 members、guilds、leaderboard、audit 等資料分區呈現。
- `InfoPill`：顯示固定 label/value。
- `initialsFromName()`：只用於 avatar fallback。

## 3. GuildDetailClient

檔案：[components/guild-detail-client.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/guild-detail-client.tsx)

- `GuildDetailClient({ guildId })`：公會 detail 與治理頁入口。
- detail effect：呼叫 `fetchGuildDetail()`。
- join request action：request、approve、reject 都以 backend response 重新同步資料。
- governance action：promote、demote、transfer、kick、leave、disband，前端只根據 server role 決定是否顯示按鈕。
- audit section：顯示後端 audit log，不在前端產生治理紀錄。
- `formatAuditTime()`：只處理顯示時間。
- `InfoPill`、`initialsFromName()`：純呈現 helper。

## 4. RealtimeChatPanel

檔案：[components/realtime-chat-panel.tsx](/C:/Users/kdsam/Documents/nakama-duel/apps/web/components/realtime-chat-panel.tsx)

- `RealtimeChatPanel({ snapshot })`：依 dashboard snapshot 建立 friend/group/guild chat target。
- `selectedTargetId`：目前選擇的 chat target。
- `chatSession`：目前 channel id、messages、cursor 與 target。
- `messageBody`：輸入框 draft，不等於已送出訊息。
- `loadingOlder`：cursor pagination loading；`sending`：送訊息 loading。
- `unreadCounts`：由 chat service 的 global listener 更新。
- `realtimeMeta`：socket 連線、typing、presence 等 metadata。
- `buildChatTargets()`：將 dashboard snapshot 轉成 chat target list。
- `openChatSession()`：建立或加入 channel，成功後載入最近訊息。
- `loadOlderChatMessages()`：使用 cursor 載入更舊訊息。
- `sendChatMessage()`：送出訊息 intent，成功後以 server message 更新列表。
- `sendTypingSignal()`：傳送輕量 typing signal，不應保存為聊天訊息。
- `subscribeToChatChannel()`：訂閱新訊息與 typing event。
- `mergeMessages()`、`appendUniqueMessage()`：依 message id 去重，避免 realtime 與 RPC 分頁重複。
- `replaceMessageById()`：用 server ack 替換 optimistic message。
- `markMessageDelivery()`：更新 sent/sending/failed UI 狀態。
- `getTargetKey()`：建立 local unread cache key。
- `formatTimestamp()`：顯示時間，不參與排序。

## 5. 元件之間的關係

```text
PhaseOneDashboard
  +-- Community cards -> dashboard.ts community/guild RPC
  +-- Leaderboard      -> dashboard.ts leaderboard read
  +-- RealtimeChatPanel -> chat.ts socket/channel
  +-- FinanceDuelMatchPanel -> match.ts match socket/RPC
        +-- MatchArenaClient 在 /matches route 也可單獨承載它
```

## 6. Review 結論

目前 dashboard 是產品入口，finance arena 已能獨立 route，這是正確方向。主要可優化項目是把 PhaseOneDashboard 的 mutation handler 拆成 feature hooks，並將 chat 的 socket lifecycle 與 message reducer 抽離，避免大型 client component 同時承擔 layout、資料與互動。
