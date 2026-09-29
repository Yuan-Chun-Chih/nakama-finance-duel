# Code Review Guide

## 建議閱讀順序

這份專案建議先從畫面入口讀到資料層，再看即時功能與後端 runtime。每個檔案下方的函式導讀都用「函式名稱：作用」的形式整理。

1. [app/page.tsx](c:/Users/kdsam/Documents/nakamafrontend/app/page.tsx:1)：首頁 route，先確認畫面從哪裡掛載。
2. [components/phase-one-dashboard.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx:1)：主 Dashboard，理解登入、好友、社群、排行榜與聊天室入口。
3. [lib/nakama/service.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/service.ts:1)：前端 service 對外入口，component 仍從這裡匯入功能。
4. [lib/nakama/types.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:1)：共用型別，先認識 `DashboardSnapshot`、`CommunityView`、`GuildDetail`、`ChatTarget`。
5. [lib/nakama/client.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/client.ts:1)：Nakama client、session、runtime env 與錯誤處理。
6. [lib/nakama/dashboard.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/dashboard.ts:1)：登入、好友、group/guild、leaderboard、detail page 的資料流程。
7. [lib/nakama/chat.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/chat.ts:1)：realtime socket、聊天室、未讀數、presence、typing signal。
8. [lib/nakama/match.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:1)：Nakama relayed match client service，處理 create/join/leave、match data、matchmaker、lobby resume。
9. [components/realtime-match-panel.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1)：relayed multiplayer UI，呈現 lobby、presence、host rotation、ready、op code、ping/pong、result submit。
10. [components/guild-detail-client.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx:1)：guild detail 與治理操作。
11. [components/community-detail-client.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/community-detail-client.tsx:1)：group/guild 共用 detail 頁。
12. [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1)：Go authoritative runtime，理解真正的 guild、leaderboard、match lobby 與 match result 規則。

## 檔案與函式速查補充

本章不取代原本內容，只補上 code review 時最常看到的檔案名稱與函式名稱用途。閱讀順序建議從入口檔案開始，再看 service 層，最後看 Nakama Go runtime。

### App 入口與路由檔案

- `app/page.tsx`：首頁入口，負責掛載 `PhaseOneDashboard`，實際功能畫面都交給 dashboard component。
- `app/layout.tsx`：全站 layout，設定 HTML shell、metadata、字型與 dark theme 基礎。
- `app/globals.css`：全域 CSS 與 shadcn/ui design token，控制深色金融 SaaS 風格。
- `app/guilds/[id]/page.tsx`：公會詳情頁 route，從 URL 取出 guild id 並交給 `GuildDetailClient`。
- `app/communities/[id]/page.tsx`：group / guild 共用詳情頁 route，從 URL 取出 community id 並交給 `CommunityDetailClient`。

### Dashboard 主要元件

- `components/phase-one-dashboard.tsx`：登入後主控台，整合 Access、Friends、Communities、Leaderboards、Chats。
- `createEmptyAuth()`：建立空的登入 / 註冊表單初始值，避免重用同一個物件 reference。
- `createEmptyCommunity()`：建立空的 group / guild 建立表單初始值。
- `PhaseOneDashboard()`：主 dashboard component，集中管理 snapshot、表單狀態、mutation 與畫面切換。
- `handleFriendDialogOpenChange()`：控制新增好友 dialog 開關，關閉時清空搜尋與候選資料。
- `handleFriendInviteUsernameChange()`：更新 Add friend dialog 的玩家搜尋輸入，並觸發搜尋 loading 狀態。
- `friendInviteUsername`：新增好友時輸入的玩家 username / 搜尋字串。
- `friendInviteUserMatches`：後端 `search_users` RPC 回傳的可邀請玩家候選。
- `friendInviteUserSearching`：新增好友玩家搜尋的 loading 狀態。
- `existingFriendSearchQuery`：Friends tab 的本地搜尋字串，只用來過濾已存在好友。
- `filteredExistingFriends`：`snapshot.friends` 經本地模糊搜尋後的結果。
- `runMutation()`：共用 mutation 包裝器，統一處理 busy、error、message 與成功後 snapshot 更新。
- `handleAuthSubmit()`：處理 register / login 表單送出，成功後載入 live dashboard snapshot。
- `handleFriendSubmit()`：送出好友邀請，優先使用模糊搜尋選到的 username。
- `handleCommunitySubmit()`：建立 group 或 guild，依 `kind` 決定走 Nakama group API 或 guild RPC 流程。
- `handleScoreSubmit()`：送出 portfolio score，呼叫後端 authoritative RPC 寫入排行榜。
- `handleLogout()`：清除 session、realtime cache，並回到未登入狀態。
- `handleGuildJoinRequest()`：送出加入 guild 的申請，等待 owner/admin 審核。
- `handleCommunityJoin()`：加入一般 group，不走 guild governance RPC。
- `handleGuildJoinApproval()`：owner/admin 核准 guild join request。
- `handleGuildJoinRejection()`：owner/admin 拒絕 guild join request。
- `handleGuildLeave()`：目前使用者離開自己的 primary guild，並重新整理 dashboard。
- `handleGroupLeave()`：目前使用者離開一般 group。
- `handleFriendAccept()`：接受好友邀請。
- `handleFriendReject()`：拒絕好友邀請。
- `handleFriendRemove()`：刪除既有好友關係。
- `primaryGuild`：從 communities 中找出目前有效的 owner/admin/member guild，供 governance panel 使用。
- `CommunityCard()`：單一 group / guild 卡片，呈現 join、request、leave、detail 等操作入口。
- `Panel()`：dashboard 區塊外框元件，統一標題、描述與 action 區域。
- `MetricCard()`：上方統計卡片，顯示 guild、friend、queue 等摘要數字。
- `Field()`：表單欄位 wrapper，統一 label 與 input 排版。
- `InfoPill()`：小型資訊標籤，用於顯示 role、status、count 等短資訊。
- `ListState()`：列表共用空狀態 / loading 狀態包裝器。
- `LeaderboardList()`：排行榜列表呈現元件，只負責顯示已整理好的 records。
- `totalPendingRequests()`：計算所有 community 中 pending request 的總數。
- `initialsFromProfile()`：從 username / display name 取 avatar fallback 字首。
- `normalizeError()`：把 unknown error 轉成 UI 可顯示字串。
- `fuzzyMatch()`：好友、group、guild 搜尋用模糊比對，支援 includes 與子序列比對。
- `normalizeSearch()`：搜尋字串正規化，小寫化並移除空白。
- `Matches tab`：登入後的 relayed multiplayer 入口，掛載 `RealtimeMatchPanel`，用來建立或加入 Nakama relayed match。

### Guild Detail 與 Community Detail

- `components/guild-detail-client.tsx`：公會專用詳情頁，處理成員、申請、設定、audit log、chat 與 disband。
- `GuildDetailClient()`：公會詳情主 component，依 guild id 載入後端 detail snapshot。
- `handleLeaveGuild()`：呼叫 `leaveGuild()` 離開公會，成功後返回首頁。
- `handleDisbandGuild()`：owner-only 解散公會，刪除 group 與成員 membership。
- `handleInviteSubmit()`：邀請使用者加入 guild。
- `handleSettingsSubmit()`：更新 guild announcement 與 join policy。
- `chatTarget`：把 guild id 包裝成聊天室 target，交給 `RealtimeChatPanel` 使用。
- `components/community-detail-client.tsx`：group / guild 共用 detail 頁，guild 會導向較完整的 guild detail 能力。
- `CommunityDetailClient()`：共用詳情主 component，載入 member list 與基本 community 狀態。
- `handleLeave()`：依 community kind 決定走 `leaveGroup()` 或 `leaveGuild()`。
- `reloadDetail()`：member action 後重新抓 detail，避免前端局部 patch 造成狀態不一致。
- `runMemberAction()`：共用 member action 包裝器，統一 busy、error 與 reload。
- `handleInviteSubmit()`：group/guild 共用邀請成員入口。
- `initialsFromName()`：member avatar fallback 字首產生器。

### Realtime Chat

