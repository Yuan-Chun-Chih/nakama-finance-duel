# Nakama Relayed Multiplayer Code Review Guide

本文件專門導讀本專案的 Nakama relayed multiplayer 實作。重點是協助快速對照「官方 relayed match 概念」與本專案程式碼位置，並整理 review 時應該確認的行為。

---

## 1. 閱讀順序

建議照這個順序閱讀：

1. [components/realtime-match-panel.tsx](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:67)：先看 UI 如何建立、加入、離開 match，以及如何送出 ready/state/timer/result。
2. [lib/nakama/match.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:25)：再看前端如何包裝 Nakama socket match API。
3. [lib/nakama/types.ts](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:237)：確認 relayed match 相關資料型別。
4. [nakama/runtime.go](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1282)：最後看 Go runtime 的 match lobby / result RPC。
5. [scripts/relayed-match-smoke.mjs](c:/Users/kdsam/Documents/nakamafrontend/scripts/relayed-match-smoke.mjs:1)：用 smoke test 了解最小驗證流程。

---

## 2. 精準行號索引

本章直接標註目前程式碼的實際起始行號。後續若檔案有新增 / 刪除程式碼，行號可能位移，請以 `rg -n "函式名稱"` 重新確認。

### 2.1 UI：`components/realtime-match-panel.tsx`

| 程式碼 | 位置 | 用途 |
| --- | --- | --- |
| `RealtimeMatchPanel()` | [第 68 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:68) | relayed multiplayer 主 UI |
| `session` state | [第 86 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:86) | 目前加入的 match session |
| `presences` state | [第 87 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:87) | match 內玩家 presence 清單 |
| `events` state | [第 88 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:88) | match event log |
| `readyBySessionId` state | [第 93 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:93) | 每個 session 的 ready 狀態 |
| `stateRecipientSessionId` state | [第 97 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:97) | broadcast / directed send 目標 |
| `timerSeconds` state | [第 99 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:99) | timer sync 輸入值 |
| `matchState` state | [第 101 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:101) | reducer 後的本地 match state |
| `subscribeToRelayedMatchData` effect | [第 143 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:143) | 註冊 match data listener |
| `isStaleRelayedMatchEvent()` 使用點 | [第 144 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:144) | 避免舊 sequence 覆蓋新狀態 |
| ready op code 處理 | [第 150 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:150) | 收到 ready state 後更新 ready map |
| ping 自動回 pong | [第 162 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:162) | 收到 ping 後 directed send pong |
| initial state snapshot 處理 | [第 168 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:168) | 收到 host snapshot 後同步狀態 |
| initial state request 處理 | [第 174 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:174) | host 收到請求後回傳 snapshot |
| `subscribeToRelayedMatchPresence` effect | [第 193 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:193) | 註冊 presence listener |
| host migration snapshot | [第 199 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:199) | 新 host 廣播 state snapshot |
| `setSessionState()` | [第 296 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:296) | 切換 match session 並重置 UI |
| `resetSessionState()` | [第 308 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:308) | 清空 match UI 狀態 |
| `rememberMatch()` | [第 320 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:320) | 保存 match resume |
| `handleCreateMatch()` | [第 330 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:330) | 建立 match / community lobby |
| `handleJoinMatch()` | [第 346 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:346) | 用 match id 加入 |
| `handleLeaveMatch()` | [第 355 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:355) | 離開 match 並清理本地狀態 |
| `handleReadyToggle()` | [第 364 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:364) | ready flow |
| `handleStartRound()` | [第 381 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:381) | host 開始回合 |
| `handleRequestInitialState()` | [第 395 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:395) | 向 host 要 state snapshot |
| `handleTimerSync()` | [第 404 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:404) | host 同步 timer 秒數 |
| `handlePing()` | [第 424 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:424) | ping/pong latency 測試 |
| `handleEmote()` | [第 434 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:434) | emote quick signal |
| `handleSendTestAction()` | [第 448 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:448) | 送出測試交易 state |
| `handleMatchmakerToggle()` | [第 473 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:473) | 加入 / 取消 matchmaker |
| `handleJoinLobby()` | [第 501 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:501) | 加入 community lobby |
| `handleCloseLobby()` | [第 510 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:510) | 關閉 community lobby |
| `handleSubmitResult()` | [第 523 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:523) | 提交 match result |
| `appendLocalMatchEvent()` | [第 561 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:561) | sender 本地 optimistic event |
| `isStaleRelayedMatchEvent()` | [第 924 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:924) | 判斷舊事件 |
| `reduceClientMatchState()` | [第 933 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:933) | 根據 op code 更新本地狀態 |
| `buildPresenceEvent()` | [第 1003 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1003) | presence join/leave 轉 UI event |
| `buildSyntheticMatchEventId()` | [第 1048 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1048) | 產生不重複 synthetic event id |
| `buildLocalMatchEvent()` | [第 1054 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1054) | 本地 action 轉 UI event |
| `buildEventHash()` | [第 1082 行](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1082) | 產生 result event hash |