- `components/realtime-chat-panel.tsx`：即時聊天室 UI，支援 DM、group、guild、未讀數、presence、typing、歷史訊息分頁與 optimistic sending。
- `RealtimeChatPanel()`：聊天室主 component，接收 dashboard snapshot 或 detail page 傳入的固定 target，負責組出聊天對象、開啟 channel、註冊 listener、送出訊息與顯示 realtime metadata。
- `snapshot`：dashboard 傳入的目前使用者資料，會被 `buildChatTargets()` 轉成可聊天對象。
- `disabled`：外層傳入的操作鎖定狀態，通常在 mutation 或未登入時禁止送訊息。
- `forcedTarget`：detail page 傳入的固定聊天室 target；有值時不顯示 target list，直接鎖定目前 group/guild 聊天室。
- `hideTargetList`：控制是否隱藏左側聊天對象清單，用於 detail page 內嵌聊天室。
- `dynamicTargets`：從 `snapshot` 計算出的可聊天目標，包含 accepted friends、已加入 groups、已加入 guilds。
- `targets`：實際渲染用的聊天目標；若有 `forcedTarget`，就只使用該 target。
- `selectedTargetId`：dashboard 聊天清單目前選到的 target key。
- `chatSession`：目前開啟的聊天室狀態，包含 channel id、target、messages、cursor。
- `messageBody`：訊息輸入框目前內容。
- `loading`：正在開啟聊天室 channel 或載入第一頁歷史訊息。
- `loadingOlder`：正在透過 cursor 載入更早的歷史訊息。
- `sending`：正在送出目前訊息，會用來 disable input/button。
- `error`：聊天室操作錯誤，例如開 channel 失敗、送訊息失敗。
- `unreadCounts`：各 chat target 的未讀數快照，由 `subscribeToUnreadCounts()` listener 更新。
- `realtimeMeta`：online users、channel presence、typing 狀態快照，由 `subscribeToRealtimeMeta()` listener 更新。
- `endRef`：訊息列表底部錨點，用於新訊息進來後自動捲到底部。
- `suppressNextAutoScrollRef`：載入舊訊息時暫停自動捲到底部，避免使用者閱讀位置被跳走。
- `lastTypingSignalAtRef`：typing signal 節流時間戳，避免每個 key stroke 都送 WebSocket 訊息。
- `activeTarget`：目前真正使用中的聊天 target；detail page 會優先使用 `forcedTarget`，dashboard 則使用 `selectedTargetId` 或第一個 target。
- `useEffect(primeRealtimeChat)`：dashboard 有登入 profile 時預熱 realtime socket、presence 與可聊天 channels。
- `useEffect(subscribeToUnreadCounts)`：註冊未讀數 listener，未讀數變更時更新 `unreadCounts` state。
- `useEffect(subscribeToRealtimeMeta)`：註冊 presence / typing listener，metadata 變更時更新 `realtimeMeta` state。
- `useEffect(openChatSession)`：`activeTarget` 改變時開啟對應聊天室，載入歷史訊息並標記已讀。
- `useEffect(subscribeToChatChannel)`：`chatSession.channelId` 存在時註冊新訊息 listener，收到訊息後 append 到目前 messages。
- `useEffect(autoScroll)`：訊息數量或 channel 改變時捲到底部；若剛載入舊訊息則跳過一次。
- `useEffect(sendTypingSignal)`：輸入框有文字且超過節流時間時送出 typing signal。
- `handleSend()`：送出聊天訊息；先插入 local optimistic message，再用 server ack 替換，失敗時標記 failed。
- `handleLoadOlder()`：使用 `prevCursor` 載入更早訊息，並把舊訊息 merge 到目前訊息前面。
- `activeTypingUsers`：目前 channel 中正在輸入的其他使用者。
- `activeChannelPresence`：目前 channel 的 presence user id 清單。
- `friendOnline`：目前 DM 對象是否在線。
- `communityOnlineCount`：目前 group/guild channel 的在線人數。
- `content`：右側聊天室主卡片，包含標題、狀態 badge、訊息列表、輸入框。
- `target list`：dashboard 模式下左側聊天對象列表，顯示 online、unread count、target kind。
- `mergeMessages()`：合併兩批訊息並用 message id 去重，再依建立時間排序。
- `appendUniqueMessage()`：把新訊息加進目前 messages，避免重複 message id。
- `replaceMessageById()`：用 server ack 回來的正式訊息替換 optimistic message。
- `markMessageDelivery()`：更新指定 local message 的 delivery state，例如改成 `failed`。
- `getTargetKey()`：產生 friend/group/guild target 的穩定 key，供 selected/unread/channel cache 使用。
- `initialsFromName()`：從 sender name 產生 avatar fallback 字首。
- `formatTimestamp()`：把 ISO time 轉成 zh-TW 顯示格式。

### Realtime Multiplayer / Nakama Relayed Match

- `components/realtime-match-panel.tsx`：Nakama relayed multiplayer 的主要 UI，對應官方 relayed match 的 create / join / leave / presence / match data / op code / directed state / host rotation 概念。
- `RealtimeMatchPanel()`：relayed match 主元件，依 dashboard 或 group/guild detail context 顯示一般 match 或 community lobby。
- `matchName`：建立 relayed match 或 community lobby 時使用的 match name。
- `joinMatchId`：手動加入 relayed match 時輸入的 match id。
- `session`：目前已加入的 relayed match session，包含 match id、self presence、目前 presences、deterministic host session id。
- `presences`：目前 match 內的玩家 presence 清單，對應官方文件中的 opponents / presences 概念。
- `events`：目前 match 收到的 match data 與 system event log，用來觀察 op code、presence join/leave、host rotation、ping/pong。
- `lobbies`：group/guild match lobby 清單，來自 `list_match_lobbies` RPC，不是 Nakama 內建 match list。
- `readyBySessionId`：以 session id 記錄每個玩家 ready 狀態，ready state 透過 match data op code 廣播。
- `stateRecipientSessionId`：指定 match data 要 broadcast 給所有人，或 directed send 給單一 presence。
- `matchmakerQuery` / `matchmakerMode` / `matchmakerRating`：matchmaker query 與 properties，對應 Nakama matchmaker 的 query、string properties、numeric properties。
- `lastLatencyMs`：由 relayed match `ping` / `pong` op code 算出的粗略 RTT。
- `host`：目前 deterministic host，透過 presence session id 排序選出，不是 server authoritative host。
- `isHost`：目前使用者是否為 deterministic host，用來限制 Start / Timer sync 等 host-side 操作。
- `allReady`：所有 presences 是否都 ready，result submit 前也會由 Go runtime 再驗證。
- `handleCreateMatch()`：建立一般 relayed match；在 group/guild context 下會另外呼叫後端 `create_match_lobby` RPC 建立 lobby record。
- `handleJoinMatch()`：使用 match id 加入 relayed match。
- `handleLeaveMatch()`：離開 relayed match，並清除 local resume cache。
- `handleReadyToggle()`：送出 ready state op code，讓其他玩家更新 ready 狀態。
- `handleStartRound()`：host 廣播 round start op code。
- `handleRequestInitialState()`：送出 initial state request，讓新加入或 reconnect 的 client 可以要求同步目前狀態。
- `handleTimerSync()`：host 廣播 timer sync op code，讓 client 顯示一致倒數。
- `handlePing()`：送出 ping op code，收到 pong 後更新 `lastLatencyMs`。
- `handleEmote()`：送出 emote op code，作為 relayed match quick signal 範例。
- `handleSendTestAction()`：送出 trade action op code，可 broadcast 或 directed send 給指定 presence。
- `handleMatchmakerToggle()`：加入或取消 Nakama matchmaker，使用 query / string properties / numeric properties。
- `handleJoinLobby()`：從 group/guild lobby 清單加入對應 relayed match。
- `handleCloseLobby()`：關閉 group/guild lobby，會呼叫 `close_match_lobby` RPC。
- `handleSubmitResult()`：提交 match result 到 Go runtime，payload 包含 host、participants、ready users、event count、event hash。
- `buildPresenceEvent()`：把 presence join/leave 轉成 UI event log，方便 review relayed match lifecycle。
- `buildHostRotationEvent()`：當 deterministic host 改變時產生 system event。
- `buildEventHash()`：用目前 event log 產生簡單 hash，交給後端 result validation 使用。
- `lib/nakama/match.ts`：relayed match service，包住 Nakama socket 的 match API。
- `RELAYED_MATCH_OP_CODES`：集中定義 match data op code，例如 ready、round start、trade action、emote、timer sync、ping、pong、host transfer、match end。
- `createRelayedMatch()`：呼叫 Nakama socket `createMatch()` 建立 client-relayed match。
- `createCommunityMatchLobby()`：先建立 relayed match，再呼叫 `create_match_lobby` RPC 寫入 group/guild lobby record。
- `listCommunityMatchLobbies()`：呼叫 `list_match_lobbies` RPC 取得目前 community 的 open lobbies。
- `closeCommunityMatchLobby()`：呼叫 `close_match_lobby` RPC 關閉 lobby。
- `submitRelayedMatchResult()`：呼叫 `submit_match_result` RPC，將 match 結果交給 Go runtime 驗證與保存。
- `joinRelayedMatch()`：使用 match id 或 match token 加入 relayed match。
- `leaveRelayedMatch()`：離開 relayed match 並清除該 match 的 presence cache。
- `sendRelayedMatchState()`：broadcast match data 給 match 內所有 presences。
- `sendRelayedMatchStateToPresenceIds()`：directed send，將 match data 只送給指定 session id 的 presences。
- `sendRelayedReadyState()`：送出 ready state op code。
- `sendRelayedInitialStateRequest()`：送出 initial state request op code。
- `sendRelayedEmote()`：送出 emote op code。
- `sendRelayedTimerSync()`：送出 timer sync op code。
- `sendRelayedPing()`：送出 ping op code 並回傳 nonce / sentAt。
- `sendRelayedPong()`：對指定 presence 回 pong op code。
- `addRelayedMatchmaker()`：加入 Nakama matchmaker，支援 query、min/max count、string properties、numeric properties。
- `removeRelayedMatchmaker()`：取消 matchmaker ticket。
- `subscribeToRelayedMatchData()`：為指定 match id 註冊 match data listener。
- `subscribeToRelayedMatchPresence()`：為指定 match id 註冊 presence join/leave listener。
- `subscribeToRelayedMatchmaker()`：註冊 matchmaker matched listener。
- `persistRelayedMatchResume()`：把 active match id 與 community context 存到 localStorage，支援 refresh 後 resume。
- `restoreRelayedMatchResume()`：從 localStorage 還原可 resume 的 relayed match。
- `clearRelayedMatchResume()`：清除 relayed match resume cache。
- `ensureRelayedMatchSocket()`：建立或重用 Nakama realtime socket，並掛上 match data / presence / matchmaker callbacks。
- `cacheAndNormalizeMatch()`：把 Nakama Match 轉成 `RelayedMatchSession`，並建立 presence cache。
- `normalizeMatchPresenceEvent()`：把 Nakama presence event 轉成 UI 可用格式，同時維護 presence cache。
- `normalizeMatchData()`：把 Nakama MatchData 轉成 `RelayedMatchEvent`。
- `selectHostSessionId()`：用 session id 排序選 deterministic host，對應官方文件建議的 host rotation 思路。

### 前端 Nakama Service

- `lib/nakama/service.ts`：前端 service 對外入口，只重新匯出拆分後的 `types / dashboard / chat`，讓 component 維持從同一路徑 import。

### 前端 Nakama Types

- `lib/nakama/types.ts`：共用型別檔，不放 runtime logic。
- `RuntimeContext`：前端需要的 RPC id、leaderboard id 與 runtime mode。
- `AuthPayload`：登入 / 註冊表單資料。
- `CommunityPayload`：建立 group / guild 的表單資料。
- `DashboardSnapshot`：首頁主要讀模型，包含 profile、friends、communities、leaderboards。
- `FriendView`：Friends tab 使用的好友資料。
- `UserSearchCandidate`：新增好友玩家搜尋的候選資料，不是既有好友關係。
- `CommunityView`：group/guild 列表卡片使用的資料模型。
- `GuildDetail`：guild detail 頁完整讀模型，包含 members、requests、audit、contributions、metrics。
- `ChatTarget`：聊天室目標抽象，代表 friend/group/guild。
- `ChatSession`：已開啟聊天室的 channel id、target、messages 與 cursor。
- `RealtimeMetaSnapshot`：online users、channel presence、typing 狀態的快照。
- `RelayedMatchPresenceView`：relayed match presence 讀模型，包含 user id、session id、username、node、是否為自己。
- `RelayedMatchSession`：已加入 relayed match 的 session 狀態，包含 match id、self、presences、host session id。
- `RelayedMatchPayload`：match data payload 基礎型別，支援 ready、timer sync、ping/pong nonce 等欄位。
- `RelayedMatchEvent`：單筆 match data event，用於 UI event log。
- `RelayedMatchPresenceEvent`：presence join/leave event，用於更新 opponents 與 host rotation。
- `MatchLobbyView`：group/guild lobby 讀模型，包含 match id、host、createdAt、expiresAt、status。
- `MatchResultView`：match result 後端保存結果，包含 score、participants、ready users、event hash、validation。

### 前端 Nakama Client

- `lib/nakama/client.ts`：Nakama client、session、runtime env 與錯誤處理。
- `getNakamaClient()`：依 `.env.local` 建立 Nakama client。
- `getRuntimeContext()`：集中讀取 RPC id、leaderboard id、server 設定。
- `restoreLiveSession()`：從 localStorage 還原 Nakama session，必要時自動 refresh token。
- `requireLiveSession()`：要求目前必須有有效 session，沒有就丟出登入錯誤。
- `persistLiveSession()`：把 session token / refresh token 寫入 localStorage。
- `clearLiveSession()`：清除 localStorage 中的 session。
- `validateAuthPayload()`：檢查登入 / 註冊表單必要欄位。
- `parseRpcPayload()`：解析 Nakama RPC response 的 payload JSON。
- `toLiveModeError()`：把 Nakama / fetch / SDK error 包裝成可 debug 的 live mode error。
- `emptySnapshot()`：建立未登入或無資料時的 dashboard snapshot。
- `safeStorageGet()`：安全讀取 localStorage，避免 SSR 或瀏覽器限制造成錯誤。
- `safeStorageSet()`：安全寫入 localStorage。
- `safeStorageRemove()`：安全刪除 localStorage key。
- `extractErrorMessage()`：從 Error 或 Response 中取出可判斷的錯誤訊息。
- `cryptoFallbackId()`：在沒有 crypto.randomUUID 時產生 fallback id。

### 前端 Nakama Dashboard

- `lib/nakama/dashboard.ts`：登入、好友、group/guild、leaderboard、detail page 的資料流程。
- `bootstrapPhaseOne()`：前端啟動時嘗試恢復 session，成功則載入 dashboard，失敗則回傳空 snapshot。
- `registerWithEmail()`：使用 email/password 建立 Nakama 使用者，成功後保存 session。
- `loginWithEmail()`：使用 email/password 登入既有 Nakama 使用者。
- `logoutFromRuntime()`：清除 session 與 realtime state，回到未登入狀態。
- `sendFriendInvite()`：用 username 送出 Nakama friend invite。
- `searchUsersForFriendInvite()`：呼叫後端 `search_users` RPC 搜尋可邀請玩家候選。
- `createCommunity()`：建立 group 或 guild；guild 會額外呼叫 `create_guild` RPC 建立治理資料。
- `inviteCommunityMember()`：邀請使用者加入 group 或 guild。
- `promoteCommunityMember()`：提升 group/guild 成員權限；guild 走 authoritative RPC。
- `demoteCommunityMember()`：降低 group/guild 成員權限；guild 走 authoritative RPC。
- `transferCommunityOwnership()`：轉移 group/guild owner；guild 走 authoritative RPC。
- `requestGuildJoin()`：申請加入 guild，寫入後端 join request。
- `joinCommunity()`：加入一般 group。
- `leaveGroup()`：離開一般 group。
- `approveGuildJoin()`：核准 guild join request。
- `rejectGuildJoin()`：拒絕 guild join request。
- `leaveGuild()`：離開 guild，並處理後端已離開但前端尚未同步的情況。
- `disbandGuild()`：owner 解散 guild，成功後重載 dashboard。
- `kickGuildMember()`：owner/admin 踢出 guild member。
- `acceptFriend()`：接受好友邀請。
- `rejectFriend()`：拒絕好友邀請。
- `removeFriend()`：刪除好友。
- `fetchGuildDetail()`：呼叫 `get_guild_detail` RPC，取得 guild 完整 detail。
- `updateGuildSettings()`：更新 guild announcement / join policy。
- `fetchCommunityDetail()`：取得 group/guild 共用 detail；guild 會合併 guild RPC 結果。
- `submitPortfolioScore()`：送出 portfolio score RPC，並合併回傳 leaderboard record。
- `loadLiveDashboard()`：從 Nakama API/RPC 組出 dashboard snapshot。
- `safeListLeaderboardRecords()`：安全讀取排行榜，避免單一 leaderboard 失敗拖垮 dashboard。
- `loadLiveGuildRequests()`：讀取指定 guild 的待審核加入申請。
- `listLiveUserGroups()`：列出使用者所屬 groups，包含 Nakama SDK 參數順序 workaround。
- `mergeDiscoverableCommunities()`：合併自己加入的 communities 與 discoverable groups。
- `mapLiveFriend()`：把 Nakama friend object 轉成 UI 使用的 `FriendView`。
- `mapLiveCommunity()`：把 Nakama group membership 轉成 UI 使用的 `CommunityView`。
- `mapLeaderboardRecords()`：把 Nakama leaderboard records 轉成 dashboard 可顯示資料。
- `mergeSubmittedLeaderboardRecords()`：把剛送出的 score record 合併進 dashboard leaderboard。
- `mergeLeaderboardEntry()`：把單筆 leaderboard entry 合併到既有列表並重新排序。
- `mapFriendState()`：把 Nakama friend state number 轉成 UI enum。
- `mapGroupRole()`：把 Nakama group user state number 轉成 owner/admin/member/requested/visitor。
- `isGuildAlreadyLeftError()`：判斷 leave guild 失敗是否其實代表後端已離開。
- `hasActiveGuildMembership()`：檢查 dashboard snapshot 中是否仍有有效 guild membership。

### 前端 Nakama Chat

- `lib/nakama/chat.ts`：realtime socket、聊天室 channel、未讀數、presence、typing signal。
- `lib/nakama/match.ts`：relayed match socket、matchmaker、match lobby、match data、presence listener、resume cache。
- `buildChatTargets()`：從 dashboard snapshot 產生可聊天 target 清單。
- `openChatSession()`：開啟指定 target 的聊天室，join channel 並載入歷史訊息。
- `loadOlderChatMessages()`：依 cursor 載入更早 channel messages。
- `sendChatMessage()`：送出聊天訊息，必要時先確保已 join channel。
- `sendTypingSignal()`：送出 typing system message。
- `subscribeToChatChannel()`：為指定 channel 註冊新訊息 listener，並回傳取消 listener 的 function。
- `primeRealtimeChat()`：預熱 socket、追蹤好友 presence，並準備 realtime meta。
- `subscribeToUnreadCounts()`：註冊未讀訊息數 listener，未讀數變更時會呼叫 listener。
- `subscribeToRealtimeMeta()`：註冊 presence / typing metadata listener，狀態變更時會呼叫 listener。
- `markChatTargetRead()`：將指定 chat target 標記為已讀。
- `resetRealtimeState()`：清空 socket、channel cache、未讀數、presence、typing 狀態。
- `ensureLiveSocket()`：建立或重用 Nakama realtime socket。
- `ensureLiveChatChannelId()`：依 ChatTarget join 正確 channel，並快取 target 與 channel id 對應。
- `normalizeChannelMessages()`：批次轉換 channel messages。
- `normalizeChannelMessage()`：單筆聊天訊息轉成 UI view model。
- `extractChatBody()`：從 Nakama message content 中取出文字 body。
- `isTypingSignalMessage()`：判斷 channel message 是否為 typing signal。
- `registerTypingSignal()`：記錄 typing 狀態並設定自動過期 timer。
- `getChatTargetKey()`：產生 chat target 的穩定 key。
- `resolveChatJoinTarget()`：把 friend/group/guild target 轉成 Nakama joinChat 需要的 channel target。
- `getUnreadCountsSnapshot()`：建立目前未讀數快照。
- `emitUnreadCounts()`：通知所有未讀數 listener。
- `buildRealtimeMetaSnapshot()`：建立 presence / typing metadata 快照。
- `emitRealtimeMeta()`：通知所有 realtime metadata listener。
- `describeSocketError()`：把 socket error 轉成較可讀的錯誤字串。