### 2.2 Service：`lib/nakama/match.ts`

| 程式碼 | 位置 | 用途 |
| --- | --- | --- |
| `RELAYED_MATCH_OP_CODES` | [第 25 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:25) | relayed match op code 定義 |
| `createRelayedMatch()` | [第 78 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:78) | 建立 client-relayed match |
| `createCommunityMatchLobby()` | [第 85 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:85) | 建立 match 並寫入 community lobby |
| `listCommunityMatchLobbies()` | [第 104 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:104) | 讀取 community lobbies |
| `closeCommunityMatchLobby()` | [第 115 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:115) | 關閉 community lobby |
| `submitRelayedMatchResult()` | [第 125 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:125) | 呼叫 `submit_match_result` RPC |
| `joinRelayedMatch()` | [第 155 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:155) | 用 match id / token 加入 |
| `leaveRelayedMatch()` | [第 168 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:168) | 離開 match 並清本地狀態 |
| `sendRelayedMatchState()` | [第 183 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:183) | broadcast match data |
| `sendRelayedMatchStateToPresenceIds()` | [第 199 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:199) | directed send match data |
| `sendRelayedReadyState()` | [第 221 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:221) | 送出 ready state |
| `sendRelayedInitialStateRequest()` | [第 230 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:230) | 要求 state snapshot |
| `sendRelayedEmote()` | [第 244 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:244) | 送出 emote |
| `sendRelayedTimerSync()` | [第 253 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:253) | 送出 timer sync |
| `sendRelayedPing()` | [第 262 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:262) | 送出 ping |
| `sendRelayedPong()` | [第 273 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:273) | directed send pong |
| `addRelayedMatchmaker()` | [第 288 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:288) | 加入 Nakama matchmaker |
| `removeRelayedMatchmaker()` | [第 300 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:300) | 移除 matchmaker ticket |
| `subscribeToRelayedMatchData()` | [第 311 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:311) | 註冊 match data listener |
| `subscribeToRelayedMatchPresence()` | [第 328 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:328) | 註冊 presence listener |
| `subscribeToRelayedMatchmaker()` | [第 345 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:345) | 註冊 matched listener |
| `persistRelayedMatchResume()` | [第 353 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:353) | 保存 active match resume |
| `restoreRelayedMatchResume()` | [第 358 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:358) | 還原 active match resume |
| `clearRelayedMatchResume()` | [第 373 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:373) | 清除 resume |
| `clearRelayedMatchLocalState()` | [第 378 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:378) | 清除指定 match 的本地 cache/listeners |
| `ensureRelayedMatchSocket()` | [第 396 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:396) | 建立 / 重用 match socket |
| `cacheAndNormalizeMatch()` | [第 427 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:427) | Nakama Match 轉 UI session |
| `normalizeMatchPresenceEvent()` | [第 449 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:449) | presence event 轉 UI view |
| `normalizeMatchData()` | [第 465 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:465) | match data 轉 UI event |
| `encodeRelayedMatchPayload()` | [第 537 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:537) | 補 sequence / createdAt / payload size 檢查 |
| `nextMatchSequence()` | [第 555 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:555) | 產生本地 sequence |
| `guardRelayedMatchSend()` | [第 562 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:562) | 限制送出頻率 |

### 2.3 Types：`lib/nakama/types.ts`

| 程式碼 | 位置 | 用途 |
| --- | --- | --- |
| `RelayedMatchPresenceView` | [第 237 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:237) | presence view model |
| `RelayedMatchSession` | [第 247 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:247) | 已加入 match 的 session 狀態 |
| `RelayedMatchPayload` | [第 258 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:258) | match data payload |
| `RelayedMatchEvent` | [第 271 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:271) | UI event log item |
| `MatchLobbyView` | [第 293 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:293) | community lobby view model |
| `MatchResultView` | [第 306 行](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:306) | match result view model |