### Nakama Go Runtime

- `nakama/runtime.go`：Nakama authoritative backend，負責 guild governance、score、leaderboard、search RPC。
- `nakama/go.mod`：Go runtime plugin 的 module 與 Nakama dependency 設定。
- `nakama/Dockerfile`：編譯 Go plugin `backend.so` 並打包到 Nakama image。
- `nakama/local.yml`：本地 Nakama 設定，包含 console、runtime、logger、socket 等設定。
- `InitModule()`：Nakama plugin 入口，註冊所有 RPC 與初始化 leaderboard。
- `registerLeaderboards()`：建立 / 確保 global、weekly、guild average leaderboard 存在。
- `rpcGetPhaseConfigHandler()`：回傳前端需要的 RPC id、leaderboard id 與規則設定。
- `rpcSubmitPortfolioScoreHandler()`：驗證並寫入 portfolio score，同步更新排行榜。
- `rpcCreateGuildHandler()`：建立 guild governance storage、owner membership、audit log。
- `rpcRequestGuildJoinHandler()`：建立 guild join request。
- `rpcApproveGuildJoinHandler()`：核准加入 guild，更新 group roster 與 guild membership。
- `rpcRejectGuildJoinHandler()`：拒絕加入 guild，刪除 join request 並寫 audit。
- `rpcLeaveGuildHandler()`：使用者離開 guild，處理 owner 不能直接離開的規則。
- `rpcDisbandGuildHandler()`：owner 解散 guild，刪除 group 與所有 guild membership。
- `rpcKickGuildMemberHandler()`：owner/admin 踢出 guild member。
- `rpcGetGuildDetailHandler()`：回傳 guild detail 所需的 members、requests、audit、contributions、metrics。
- `rpcListGuildJoinRequestsHandler()`：列出指定 guild 的待審核申請。
- `rpcUpdateGuildSettingsHandler()`：更新 guild announcement 與 join policy。
- `rpcSearchUsersHandler()`：提供前端好友搜尋的模糊查詢。
- `rpcCreateMatchLobbyHandler()`：建立 group/guild match lobby record，保存 match id、host、createdAt、expiresAt。
- `rpcListMatchLobbiesHandler()`：列出指定 group/guild 的 open lobbies，並清理過期 lobby。
- `rpcCloseMatchLobbyHandler()`：關閉指定 lobby，host 或 community admin/owner 可以操作。
- `rpcSubmitMatchResultHandler()`：驗證並保存 match result，檢查 lobby、membership、host、participants、ready users、event count、event hash。
- `matchLobbyTTLMinutes`：match lobby 存活時間設定，目前用來產生 `expiresAt` 並在 list/get 時清理過期 lobby。
- `rpcInviteGuildMemberHandler()`：owner/admin 邀請使用者加入 guild。
- `rpcPromoteGuildAdminHandler()`：owner 將 member 升為 admin。
- `rpcDemoteGuildAdminHandler()`：owner 將 admin 降為 member。
- `rpcTransferGuildOwnerHandler()`：owner 將公會所有權轉移給其他成員。
- `readGuildMembership()`：讀取使用者目前所屬 guild。
- `writeGuildMembership()`：寫入使用者 guild membership storage。
- `deleteGuildMembership()`：刪除使用者 guild membership storage。
- `readGuildConfig()`：讀取 guild config global storage。
- `writeGuildConfig()`：寫入 guild config global storage。
- `listActiveGuildMembers()`：列出 guild 目前 active members。
- `findGroupUserByID()`：從 group members 中找指定 user id。
- `ensureUserCanManageGuild()`：確認使用者是否 owner/admin。
- `ensureUserIsGuildOwner()`：確認使用者是否 guild owner。
- `appendGuildAudit()`：寫入 guild governance audit event。
- `listGuildAudit()`：讀取 guild audit log。
- `listGuildJoinRequestsForGuild()`：讀取指定 guild 的所有 join requests。
- `getGuildJoinRequestOrThrow()`：讀取單筆 join request，不存在則回錯誤。
- `deleteGuildJoinRequest()`：刪除 join request。
- `updateGuildAverageLeaderboard()`：依使用者 guild membership 重新計算 guild average leaderboard。
- `updateGuildAverageLeaderboardForGuild()`：針對指定 guild 重新計算平均分數。
- `parseSubmitScorePayload()`：解析 submit score RPC payload。
- `parseGuildIDPayload()`：解析只需要 guild id 的 RPC payload。
- `parseApproveGuildJoinPayload()`：解析 guild id + user id 類型 payload。
- `parseCreateGuildPayload()`：解析 create guild payload。
- `parseUpdateGuildSettingsPayload()`：解析 guild settings payload。
- `parseSearchUsersPayload()`：解析 search users payload。
- `requireUserID()`：要求 RPC context 必須有登入 user id。
- `runtimeError()`：建立 Nakama runtime error，統一錯誤 code 與 message。

### 其他輔助檔案

- `lib/utils.ts`：通用工具檔，目前主要提供 shadcn/ui className 合併工具。
- `cn()`：合併 Tailwind className，處理 conditional class 與 class conflict。
- `components/ui/*`：shadcn/ui 與 Radix UI 基礎元件，不承載業務邏輯。
- `components/ui/button.tsx`：按鈕元件，統一 variant、size、disabled 樣式。
- `components/ui/card.tsx`：卡片元件，dashboard 與 detail page 的主要容器。
- `components/ui/dialog.tsx`：彈窗元件，常用於新增好友、建立 community、確認 disband。
- `components/ui/tabs.tsx`：分頁元件，用於 guild detail / community detail。
- `components/ui/alert.tsx`：訊息提示元件，用於 error、empty state、狀態提醒。
- `components/ui/badge.tsx`：小型狀態標籤，用於 role、kind、status。
- `components/ui/scroll-area.tsx`：可捲動容器，用於 chat history、leaderboard、member list。

本文件用來協助快速閱讀與審查本專案程式碼。重點不是取代 `ARCHITECTURE.md`，而是提供一條可操作的 code review 路線：先知道從哪裡進入，再追核心流程，最後檢查資料模型、debug 指令與風險點。

---

## 1. 專案定位

本專案目前是 live-only 架構：

- 前端：Next.js + React client components + shadcn/ui
- 後端：Nakama + PostgreSQL
- 後端業務規則：Nakama Go runtime plugin
- 即時功能：Nakama realtime socket / channel
- 主要功能：帳號登入、好友、公會 / 群組、排行榜、即時聊天、公會治理

目前已不再使用 mock mode。前端如果無法連到 Nakama，應該明確報錯，而不是退回假資料。

---

## 2. 主要檔案導讀

### 2.1 App 入口

檔案：

- [app/page.tsx](c:/Users/kdsam/Documents/nakamafrontend/app/page.tsx:1)：首頁 route 入口，主要掛載 `PhaseOneDashboard`。
- [app/layout.tsx](c:/Users/kdsam/Documents/nakamafrontend/app/layout.tsx:1)：全站 root layout，設定 metadata、字型與 dark theme。
- [app/globals.css](c:/Users/kdsam/Documents/nakamafrontend/app/globals.css:1)：全域樣式與 shadcn/ui token。

程式碼位置：

- [PhaseOneDashboard 掛載點](c:/Users/kdsam/Documents/nakamafrontend/app/page.tsx:1)：確認首頁沒有放太多業務邏輯。
- [RootLayout](c:/Users/kdsam/Documents/nakamafrontend/app/layout.tsx:13)：檢查全站 `<html>` / `<body>` 設定。
- [globals.css](c:/Users/kdsam/Documents/nakamafrontend/app/globals.css:1)：檢查 design token、背景、深色系設定。

審查重點：

- `app/page.tsx` 只負責載入 `PhaseOneDashboard`
- `app/layout.tsx` 負責全域 layout、字型與 dark theme
- `app/globals.css` 定義 shadcn/ui token 與金融 SaaS 深色視覺基礎

閱讀方式：

先看 `app/page.tsx`，確認首頁入口很薄。真正的狀態與操作都在 `components/phase-one-dashboard.tsx`。

---

### 2.2 首頁控制台

檔案：

- [components/phase-one-dashboard.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx:1)

這是使用者主要操作介面。它回答：

```text
使用者在畫面上做了什麼？
```

主要區塊：