### 2.4 Go Runtime：`nakama/runtime.go`

| 程式碼 | 位置 | 用途 |
| --- | --- | --- |
| `collectionMatchLobbies` | [第 59 行](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:59) | match lobby storage collection |
| `collectionMatchResults` | [第 60 行](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:60) | match result storage collection |
| `matchLobbyTTLMinutes` | [第 67 行](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:67) | lobby TTL 設定 |
| match RPC 註冊 | [第 275 行](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:275) | 註冊 match lobby/result RPC |
| `rpcCreateMatchLobbyHandler()` | [第 1282 行](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1282) | 建立 match lobby |
| `rpcListMatchLobbiesHandler()` | [第 1331 行](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1331) | 列出 match lobbies |
| `rpcCloseMatchLobbyHandler()` | [第 1357 行](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1357) | 關閉 match lobby |
| `rpcSubmitMatchResultHandler()` | [第 1405 行](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1405) | 驗證並保存 match result |
| `buildMatchResultKey()` | [第 1810 行](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1810) | 產生較短 result storage key |

---

## 3. 功能總覽

目前 relayed multiplayer 分成兩層：

- Nakama relayed match：由 client 透過 socket 建立 / 加入 match，Nakama 只負責轉送 match data。
- Go runtime lobby / result：因為 relayed match 本身沒有 group/guild lobby list，也不保存產品層結果，所以用 Go RPC 補 `match_lobbies` 與 `match_results`。

目前已支援：

- 建立一般 relayed match。
- 透過 match id 加入 relayed match。
- 在 group/guild detail 建立 community lobby。
- 列出 / 加入 / 關閉 community lobby。
- 加入 Nakama matchmaker。
- Ready flow。
- Host-side start round。
- Host-side timer sync。
- Broadcast match state。
- Directed match state。
- Sync state snapshot。
- Host migration 後 state snapshot broadcast。
- Ping / pong latency check。
- Emote quick signal。
- Match result submit RPC。

目前還不是 authoritative game server：

- Nakama 不會幫你驗證每一步交易是否合法。
- `limit-order: buy 10 shares` 目前只是測試 match state。
- 正式勝負仍需後續由 Go runtime 根據 order / portfolio 重算。

---

## 4. UI：`components/realtime-match-panel.tsx`

### 3.1 主元件與主要 state

- [RealtimeMatchPanel()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:67)：relayed multiplayer 主 UI，依 dashboard 或 group/guild detail context 顯示一般 match 或 community lobby。
- [session](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:79)：目前加入的 match session，包含 `matchId`、self presence、presences 與 deterministic host。
- [presences](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:80)：目前 match 內所有玩家 presence。
- [events](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:81)：UI event log，包含 match data、presence join/leave、host rotation、local optimistic event。
- [readyBySessionId](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:84)：每個 session id 的 ready 狀態。
- [stateRecipientSessionId](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:86)：`Send state` 要 broadcast 或 directed send 給指定 presence。
- [timerSeconds](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:91)：`Timer sync` 的輸入值，目前只是同步秒數狀態，尚未做每秒倒數。
- [matchState](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:93)：前端 reducer 後的目前 match state，例如 round、timer、last action、last emote。

### 3.2 Socket listener 與 presence

- [subscribeToRelayedMatchData effect](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:126)：註冊目前 match 的 match data listener，收到事件後寫入 event log 並 reduce 本地狀態。
- [isStaleRelayedMatchEvent() 使用點](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:127)：用 sequence 避免較舊事件覆蓋新狀態。
- [ready state 處理](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:133)：收到 ready op code 後更新 `readyBySessionId`。
- [ping 自動回 pong](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:142)：收到其他玩家 ping 後，directed send pong 回來源 session。
- [initial state snapshot 處理](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:151)：收到 host 的 state snapshot 後同步 ready map。
- [initial state request 處理](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:157)：如果目前 client 是 host，收到 request 後會 directed send snapshot 給請求者。
- [subscribeToRelayedMatchPresence effect](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:173)：監聽 join/leave presence event，更新 presences 與 deterministic host。
- [host migration snapshot](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:177)：新 host 偵測自己成為 host 後，會 broadcast 一份 state snapshot。
- [buildPresenceEvent()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:956)：把 join/leave presence 轉成 UI event log。

### 3.3 Match 建立 / 加入 / 離開

- [handleCreateMatch()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:304)：建立一般 relayed match；若有 `communityContext`，會建立 community lobby。
- [handleJoinMatch()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:319)：使用手動輸入的 match id 加入 relayed match。
- [handleLeaveMatch()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:327)：離開 match，清除 resume cache 與本地 session state。
- [setSessionState()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:284)：切換到新 match session 時重置 events、ready、matchState、recipient。
- [resetSessionState()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:295)：離開或 resume 失敗時清空 match UI 狀態。
- [rememberMatch()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:311)：將目前 match id 與 community context 寫入 localStorage，支援 refresh resume。

### 3.4 Ready / Start / State / Timer

- [handleReadyToggle()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:336)：送出 ready state，並立即更新本地 ready map 與 event log。
- [handleStartRound()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:352)：host-only start round，送出 `roundStart` op code。
- [handleRequestInitialState()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:365)：向 host 要目前 match state snapshot。
- [handleTimerSync()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:372)：host-only timer sync，目前同步 `secondsRemaining`，不做倒數。
- [handleSendTestAction()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:414)：送出測試交易 state，例如 `limit-order: buy 10 shares`。
- [appendLocalMatchEvent()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:521)：sender 送出成功後建立本地 optimistic event，避免只有其他人看到、自己不更新。
- [reduceClientMatchState()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:890)：根據 op code 更新本地 match state。
- [buildLocalMatchEvent()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1004)：把本地送出的 action 包成 UI event，讓 sender 自己也能即時看到。

### 3.5 Ping / Pong / Emote

- [handlePing()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:392)：送出 ping，收到 pong 後用 `Date.now() - sentAt` 算 latency。
- [handleEmote()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:400)：送出 emote quick signal。
- [lastLatencyMs 顯示](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:654)：顯示目前測得的粗略 RTT。

### 3.6 Matchmaker

- [handleMatchmakerToggle()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:437)：加入或取消 Nakama matchmaker。
- [matchmaker query/properties UI](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:581)：輸入 query、mode、rating。
- [matchmaker matched listener](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:244)：收到 matched event 後用 token 加入 match。

### 3.7 Community lobby

- [handleJoinLobby()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:464)：從 group/guild lobby 清單加入 match。
- [handleCloseLobby()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:472)：關閉 lobby；如果目前就在該 match，也會 leave 並清掉本地狀態。
- [lobby UI](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:619)：顯示 community match lobbies。

### 3.8 Result submit

- [handleSubmitResult()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:485)：送出 match result 到 Go runtime。
- [buildEventHash()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1030)：根據 event log 產生簡易 hash，作為 result payload 的完整性摘要。
- [Submit result UI](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:773)：輸入 score 與 summary。

Review 時要注意：

- 目前 score 是手動輸入，不是後端根據交易自動計算。
- event hash 只是輕量摘要，不是安全簽章。
- 正式對戰應由 Go runtime 根據 order / portfolio 重算結果。

---

## 5. Service：`lib/nakama/match.ts`

### 4.1 Op code 定義

- [RELAYED_MATCH_OP_CODES](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:24)：集中定義 relayed match data op code。

目前 op code：

- `90 initialStateRequest`：請求目前 match state snapshot。
- `91 initialStateSnapshot`：host 回傳 state snapshot。
- `100 readyState`：玩家 ready 狀態。
- `110 roundStart`：回合開始。
- `120 tradeAction`：測試交易動作。
- `130 emote`：表情訊號。
- `140 timerSync`：timer 秒數同步。
- `150 ping`：延遲測試 ping。
- `151 pong`：延遲測試 pong。
- `160 hostTransfer`：host rotation UI event。
- `190 matchEnd`：對戰結果送出後的結束事件。

### 4.2 建立 / 加入 / 離開 match

- [createRelayedMatch()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:68)：呼叫 Nakama socket `createMatch()` 建立 client-relayed match。
- [joinRelayedMatch()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:140)：使用 match id 或 match token 加入 match。
- [leaveRelayedMatch()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:152)：呼叫 socket `leaveMatch()`，並在 finally 清除本地 match cache。
- [cacheAndNormalizeMatch()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:393)：將 Nakama Match 轉成 UI 使用的 `RelayedMatchSession`。

### 4.3 Community lobby RPC

- [createCommunityMatchLobby()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:74)：先建立 relayed match，再呼叫 `create_match_lobby` RPC 寫入 lobby record。
- [listCommunityMatchLobbies()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:92)：呼叫 `list_match_lobbies` RPC 取得 community lobbies。
- [closeCommunityMatchLobby()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:102)：呼叫 `close_match_lobby` RPC。