- `snapshot`
  - 首頁資料的單一讀模型
  - 包含 profile、friends、communities、leaderboards
- [`bootstrapPhaseOne()` 呼叫位置](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx:109)
  - 首頁載入時建立初始狀態
- [`runMutation()`](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx:194)
  - 集中處理 busy / error / message
- [`handleAuthSubmit()`](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx:210)
  - 註冊 / 登入
- [`handleCommunitySubmit()`](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx:238)
  - 建立 group / guild
- [`handleScoreSubmit()`](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx:254)
  - 提交排行榜分數
- [`primaryGuild`](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx:373)
  - 首頁 `Current governance view` 使用的目前公會

其他常看位置：

- [好友搜尋 debounce](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx:133)：搜尋好友時延遲短時間再打 API。
- [好友送邀請](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx:221)：送出 friend invite。
- [Guild leave handler](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx:319)：首頁離開目前 guild。
- [CommunityCard](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx:995)：group/guild 卡片操作入口。
- [模糊搜尋 helper](c:/Users/kdsam/Documents/nakamafrontend/components/phase-one-dashboard.tsx:1300)：好友、group、guild 搜尋共用邏輯。

審查重點：

- 未登入時只應顯示產品介紹與 Access 區塊
- 登入後才顯示 Friends / Communities / Leaderboards / Chats
- `primaryGuild` 只能接受 `owner / admin / member`
- `visitor / requested` 不能出現在目前公會摘要
- mutation 成功後應以後端回傳 snapshot 為準，不要手動 patch 大量 UI 狀態

---

### 2.3 前端 Nakama Service

檔案：

- [lib/nakama/service.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/service.ts:1)：service 對外入口，只重新匯出拆分後的 `types / dashboard / chat`。
- [lib/nakama/types.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:1)：共用型別，不放 runtime logic。
- [lib/nakama/client.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/client.ts:1)：Nakama client、session、runtime env、錯誤處理。
- [lib/nakama/dashboard.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/dashboard.ts:1)：登入、好友、group/guild、leaderboard、detail page 資料流程。
- [lib/nakama/chat.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/chat.ts:1)：realtime socket、聊天室 channel、未讀數、presence、typing signal。

`service.ts` 本身不再承載大量實作。React component 仍然從 `@/lib/nakama/service` 匯入功能，但真正的程式碼依責任拆在不同檔案。

#### `types.ts`

- `RuntimeContext`：前端需要的 RPC id、leaderboard id 與 runtime mode。
- `DashboardSnapshot`：首頁完整讀模型，包含 profile、friends、communities、leaderboards。
- `FriendView`：好友清單使用的資料模型。
- `UserSearchCandidate`：新增好友搜尋回來的玩家候選，不是既有好友關係。
- `CommunityView`：group/guild 卡片使用的資料模型。
- `GuildDetail`：guild detail 完整讀模型，包含 members、requests、audit、contributions、metrics。
- `ChatTarget`：聊天室目標抽象，代表 friend/group/guild。
- `ChatSession`：已開啟聊天室的 channel id、target、messages 與 cursor。
- `RealtimeMetaSnapshot`：online users、channel presence、typing 狀態快照。

#### `client.ts`

- `getNakamaClient()`：依 `.env.local` 建立 Nakama client。
- `getRuntimeContext()`：集中讀取 RPC id、leaderboard id、server 設定。
- `restoreLiveSession()`：從 localStorage 還原 Nakama session，必要時自動 refresh token。
- `requireLiveSession()`：要求目前必須有有效 session，沒有就丟出登入錯誤。
- `persistLiveSession()`：把 session token / refresh token 寫入 localStorage。
- `clearLiveSession()`：清除 localStorage 中的 session。
- `validateAuthPayload()`：檢查登入 / 註冊表單必要欄位。
- `parseRpcPayload()`：解析 Nakama RPC response 的 payload JSON。
- `toLiveModeError()`：把 Nakama / fetch / SDK error 包裝成可 debug 的 live mode error。
- `emptySnapshot()`：建立未登入或無資料時的 dashboard snapshot。
- `extractErrorMessage()`：從 Error 或 Response 中取出可判斷的錯誤訊息。

#### `dashboard.ts`

- `bootstrapPhaseOne()`：前端啟動時嘗試恢復 session，成功則載入 dashboard，失敗則回傳空 snapshot。
- `registerWithEmail()`：使用 email/password 建立 Nakama 使用者，成功後保存 session。
- `loginWithEmail()`：使用 email/password 登入既有 Nakama 使用者。
- `logoutFromRuntime()`：清除 session 與 realtime state，回到未登入狀態。
- `sendFriendInvite()`：用 username 送出 Nakama friend invite。
- `searchUsersForFriendInvite()`：呼叫後端 `search_users` RPC 搜尋可邀請玩家候選。
- `createCommunity()`：建立 group 或 guild；guild 會額外呼叫 `create_guild` RPC 建立治理資料。
- `requestGuildJoin()`：申請加入 guild，寫入後端 join request。
- `approveGuildJoin()`：核准 guild join request。
- `rejectGuildJoin()`：拒絕 guild join request。
- `leaveGuild()`：離開 guild，並處理後端已離開但前端尚未同步的情況。
- `disbandGuild()`：owner 解散 guild，成功後重載 dashboard。
- `fetchGuildDetail()`：呼叫 `get_guild_detail` RPC，取得 guild 完整 detail。
- `submitPortfolioScore()`：送出 portfolio score RPC，並合併回傳 leaderboard record。
- `loadLiveDashboard()`：從 Nakama API/RPC 組出 dashboard snapshot。
- `mapLiveFriend()`：把 Nakama friend object 轉成 UI 使用的 `FriendView`。
- `mapLiveCommunity()`：把 Nakama group membership 轉成 UI 使用的 `CommunityView`。
- `mapLeaderboardRecords()`：把 Nakama leaderboard records 轉成 dashboard 可顯示資料。

#### `chat.ts`

- `buildChatTargets()`：從 dashboard snapshot 產生可聊天 target 清單。
- `openChatSession()`：開啟指定 target 的聊天室，join channel 並載入歷史訊息。
- `loadOlderChatMessages()`：依 cursor 載入更早 channel messages。
- `sendChatMessage()`：送出聊天訊息，必要時先確保已 join channel。
- `sendTypingSignal()`：送出 typing system message。
- `subscribeToChatChannel()`：為指定 channel 註冊新訊息 listener，並回傳取消 listener 的 function。
- `primeRealtimeChat()`：預熱 socket、追蹤好友 presence，並準備 realtime meta。
- `subscribeToUnreadCounts()`：註冊未讀訊息數 listener，未讀數變更時會呼叫 listener。
- `subscribeToRealtimeMeta()`：註冊 presence / typing metadata listener，狀態變更時會呼叫 listener。
- `markChatTargetRead()`：將指定 chat target 標記為已讀。
- `resetRealtimeState()`：清空 socket、channel cache、未讀數、presence、typing 狀態。
- `ensureLiveSocket()`：建立或重用 Nakama realtime socket。
- `ensureLiveChatChannelId()`：依 ChatTarget join 正確 channel，並快取 target 與 channel id 對應。
- `resolveChatJoinTarget()`：把 friend/group/guild target 轉成 Nakama joinChat 需要的 channel target。

---
### 2.4 Nakama Go Runtime

檔案：

- [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1)：Go authoritative runtime 主程式。
- [nakama/go.mod](c:/Users/kdsam/Documents/nakamafrontend/nakama/go.mod:1)：Go plugin module 與 dependency。
- [nakama/Dockerfile](c:/Users/kdsam/Documents/nakamafrontend/nakama/Dockerfile:1)：編譯 `backend.so` 並打包 Nakama image。
- [nakama/local.yml](c:/Users/kdsam/Documents/nakamafrontend/nakama/local.yml:1)：Nakama 本地設定。

這是後端 authoritative logic。它回答：

```text
真正的規則在哪裡被裁決？
```

主要入口：

- [`InitModule()`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:185)：Nakama 啟動時註冊 RPC。
- [`registerLeaderboards()`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:230)：建立三張 authoritative leaderboard。

主要 RPC：

- [`get_phase_config`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:262)：回傳前端 runtime 設定。
- [`submit_portfolio_score`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:312)：提交分數、寫 storage、寫排行榜。
- [`create_guild`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:403)：初始化 guild governance 資料。
- [`request_guild_join`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:702)：建立 guild 加入申請。
- [`approve_guild_join`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:767)：核准申請並寫 membership。
- [`reject_guild_join`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:821)：拒絕申請並刪 request。
- [`leave_guild`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:849)：離開 guild，檢查 owner 規則。
- [`disband_guild`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:912)：解散 guild。
- [`kick_guild_member`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:963)：踢出 guild 成員。
- [`get_guild_detail`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1035)：組合 guild detail 讀模型。
- [`list_guild_join_requests`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1012)：列出 pending requests。
- [`update_guild_settings`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1090)：更新公告與加入政策。
- [`search_users`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1144)：好友搜尋用模糊查詢。
- [`invite_guild_member`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:484)：邀請成員。
- [`promote_guild_admin`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:550)：升級 admin。
- [`demote_guild_admin`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:598)：降級 admin。
- [`transfer_guild_owner`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:644)：轉移 owner。

重要 helper 位置：

- [`updateGuildAverageLeaderboardForGuild()`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1226)：依 guild 成員 score 重算平均榜。
- [`writeGuildMembership()`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1399)：寫入使用者目前 guild。
- [`readGuildMembership()`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1445)：讀取使用者目前 guild。
- [`writeGuildConfig()`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1415)：寫入 guild 設定 global object。
- [`appendGuildAudit()`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1606)：寫治理 audit log。
- [`requireUserID()`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1806)：所有登入 RPC 的基本檢查。
- [`parsePayload()`](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1821)：RPC payload JSON 解析。

審查重點：

- 所有 guild 權限必須在 runtime 裡檢查
- 前端按鈕只是送出意圖，不是權限來源
- `submit_portfolio_score` 應同時寫 storage 與 leaderboard
- guild average 必須由 server 根據成員分數重新計算
- `guild_config` 是 global storage object，不應把 guild id 當成 `UserID`
- `guild_membership` 是單一公會限制的核心資料
- `group roster` 與 `guild_membership storage` 必須盡量同步
- audit log 應記錄治理事件，例如 approve、reject、kick、leave、settings update

---

### 2.5 Guild Detail

檔案：

- [app/guilds/[id]/page.tsx](c:/Users/kdsam/Documents/nakamafrontend/app/guilds/[id]/page.tsx:1)：guild detail route。
- [components/guild-detail-client.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx:1)：guild detail client component。

程式碼位置：

- [`GuildDetailClient()`](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx:42)：公會詳情主元件。
- [`reloadDetail()`](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx:95)：mutation 後重抓 detail。
- [`handleLeaveGuild()`](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx:127)：離開公會。
- [`handleDisbandGuild()`](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx:143)：解散公會。
- [`handleSettingsSubmit()`](c:/Users/kdsam/Documents/nakamafrontend/components/guild-detail-client.tsx:172)：更新公會設定。

這是公會治理頁。它回答：

```text
公會治理狀態如何呈現與操作？
```

主要區塊：

- Members
- Pending Requests
- Insights
- Audit Log
- Chat

審查重點：

- `fetchGuildDetail()` 應回傳完整讀模型
- mutation 後應重抓 detail
- owner/admin UI 可限制按鈕顯示，但真正權限仍在 runtime
- contribution panel 只是讀模型，不是排行榜真相來源
- audit log 來源應是後端寫入，不是前端推導

---

### 2.6 Community Detail

檔案：

- [app/communities/[id]/page.tsx](c:/Users/kdsam/Documents/nakamafrontend/app/communities/[id]/page.tsx:1)：community detail route。
- [components/community-detail-client.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/community-detail-client.tsx:1)：group/guild 共用 detail client component。

程式碼位置：

- [`CommunityDetailClient()`](c:/Users/kdsam/Documents/nakamafrontend/components/community-detail-client.tsx:29)：共用詳情主元件。
- [`handleLeave()`](c:/Users/kdsam/Documents/nakamafrontend/components/community-detail-client.tsx:76)：依 kind 決定 leave group 或 guild。
- [`reloadDetail()`](c:/Users/kdsam/Documents/nakamafrontend/components/community-detail-client.tsx:97)：操作後重抓 detail。
- [`runMemberAction()`](c:/Users/kdsam/Documents/nakamafrontend/components/community-detail-client.tsx:104)：member action 共用 wrapper。
- [`handleInviteSubmit()`](c:/Users/kdsam/Documents/nakamafrontend/components/community-detail-client.tsx:118)：邀請成員。

這是 group 或 guild 的輕量 detail 頁。group 主要走 Nakama 原生 group API；guild 仍會導向更完整的 guild detail 資料模型。

審查重點：

- group 與 guild 的權限模型不要混在一起
- group leave / detail 不應誤用 guild RPC
- guild detail 相關資訊應由 `fetchGuildDetail()` 回傳

---

### 2.7 Realtime Chat

檔案：

- [components/realtime-chat-panel.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:1)：聊天室 UI component，負責 target list、message list、輸入框、typing、presence 與未讀數顯示。
- [lib/nakama/chat.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/chat.ts:1)：聊天室 service，負責 socket、join channel、message listener、history、typing signal 與 unread counts。

`components/realtime-chat-panel.tsx` 主要項目：

- [`RealtimeChatPanel()`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:31)：聊天室主元件，依 `snapshot` 或 `forcedTarget` 決定可聊天對象。
- [`dynamicTargets`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:42)：由 dashboard snapshot 轉出的可聊天對象。
- [`targets`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:43)：實際顯示的 target 清單；detail page 會只保留 `forcedTarget`。
- [`selectedTargetId`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:44)：dashboard 模式下目前選到的 target key。
- [`chatSession`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:45)：目前 channel、target、messages、cursor 的集合。
- [`messageBody`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:46)：輸入框文字。
- [`loading`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:47)：正在開啟 channel 或載入第一頁訊息。
- [`loadingOlder`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:48)：正在載入更早歷史訊息。
- [`sending`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:49)：正在送出訊息。
- [`unreadCounts`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:51)：各 target 的未讀數。
- [`realtimeMeta`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:52)：presence、online、typing metadata。
- [`suppressNextAutoScrollRef`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:58)：載入舊訊息時避免自動跳到底部。
- [`lastTypingSignalAtRef`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:59)：typing signal 節流控制。
- [`activeTarget`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:61)：目前實際開啟的 friend/group/guild target。
- [`primeRealtimeChat()` effect](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:69)：登入後預熱 socket、presence 與可聊天 channels。
- [`subscribeToUnreadCounts()` effect](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:77)：註冊未讀數 listener，把變更寫入 `unreadCounts`。
- [`subscribeToRealtimeMeta()` effect](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:83)：註冊 presence / typing listener，把變更寫入 `realtimeMeta`。
- [`openChatSession()` effect](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:89)：target 變更時開啟聊天室並載入歷史。
- [`subscribeToChatChannel()` effect](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:123)：為目前 channel 註冊新訊息 listener。
- [`auto scroll effect`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:146)：新訊息進來時捲到底部。
- [`sendTypingSignal()` effect](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:155)：使用者輸入時送 typing signal。
- [`handleSend()`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:169)：送出訊息，包含 optimistic message、server ack 替換、failed state。
- [`handleLoadOlder()`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:227)：載入更舊訊息並合併到目前訊息列表。
- [`content`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:262)：聊天室主卡片 UI。
- [`target list`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:361)：dashboard 模式下的聊天對象清單。
- [`mergeMessages()`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:423)：合併訊息、去重、依時間排序。
- [`appendUniqueMessage()`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:431)：新增單筆訊息並避免重複。
- [`replaceMessageById()`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:435)：用正式訊息替換 optimistic message。
- [`markMessageDelivery()`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:442)：更新訊息送達狀態。
- [`getTargetKey()`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:446)：產生 target key，例如 `friend:<id>` 或 `guild:<id>`。
- [`initialsFromName()`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:454)：產生 avatar fallback 字首。
- [`formatTimestamp()`](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-chat-panel.tsx:463)：格式化訊息時間。

`lib/nakama/chat.ts` 相關函式：

- [`buildChatTargets()`](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/chat.ts:37)：從 dashboard snapshot 建立聊天對象。
- [`openChatSession()`](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/chat.ts:65)：join channel 並載入歷史。
- [`sendChatMessage()`](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/chat.ts:95)：透過 socket 寫入訊息。
- [`subscribeToChatChannel()`](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/chat.ts:132)：為指定 channel 註冊新訊息 listener。
- [`resolveChatJoinTarget()`](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/chat.ts:367)：決定 friend/group/guild 的 join target。

---
## 3. 核心函式導讀

本章不再用流程圖說明，而是直接列出主要函式與它們的責任。閱讀時可以把它當成索引：看到函式名稱，就能知道它在整個系統中的角色。

### 3.1 App 與 Dashboard

- `app/page.tsx`：首頁 route，只負責渲染 `PhaseOneDashboard`，不承載業務邏輯。
- `PhaseOneDashboard()`：登入前後的主畫面元件，集中管理 snapshot、表單、tabs、mutation 狀態與主要操作入口。
- `createEmptyAuth()`：建立空的登入 / 註冊表單初始值，避免共用同一個物件 reference。
- `createEmptyCommunity()`：建立空的 group / guild 建立表單初始值。
- `useEffect(bootstrapPhaseOne)`：元件第一次載入時嘗試還原 Nakama session，並把結果寫入 `snapshot`。
- `runMutation()`：統一包裝會改動後端的操作，負責 busy、error、message 與成功後的 state 更新。
- `handleAuthSubmit()`：依目前 `authMode` 呼叫 `registerWithEmail()` 或 `loginWithEmail()`。
- `handleFriendSubmit()`：使用 `friendInviteUsername` 送出好友邀請。
- `handleCommunitySubmit()`：建立 group 或 guild，依 `communityForm.kind` 決定後端路徑。
- `handleScoreSubmit()`：將使用者輸入的分數轉成 number 後送到 `submitPortfolioScore()`。
- `handleLogout()`：登出並清空 dashboard snapshot 與 realtime 狀態。
- `handleGuildLeave()`：從首頁的 Current governance view 離開目前 guild。
- `primaryGuild`：從 `snapshot.communities` 找出目前有效的 guild membership，只接受 owner/admin/member。
- `friendInviteUsername`：Add friend dialog 裡的玩家搜尋輸入，用來找尚未加好友的 Nakama 使用者。
- `friendInviteUserMatches`：`searchUsersForFriendInvite()` 回傳的新增好友候選玩家。
- `friendInviteUserSearching`：新增好友玩家搜尋的 loading 狀態。
- `existingFriendSearchQuery`：Friends tab 的本地搜尋輸入，只過濾既有 `snapshot.friends`。
- `filteredExistingFriends`：既有好友清單經 fuzzy match 後的顯示結果。
- `filteredCommunities`：group/guild 清單經 fuzzy match 後的顯示結果。
- `CommunityCard()`：單一 group/guild 卡片，呈現加入、申請、離開、查看 detail 等操作。
- `LeaderboardList()`：排行榜列表顯示元件，接收整理好的 entries 後只負責渲染。
- `fuzzyMatch()`：本地模糊搜尋 helper，支援 includes 與簡單子序列比對。
- `normalizeSearch()`：將搜尋字串轉小寫並移除多餘空白，讓比對更穩定。