### 4.4 Match result RPC

- [submitRelayedMatchResult()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:111)：呼叫 `submit_match_result` RPC，payload 包含 score、summary、host、participants、ready users、event count、event hash。

Review 時要注意：

- 目前 client 會提交 score，因此只能算 prototype。
- 正式版本應由 server 根據 orders / portfolio 自行計算 score。

### 4.5 Match data send

- [sendRelayedMatchState()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:166)：broadcast match data 給 match 內玩家。
- [sendRelayedMatchStateToPresenceIds()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:181)：directed send 給指定 session id。
- [sendRelayedReadyState()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:202)：送出 ready state。
- [sendRelayedInitialStateRequest()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:210)：請求 state snapshot。
- [sendRelayedEmote()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:223)：送出 emote。
- [sendRelayedTimerSync()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:231)：送出 timer sync。
- [sendRelayedPing()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:239)：送出 ping，回傳 nonce/sentAt。
- [sendRelayedPong()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:249)：directed send pong。
- [encodeRelayedMatchPayload()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:498)：補 sequence / createdAt，並限制 payload size。
- [nextMatchSequence()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:515)：每個 match 維護本地 sequence。
- [guardRelayedMatchSend()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:521)：限制同一 match/op code 的最短送出間隔，避免過度 spam socket。

### 4.6 Socket 與 listener

- [ensureRelayedMatchSocket()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:363)：建立或重用 Nakama realtime socket，掛上 `onmatchdata`、`onmatchpresence`、`onmatchmakermatched`。
- [subscribeToRelayedMatchData()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:284)：註冊指定 match id 的 match data listener。
- [subscribeToRelayedMatchPresence()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:300)：註冊指定 match id 的 presence listener。
- [subscribeToRelayedMatchmaker()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:316)：註冊 matchmaker matched listener。
- [normalizeMatchData()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:429)：把 Nakama `MatchData` 轉成 `RelayedMatchEvent`。
- [normalizeMatchPresenceEvent()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:414)：更新 presence cache 並回傳 UI view model。

### 4.7 Resume 與本地清理

- [persistRelayedMatchResume()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:323)：將 active match id 與 community context 存入 localStorage。
- [restoreRelayedMatchResume()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:327)：從 localStorage 還原 match resume。
- [clearRelayedMatchResume()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:342)：清除 resume。
- [clearRelayedMatchLocalState()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:346)：清除該 match 的 presence cache、listeners、sequence counters、send throttle。

Review 時要注意：

- 如果 refresh 後遇到 `Match not found`，UI 應清除 resume，不應讓 404 持續顯示。
- leave match 後必須清本地 listeners，避免 stale event 影響下一場。

---

## 6. 型別：`lib/nakama/types.ts`

- [RelayedMatchPresenceView](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:236)：單一 presence view model，包含 user id、session id、username、是否為自己。
- [RelayedMatchSession](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:244)：已加入 match 的 session 狀態。
- [RelayedMatchPayload](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:254)：match data payload 基礎型別。
- [RelayedMatchEvent](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:266)：UI event log 的單筆 match data。
- [MatchLobbyView](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:286)：community lobby view model。
- [MatchResultView](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/types.ts:298)：match result view model。

---

## 7. Go Runtime：`nakama/runtime.go`

### 6.1 常數與 RPC 註冊

- [match_lobbies / match_results collection](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:59)：match lobby 與 result storage collection。
- [matchLobbyTTLMinutes](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:67)：lobby TTL，目前用於產生 `expiresAt`。
- [match RPC 註冊](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:275)：註冊 `create_match_lobby`、`list_match_lobbies`、`close_match_lobby`、`submit_match_result`。

### 6.2 Lobby RPC

- [rpcCreateMatchLobbyHandler()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1282)：建立 group/guild match lobby，保存 community、match id、host、expiresAt。
- [rpcListMatchLobbiesHandler()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1329)：列出指定 community 的 open lobbies，並清理過期 lobby。
- [rpcCloseMatchLobbyHandler()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1354)：關閉 lobby，通常由 host 或 community 管理者操作。

### 6.3 Result RPC

- [rpcSubmitMatchResultHandler()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1400)：驗證並保存 match result。
- [buildMatchResultKey()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1792)：產生較短的 storage key，避免 key 過長造成 `submit_match_result` HTTP 500。

目前 runtime 驗證重點：

- 使用者必須登入。
- community / kind / match id 必須有效。
- lobby 必須存在且狀態有效。
- host / participants / ready users / event count / event hash 需存在。
- 寫入 `match_results` storage。

尚未完成：

- 未根據實際交易紀錄重算勝負。
- 未驗證每個 match event 的真實性。
- 未防止 client 偽造 score。

---

## 8. Smoke Test

- [scripts/relayed-match-smoke.mjs](c:/Users/kdsam/Documents/nakamafrontend/scripts/relayed-match-smoke.mjs:1)：建立測試帳號、建立 group/lobby、加入 relayed match、送出 result。

執行：

```powershell
cmd /c npm run test:relayed-match
```

測試前提：

- Nakama Docker 已啟動。
- `.env.local` 指向本機 Nakama。
- Go runtime 已 build 並註冊 match RPC。

---

## 9. 常見錯誤與 Debug

### 8.1 `HTTP 404` / `Match not found`

含義：

- 前端拿舊 match id 嘗試 join，但該 relayed match 已不存在。

應檢查：

- [restoreRelayedMatchResume()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:327)
- [clearRelayedMatchResume()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:342)
- [clearRelayedMatchLocalState()](c:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:346)

### 8.2 `Timer` 顯示 `not synced`

含義：

- 目前 client 尚未收到 timer sync 或 local optimistic timer event。

應檢查：

- [handleTimerSync()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:372)
- [appendLocalMatchEvent()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:521)
- [reduceClientMatchState()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:890)

### 8.3 其他人看得到，自己看不到

含義：

- sender 送出 match data 後沒有本地套用 optimistic event，且 Nakama 沒有 echo 回自己。

應檢查：

- [appendLocalMatchEvent()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:521)
- [buildLocalMatchEvent()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:1004)

### 8.4 React duplicate key

含義：

- UI event log 裡 synthetic event id 重複。

應檢查：

- [buildPresenceEvent()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:956)
- [buildSyntheticMatchEventId()](c:/Users/kdsam/Documents/nakamafrontend/components/realtime-match-panel.tsx:996)

### 8.5 `submit_match_result` HTTP 500

可能原因：

- storage key 過長。
- payload 欄位缺失。
- runtime RPC 未 build / 未註冊。

應檢查：

- [rpcSubmitMatchResultHandler()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1400)
- [buildMatchResultKey()](c:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1792)
- Nakama log：

```powershell
cd C:\Users\kdsam\Documents\nakamafrontend\nakama
docker compose logs nakama --tail=300 | Select-String -Pattern "submit_match_result|Match result|error|fatal"
```

---

## 10. Review Checklist

- `Create match` 後是否有 `matchId`。
- `Join by match id` 是否能用另一個帳號加入同一場。
- `Leave match` 後 refresh 是否不再自動 join 舊 match。
- `Create lobby` 是否寫入 `match_lobbies`。
- `Join lobby` 是否能加入對應 match id。
- `Close lobby` 是否從 lobby list 移除。
- `Ready` 是否同步到所有玩家。
- `Start` 是否只允許 host 且 all ready 後操作。
- `Timer sync` 是否 host 自己與其他玩家都會更新。
- `Send state` broadcast 是否所有玩家可見。
- `Send state` directed 是否只指定玩家可見，但 sender 自己有 local event。
- `Sync state` 是否能向 host 要 snapshot。
- host 離開後 deterministic host 是否更新。
- 新 host 是否會 broadcast snapshot。
- `Ping / Pong` 是否能更新 latency。
- `Submit result` 是否寫入 `match_results`。
- `submit_match_result` 不應信任正式 score，正式版本應由 server 重算。

---

## 11. 後續建議

1. 實作真正 countdown timer。
   - 目前只同步 `secondsRemaining`。
   - 建議同步 `startedAt + durationSeconds`，各 client 本地計算剩餘秒數。

2. 設計正式交易指令 schema。
   - 例如 `orderId / side / symbol / quantity / limitPrice / createdAt / clientSequence`。

3. Go runtime 重算 match result。
   - 不再直接信任前端 score。
   - 根據 orders / final portfolio / price feed 重新計算 NAV、return、winner。

4. 強化 event 完整性。
   - event idempotency。
   - round id。
   - result anti replay。
   - event hash 改成更嚴格的 server-side validation。

5. 補 e2e。
   - 至少測 create lobby -> second user join -> ready -> timer sync -> send state -> submit result -> leave -> refresh no 404。