### 3.2 Nakama Client 與 Session

- `getNakamaClient()`：依 `.env.local` 建立並快取 Nakama HTTP client。
- `getRuntimeContext()`：集中整理 RPC id 與 leaderboard id，避免 UI 到處硬編字串。
- `restoreLiveSession()`：從 localStorage 還原 Nakama session，必要時自動 refresh token。
- `requireLiveSession()`：要求目前必須有有效 session，沒有就丟出登入錯誤。
- `persistLiveSession()`：登入 / 註冊成功後保存 token 與 refresh token。
- `clearLiveSession()`：登出時清除瀏覽器端 session。
- `validateAuthPayload()`：檢查 email、password、register username 等基本表單欄位。
- `parseRpcPayload()`：解析 Nakama RPC payload，處理 payload 可能是 string 或 object 的差異。
- `toLiveModeError()`：把各種錯誤包裝成 `[live:action]` 格式，方便定位是哪個操作失敗。
- `emptySnapshot()`：建立未登入或無資料時的 dashboard snapshot。
- `safeStorageGet()` / `safeStorageSet()` / `safeStorageRemove()`：安全操作 localStorage，避免 SSR 或瀏覽器限制造成錯誤。
- `cryptoFallbackId()`：在沒有 `crypto.randomUUID()` 時產生 UI 暫用 id。
- `extractErrorMessage()`：從 Error 或 Response 取出文字，供 `leaveGuild()` 等容錯邏輯判斷。

### 3.3 Dashboard Service

- `bootstrapPhaseOne()`：首頁啟動時還原 session，成功則載入 live dashboard，失敗則回傳空 snapshot 或 live error。
- `registerWithEmail()`：建立 Nakama email 帳號，保存 session，並回傳完整 dashboard snapshot。
- `loginWithEmail()`：登入既有 Nakama 帳號，保存 session，並回傳完整 dashboard snapshot。
- `logoutFromRuntime()`：清除 session 與 realtime state，回到未登入 snapshot。
- `sendFriendInvite()`：用 username 呼叫 Nakama friend API 送出好友邀請。
- `searchUsersForFriendInvite()`：呼叫 `search_users` RPC 搜尋可邀請的玩家候選。
- `createCommunity()`：建立 group 或 guild；guild 會先建立 private group，再呼叫 `create_guild` RPC 初始化治理資料。
- `inviteCommunityMember()`：邀請成員加入 group/guild；guild 走 RPC，group 走原生 API。
- `promoteCommunityMember()`：提升成員權限；guild 走 RPC，group 走原生 promote API。
- `demoteCommunityMember()`：降低成員權限；guild 走 RPC，group 走原生 demote API。
- `transferCommunityOwnership()`：轉移 owner；guild 由 runtime 裁決，group 用 promote/demote 組合達成。
- `requestGuildJoin()`：送出 guild 加入申請。
- `joinCommunity()`：加入一般 open group。
- `leaveGroup()`：離開一般 group。
- `approveGuildJoin()`：核准 guild 加入申請，後端同步 group roster 與 membership storage。
- `rejectGuildJoin()`：拒絕 guild 加入申請，後端刪除 request 並寫 audit。
- `leaveGuild()`：離開 guild，並處理後端已離開但前端 snapshot 未同步的情境。
- `disbandGuild()`：owner 解散 guild。
- `kickGuildMember()`：owner/admin 踢出 guild 成員。
- `acceptFriend()`：接受 inbound friend request。
- `rejectFriend()`：拒絕 friend request，目前實作等同刪除 friend edge。
- `removeFriend()`：刪除好友或移除待處理邀請。
- `fetchGuildDetail()`：取得 guild detail 完整讀模型，包含 members、requests、audit、contributions、metrics。
- `updateGuildSettings()`：更新 guild announcement 與 join policy。
- `fetchCommunityDetail()`：取得 group/guild 共用 detail；若是 guild 會轉接 `fetchGuildDetail()`。
- `submitPortfolioScore()`：送出 portfolio score RPC，讓 Go runtime 驗證並寫入 leaderboard。
- `loadLiveDashboard()`：組裝首頁 snapshot 的中心函式。
- `safeListLeaderboardRecords()`：安全讀取排行榜，失敗時回空榜避免整個 dashboard 掛掉。
- `loadLiveGuildRequests()`：載入指定 guild 的待審核申請摘要。
- `listLiveUserGroups()`：包裝 Nakama `listUserGroups()`，集中處理 SDK 呼叫細節。
- `mergeDiscoverableCommunities()`：合併已加入 communities 與可 discover groups。
- `mapLiveFriend()`：將 Nakama friend object 轉成 `FriendView`。
- `mapLiveCommunity()`：將 Nakama group/user_group 轉成 `CommunityView`。
- `mapLeaderboardRecords()`：將 Nakama leaderboard records 轉成 `LeaderboardEntry[]`。
- `mergeSubmittedLeaderboardRecords()`：把剛提交的 leaderboard record 合併回 snapshot。
- `mergeLeaderboardEntry()`：合併單筆 leaderboard entry 並重新排序與重算 rank。
- `mapFriendState()`：將 Nakama friend state number 轉成前端 enum。
- `mapGroupRole()`：將 Nakama group user state number 轉成 owner/admin/member/requested/visitor。
- `isGuildAlreadyLeftError()`：判斷 leave guild 錯誤是否代表後端已經退出成功。
- `hasActiveGuildMembership()`：檢查 snapshot 是否仍有有效 guild membership。

### 3.4 Realtime Chat Service

- `buildChatTargets()`：從 dashboard snapshot 產生可聊天 target，只包含 accepted friends 與已加入 communities。
- `openChatSession()`：開啟指定 target 的聊天室，join channel 並載入最近訊息。
- `loadOlderChatMessages()`：依 cursor 載入更早的聊天紀錄。
- `sendChatMessage()`：送出聊天訊息，必要時先確保 channel 已 join。
- `sendTypingSignal()`：送出 typing signal，該訊號不會顯示成正式聊天訊息。
- `subscribeToChatChannel()`：為指定 channel 註冊新訊息 listener，並回傳取消 listener 的 function。
- `primeRealtimeChat()`：預熱 socket、追蹤好友 presence，並提前 join 可聊天 channels。
- `subscribeToUnreadCounts()`：註冊未讀訊息數 listener，未讀數變更時會呼叫 listener。
- `subscribeToRealtimeMeta()`：註冊 presence / typing metadata listener，狀態變更時會呼叫 listener。
- `markChatTargetRead()`：將指定 chat target 的未讀數歸零。
- `resetRealtimeState()`：登出或切換帳號時清空 socket、channel cache、未讀數與 typing timers。
- `ensureLiveSocket()`：建立或重用 Nakama realtime socket，並集中註冊 socket event handler。
- `ensureLiveChatChannelId()`：依 ChatTarget join 正確 channel，並快取 target 與 channel id 對應。
- `normalizeChannelMessages()`：批次轉換 channel messages，並排除 typing signal。
- `normalizeChannelMessage()`：單筆 Nakama ChannelMessage 轉成 UI 使用的 ChatMessageView。
- `extractChatBody()`：從 Nakama message content 中取出文字 body。
- `isTypingSignalMessage()`：判斷訊息是否為 typing signal。
- `registerTypingSignal()`：記錄 typing 狀態並設定自動過期 timer。
- `getChatTargetKey()`：產生 chat target 的穩定 key。
- `resolveChatJoinTarget()`：把 friend/group/guild target 轉成 Nakama joinChat 需要的 target/type。
- `getUnreadCountsSnapshot()`：把未讀數 Map 轉成 React UI 可使用的 plain object。
- `emitUnreadCounts()`：通知所有未讀數 listener。
- `buildRealtimeMetaSnapshot()`：建立 online/presence/typing metadata 快照。
- `emitRealtimeMeta()`：通知所有 realtime metadata listener。
- `describeSocketError()`：將 socket error 轉成可顯示文字。

### 3.5 Go Runtime 函式

- `InitModule()`：Nakama Go plugin 入口，註冊所有 RPC 並初始化 leaderboard。
- `registerLeaderboards()`：確保 global、weekly、guild average leaderboard 存在。
- `rpcGetPhaseConfigHandler()`：回傳前端需要的 RPC id、leaderboard id 與規則設定。
- `rpcSubmitPortfolioScoreHandler()`：驗證並寫入 portfolio score，同步更新 leaderboard。
- `rpcCreateGuildHandler()`：建立 guild governance storage、owner membership 與 audit log。
- `rpcRequestGuildJoinHandler()`：建立 guild join request。
- `rpcApproveGuildJoinHandler()`：核准加入 guild，更新 group roster 與 guild membership。
- `rpcRejectGuildJoinHandler()`：拒絕加入 guild，刪除 join request 並寫 audit。
- `rpcLeaveGuildHandler()`：處理使用者離開 guild，包括 owner 不能直接離開有成員 guild 的規則。
- `rpcDisbandGuildHandler()`：owner 解散 guild，刪除 group 與 guild membership。
- `rpcKickGuildMemberHandler()`：owner/admin 踢出 guild member。
- `rpcGetGuildDetailHandler()`：回傳 guild detail 所需的 members、requests、audit、contributions、metrics。
- `rpcListGuildJoinRequestsHandler()`：列出指定 guild 的待審核申請。
- `rpcUpdateGuildSettingsHandler()`：更新 guild announcement 與 join policy。
- `rpcSearchUsersHandler()`：提供前端新增好友用的使用者模糊搜尋。
- `rpcCreateMatchLobbyHandler()`：建立 group/guild match lobby record，保存 match id、host、createdAt、expiresAt。
- `rpcListMatchLobbiesHandler()`：列出指定 group/guild 的 open lobbies，並清理過期 lobby。
- `rpcCloseMatchLobbyHandler()`：關閉指定 lobby，host 或 community admin/owner 可以操作。
- `rpcSubmitMatchResultHandler()`：驗證並保存 match result，檢查 lobby、membership、host、participants、ready users、event count、event hash。
- `matchLobbyTTLMinutes`：match lobby 存活時間設定，目前用來產生 `expiresAt` 並在 list/get 時清理過期 lobby。
- `readGuildMembership()` / `writeGuildMembership()` / `deleteGuildMembership()`：管理使用者 guild membership storage。
- `readGuildConfig()` / `writeGuildConfig()`：讀寫 guild config global storage。
- `appendGuildAudit()` / `listGuildAudit()`：寫入與讀取 guild governance audit log。
- `updateGuildAverageLeaderboard()`：依成員分數重新計算 guild average leaderboard。
- `runtimeError()`：建立 Nakama runtime error，統一錯誤 code 與 message。
## 4. 資料模型整理

### 4.1 前端讀模型

`DashboardSnapshot`

```text
runtime
profile
friends
communities
leaderboards
```

用途：

- 首頁唯一主要資料來源
- 登入後 UI 都依賴這份 snapshot
- mutation 後通常整份替換

`CommunityView`

```text
id
name
description
kind: group | guild
memberCount
open
role
canJoin
canRequestJoin
pendingRequests
```

用途：

- 首頁用同一種型別呈現 group 與 guild
- `role` 是前端顯示語意，不是最終權限來源
- 最終權限仍由 Nakama 或 Go runtime 檢查

`GuildDetail`

```text
guild
members
requests
audit
contributions
metrics
```

用途：

- guild detail 頁完整讀模型
- 由 `get_guild_detail` RPC 回傳
- 前端不應自己拼多條資料來源

`RelayedMatchSession`

```text
matchId
authoritative
label
size
self
presences
hostSessionId
```

用途：

- 前端 relayed multiplayer 的 active match 狀態
- `hostSessionId` 由 client deterministic 排序選出，用於 host rotation 顯示與 host-only 操作
- 這是 client-relayed match，不是 authoritative match state

`MatchLobbyView`

```text
communityId
kind
matchId
name
hostUserId
hostName
createdAt
expiresAt
status
```

用途：

- group/guild match lobby 清單顯示
- 由 Go runtime `create_match_lobby` / `list_match_lobbies` RPC 維護
- `expiresAt` 用於 lobby TTL，過期 lobby 會在後端 list/get 時清理

`MatchResultView`

```text
matchId
score
summary
hostUserId
participantUserIds
readyUserIds
eventCount
eventHash
validation
submittedAt
```

用途：

- group/guild match result submit 後端保存格式
- 後端會驗證 lobby、community membership、host、participants、ready users、event count、event hash
- 目前只驗證提交資料的一致性，不代表完整反作弊或 authoritative gameplay simulation

---

### 4.2 Nakama Storage Collections

`guild_membership`

用途：

- 記錄使用者目前屬於哪個 guild
- 實作單一使用者只能加入一個 guild

典型 key：

```text
collection = guild_membership
key = membership
user_id = <user id>
```

`guild_join_requests`

用途：

- 記錄待審核 guild 申請

典型 key：

```text
collection = guild_join_requests
key = <guildId>:<userId>
user_id = ""
```

`guild_config`

用途：

- 記錄 guild announcement、join policy、updatedBy 等設定

典型 key：

```text
collection = guild_config
key = <guildId>:config
user_id = ""
```

注意：

- 這是 global object
- 不可把 guild id 放進 `user_id`
- `storage.user_id` 有 users FK

`guild_audit_log`

用途：

- 記錄 guild governance events

典型事件：

- `guild_created`
- `join_requested`
- `join_approved`
- `join_rejected`
- `member_left`
- `member_kicked`
- `settings_updated`

`portfolio_scores`

用途：

- 記錄使用者最新 portfolio score
- guild contribution 與 cooldown 會讀這份資料

典型 key：

```text
collection = portfolio_scores
key = latest
user_id = <user id>
```

`match_lobbies`

用途：

- 保存 group/guild relayed match lobby
- 補足 Nakama relayed match 本身沒有「依 group/guild 查 lobby」的產品層列表能力
- 過期 lobby 會由 `listMatchLobbiesForCommunity()` / `getMatchLobbyOrThrow()` 清理或拒絕

典型 key：

```text
collection = match_lobbies
key = <communityId>:<matchId>
user_id = ""
```

`match_results`

用途：

- 保存 group/guild relayed match result submit 紀錄
- result 由 `submit_match_result` RPC 寫入，包含 score、participants、ready users、event hash

典型 key：

```text
collection = match_results
key = <communityId>:<matchId>:<userId>:<timestamp>
user_id = ""
```

---

### 4.3 Leaderboards

`portfolio_return_global`

用途：

- 全站個人榜

`portfolio_return_weekly`

用途：

- 每週個人榜

`guild_average_return_weekly`

用途：

- 公會平均分數榜
- owner id 是 guild id
- 分數由 server 聚合，不由 client 直接提交

---

## 5. 常用 Debug 指令

### 5.1 啟動後端

```powershell
cd C:\Users\kdsam\Documents\nakamafrontend\nakama
docker compose up --build
```

### 5.2 檢查服務狀態

```powershell
cd C:\Users\kdsam\Documents\nakamafrontend\nakama
docker compose ps
```

預期：

```text
nakama    Up / healthy
postgres  Up / healthy
```

### 5.3 查看 Nakama log

```powershell
cd C:\Users\kdsam\Documents\nakamafrontend\nakama
docker compose logs nakama --tail=200
```

過濾 RPC：

```powershell
docker compose logs nakama --tail=300 | Select-String -Pattern "submit_portfolio_score|create_guild|leave_guild|error|fatal"
```

過濾 relayed match / lobby RPC：

```powershell
docker compose logs nakama --tail=300 | Select-String -Pattern "create_match_lobby|list_match_lobbies|close_match_lobby|submit_match_result|Match lobby|Match result|error|fatal"
```

即時監看：

```powershell
docker compose logs nakama -f
```

### 5.4 查看 PostgreSQL

```powershell
cd C:\Users\kdsam\Documents\nakamafrontend\nakama
docker compose exec postgres psql -U postgres -d nakama
```

查 storage：

```sql
select collection, key, user_id, value, update_time
from storage
order by update_time desc
limit 30;
```

查 guild membership：

```sql
select collection, key, user_id, value, update_time
from storage
where collection = 'guild_membership'
order by update_time desc;
```

查 guild config：

```sql
select collection, key, user_id, value, update_time
from storage
where collection = 'guild_config'
order by update_time desc;
```

查 join requests：

```sql
select collection, key, user_id, value, update_time
from storage
where collection = 'guild_join_requests'
order by update_time desc;
```

查 portfolio score：

```sql
select collection, key, user_id, value, update_time
from storage
where collection = 'portfolio_scores'
order by update_time desc;
```

查 match lobbies：

```sql
select collection, key, user_id, value, update_time
from storage
where collection = 'match_lobbies'
order by update_time desc;
```

查 match results：

```sql
select collection, key, user_id, value, update_time
from storage
where collection = 'match_results'
order by update_time desc;
```

查 leaderboard：

```sql
select leaderboard_id, owner_id, username, score, subscore, update_time
from leaderboard_record
order by update_time desc
limit 30;
```

### 5.5 前端檢查

```powershell
cd C:\Users\kdsam\Documents\nakamafrontend
cmd /c npm run dev
```

型別檢查：

```powershell
cmd /c npx tsc --noEmit
```

Lint：

```powershell
cmd /c npm run lint
```

Smoke test：

```powershell
cmd /c npm run test:integration:smoke
```

### 5.6 Docker build 重新整理

如果 Go runtime 有變更，建議重建：

```powershell
cd C:\Users\kdsam\Documents\nakamafrontend\nakama
docker compose down
docker compose up --build
```

如果懷疑 cache：

```powershell
docker compose build --no-cache
docker compose up
```





