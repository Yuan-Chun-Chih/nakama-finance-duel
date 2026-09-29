# Week 6 開發紀錄：Authoritative 圈圈叉叉

本文件記錄 2026-06-21 至 2026-06-28 的對戰改版：由金融交易面板切換為 Nakama authoritative 圈圈叉叉，並把勝負、逾時、斷線、投降、重連、rematch、戰績與稽核事件交由 Go runtime 驗證及保存。

---

## 1. 本週完成項目

- 對戰改為 3x3 圈圈叉叉，房間由 Nakama authoritative match handler 執行，因此 Console 顯示 `Authoritative=true`。
- 落子只由前端傳送 cell index；棋盤、回合、勝方、平手與逾時結果均由後端判定。
- 每回合 30 秒未落子判負；斷線後 20 秒未重連判負；重連時 server directed send 完整 snapshot。
- 頁面刷新後可直接依 local resume 回到同一場對局，且只會還原同一個 `community + gameType=tic_tac_toe` 的房間。
- `rematch` 增加 30 秒有效期限；若時間到仍未完成雙方同意，server 會關閉房間並通知雙方前端自動退出。
- community lobby 與個人歷史戰績改為每 5 秒自動刷新，不再依賴手動 refresh。
- 完成對局會保存 game replay、finish reason、rating 變動。
- `rating / wins / losses / draws` 改為 `tic_tac_toe_player_stats` 獨立 stats projection，歷史查詢不再掃所有對局重新統計。
- 新增 `Resign`。前端只送投降意圖，後端判定勝方、寫入 `finishReason = resign`、更新戰績。
- 新增 `tic_tac_toe_events` append-only event log。加入、斷線、重連、接受或拒絕的落子、投降、逾時與 rematch 都會依序保存並即時推送。
- 新增 `tic_tac_toe_player_history` 作為玩家歷史索引，history RPC 改用 cursor pagination，不再固定掃描最多 500 筆 completed games。
- stats projection 改為使用 `StorageWrite Version` 做 optimistic CAS retry，降低同一玩家短時間多局寫回時的覆寫風險。
- 新增慢速 integration smoke test，真實等待 `turn_timeout` 與 `disconnect_forfeit`。

---

## 2. 沿用 Week 5 的後端框架

雖然本週遊戲規則已從金融交易改為圈圈叉叉，但有幾層後端基礎設施是直接沿用 Week 5 的交易 / Bitcoin 對戰架構：

- `Nakama runtime RPC 註冊骨架` 沿用同一套 `RegisterRpc` 流程，只是在既有 finance RPC 旁新增圈圈叉叉 RPC。
- `authoritative match module` 的建立方式沿用 Week 5。現在 `finance_authoritative_match` 與 `tictactoe_authoritative_match` 兩套 handler 並存。
- `community lobby` 系統沿用 `create_match_lobby / list_match_lobbies / close_match_lobby`。圈圈叉叉只是改用 `gameType = tic_tac_toe`。
- 前端仍沿用 `joinRelayedMatch()`、`sendRelayedMatchState()`、`subscribeToRelayedMatchData()` 這套 socket / match service；只是 payload 和 op code 改成圈圈叉叉專用。
- 後端仍沿用 Nakama storage collections + `StorageWrite` / `StorageList` 的資料保存模式。差別在於資料模型從 order / candle / portfolio 改成 board / move / event / player stats。
- `financeAuthoritativeModule` 仍保留在 `runtime.go`，代表之後若要切回金融遊戲，不需要重建整個 authoritative 架構。

這代表 Week 6 的遊戲切換，不是推倒重做，而是在既有多人對戰基礎上替換遊戲規則層。

---

## 3. 遊戲規則與結束原因

| 規則 | 後端行為 | `finishReason` |
| --- | --- | --- |
| 三子連線 | 落子後檢查八條勝利線 | `three_in_a_row` |
| 棋盤滿且無勝方 | 判定平手 | `draw` |
| 當前玩家 30 秒未落子 | 對手勝 | `turn_timeout` |
| 玩家斷線超過 20 秒 | 對手勝 | `disconnect_forfeit` |
| 玩家按下 `Resign` | 對手勝 | `resign` |
| 對局結束後 30 秒內未完成 rematch | 關閉房間並要求雙方退出 | `rematch_timeout` 事件，completed game 本身沿用原本結束原因 |

`finishReason` 會保存於 completed game record，並出現在 UI 的歷史戰績。事件 log 則另外保存完整過程，兩者用途不同：game record 是每局最終結果，event log 是稽核與回放軌跡。

---

## 4. 對戰畫面欄位

- `authoritative`：目前已加入由 Nakama server 執行的房間。
- `Match ID`：可讓另一位玩家加入同一場對局的 ID。
- `Move N`：本局已被 server 接受的落子數。
- `You are X/O`：server 分配的棋子。X 先手，rematch 後雙方交換 X/O。
- `Ns left`：目前回合剩餘秒數，由 server snapshot 提供。
- `rematch closes in Ns`：對局結束後的 rematch 視窗倒數。時間到後房間會被 server 關閉。
- `Resign`：送出投降意圖。不能自行指定勝方。
- `Vote rematch`：一局結束後投票；兩位玩家都同意才開新局。
- `Live audit log`：房內收到的 server event，例如 `move accepted`、`move rejected`、`player disconnected`、`player resigned`、`rematch_expired`。
- `Your match record`：從 `tic_tac_toe_player_stats` 讀取 rating、局數、勝敗和平手；下方對局列表讀 completed game records。
- `Load more`：用 cursor 分頁繼續往後讀歷史，不會和自動刷新的最新資料互相覆蓋。

---

## 5. 主要程式碼位置

### 5.1 前端 UI

- [TicTacToeState](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:43):43：authoritative snapshot 的前端型別，包含盤面、回合、結束原因、倒數、rematch 倒數與 `roomClosed`。
- [TicTacToeEvent](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:61):61：即時稽核事件的前端 view model。
- [TicTacToeMatchPanel()](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:89):89：建房、入房、消費 snapshot、渲染棋盤與歷史戰績的主元件。
- [community lobby auto refresh](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:123):123：每 5 秒自動刷新社群圈圈叉叉 lobby。
- [history auto refresh](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:141):141：每 5 秒自動刷新 `Your match record` 與 stats，並保留 `Load more` 之後的既有資料。
- [resume previous match](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:168):168：頁面刷新時從 local resume 還原上一場圈圈叉叉對局。
- [event listener](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:205):205：接收 server 的 state/event opcode，更新 snapshot、Live audit log，並在 `roomClosed` 時自動退出房間。
- [playCell()](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:331):331：只送出 cell index，合法性不由瀏覽器判定。
- [requestRematch()](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:340):340：送出 rematch vote。
- [resignRound()](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:349):349：送出投降意圖，等待 authoritative runtime 回傳結算 snapshot。
- [rememberMatch()](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:358):358：把目前對局寫入 resume storage，支援 refresh restore。
- [refreshHistory()](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:369):369：主動重新抓一次 history/stats。
- [loadMoreHistory()](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:387):387：使用 cursor 繼續讀更多歷史資料。
- [Live audit log](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:567):567：顯示即時 server event stream。
- [Your match record](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:591):591：顯示自動刷新的 stats 與 completed games 歷史。
- [formatFinishReason()](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:652):652：將後端 finish reason code 轉為 UI 文案。
- [mergeHistoryPage()](/C:/Users/kdsam/Documents/nakamafrontend/components/tic-tac-toe-match-panel.tsx:699):699：合併自動刷新頁與既有分頁資料，避免重複 game id。

### 5.2 前端沿用的 match service

- [RelayedMatchResumeState](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:80):80：resume state 現在包含 `gameType`，可區分不同遊戲。
- [createCommunityMatchLobby()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:115):115：沿用 Week 5 的 community lobby service，圈圈叉叉只是改用新的 `gameType`。
- [joinRelayedMatch()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:271):271：沿用既有的 socket join 流程，authoritative 房間仍由同一個前端 service 加入。
- [sendRelayedMatchState()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:299):299：沿用既有 match data send 管道，圈圈叉叉用它送 move、rematch、resign、state request。
- [subscribeToRelayedMatchData()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:452):452：沿用既有 listener 註冊，前端從這裡消費 authoritative snapshot 與 event。
- [persistRelayedMatchResume()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:502):502：把目前 active match 寫入 local storage。
- [restoreRelayedMatchResume()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:507):507：頁面刷新後還原上次 active match。
- [clearRelayedMatchResume()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:522):522：退出或房間關閉時清掉 resume。
- [clearRelayedMatchLocalState()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:527):527：房間關閉時清除本地 listeners、presence cache、sequence 與 throttle。
- [listTicTacToeHistory()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:748):748：呼叫圈圈叉叉 history RPC，回傳 stats projection 與 cursor 分頁結果。

### 5.3 Nakama authoritative runtime

- [ticTacToeRematchWindowTicks](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:112):112：定義 rematch 有效期限 30 秒。
- [tic_tac_toe storage collections](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:90):90：`tic_tac_toe_games`、`tic_tac_toe_player_stats`、`tic_tac_toe_events`、`tic_tac_toe_player_history` 四種保存責任。
- [RematchDeadlineTick / RoomClosed](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:292):292：在 authoritative state 中保存 rematch 截止時間與房間是否已關閉。
- [RegisterMatch / RegisterRpc](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:606):606：沿用 Week 5 runtime 初始化骨架，在同一處註冊圈圈叉叉與 finance match module，以及相關 RPC。
- [MatchJoin()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:717):717：處理玩家加入或重連，追加 join/reconnect event，並在重連時送 directed snapshot。
- [MatchLeave()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:752):752：記錄斷線 tick 並追加 `player_disconnected` event。
- [MatchLoop()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:776):776：處理 state request、落子、rematch、resign、每秒倒數、rematch 到期關房與 idle close。
- [rematch expiry handling](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:801):801：rematch 視窗到期後寫入 `rematch_expired` event，標記 `roomClosed`，並要求前端退出。
- [ticTacToeResolveAutomaticForfeit()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:930):930：處理 `turn_timeout` 與 `disconnect_forfeit`。
- [ticTacToeCanResign()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:961):961：限制只有進行中的對局玩家可以投降。
- [ticTacToeMoveRejectReason()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:969):969：為非法落子留下可稽核原因，例如非玩家、非自己回合、格子已占用。
- [ticTacToeAppendEvent()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1038):1038：使用 `gameId:sequence` 不可覆寫 key 追加 event，保存成功後推送 opcode `215`。
- [buildTicTacToeStatePayload()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1082):1082：把 `rematchSecondsRemaining` 與 `roomClosed` 包進 authoritative snapshot。
- [persistTicTacToeGame()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1137):1137：同一批 `StorageWrite` 保存 completed game、stats projection 與 player history index。
- [ticTacToeUpdatedPlayerStats()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1165):1165：讀取現有 stats，使用 CAS retry 更新 Elo、wins、losses、draws。
- [readTicTacToePlayerStats()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1243):1243：history RPC 直接讀取 stats projection。
- [rpcCreateTicTacToeMatchHandler()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2375):2375：建立圈圈叉叉 authoritative match。
- [rpcCreateMatchLobbyHandler()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2402):2402：沿用 Week 5 的社群 lobby 機制，圈圈叉叉也從這裡建 lobby。
- [rpcListMatchLobbiesHandler()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2470):2470：列 lobby 時會順便清掉已不存在的 stale match。
- [rpcCloseMatchLobbyHandler()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2507):2507：沿用既有關閉 lobby 流程。
- [rpcListTicTacToeHistoryHandler()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3156):3156：使用玩家歷史索引做 cursor pagination，回傳 `games + stats + cursor`。

### 5.4 驗證腳本

- [OP](/C:/Users/kdsam/Documents/nakamafrontend/scripts/tic-tac-toe-smoke.mjs:34):34：定義 move、state、rematch、resign op code。
- [main()](/C:/Users/kdsam/Documents/nakamafrontend/scripts/tic-tac-toe-smoke.mjs:72):72：完整 smoke test，覆蓋建房、加入、勝局、rematch、投降、history、cursor 分頁與 rematch 到期關房。
- [resignation assertions](/C:/Users/kdsam/Documents/nakamafrontend/scripts/tic-tac-toe-smoke.mjs:144):144：驗證投降結果、`finishReason = resign` 與 stats projection 的累計結果。
- [rematch expiry assertions](/C:/Users/kdsam/Documents/nakamafrontend/scripts/tic-tac-toe-smoke.mjs:225):225：驗證 30 秒 rematch 視窗到期後 `roomClosed` 與 lobby 自動清理。
- [tic-tac-toe-forfeit-smoke.mjs](/C:/Users/kdsam/Documents/nakamafrontend/scripts/tic-tac-toe-forfeit-smoke.mjs:69):69：慢速 integration test，真實等待 `turn_timeout` 與 `disconnect_forfeit`。

---

## 6. PostgreSQL 查詢

先進入資料庫：

```powershell
cd C:\Users\kdsam\Documents\nakamafrontend\nakama
docker compose exec postgres psql -U postgres -d nakama
```

查看最近 completed games：

```sql
select key, value, update_time
from storage
where collection = 'tic_tac_toe_games'
order by update_time desc
limit 20;
```

查看獨立戰績投影：

```sql
select key as user_id, value, update_time
from storage
where collection = 'tic_tac_toe_player_stats'
order by update_time desc
limit 20;
```

查看 append-only 稽核事件：

```sql
select key, value, update_time
from storage
where collection = 'tic_tac_toe_events'
order by update_time desc
limit 100;
```

查看玩家歷史索引 key：

```sql
select user_id, key, update_time
from storage
where collection = 'tic_tac_toe_player_history'
order by user_id, key
limit 100;
```

查看特定 game 的事件序列：

```sql
select key, value
from storage
where collection = 'tic_tac_toe_events'
and key like '<game_id>:%'
order by key;
```

---

## 7. 驗證結果

已執行並通過：

```powershell
cmd /c npx tsc --noEmit
node --check scripts\tic-tac-toe-smoke.mjs
node --check scripts\tic-tac-toe-forfeit-smoke.mjs
docker compose -f nakama\docker-compose.yml build nakama
docker compose -f nakama\docker-compose.yml up -d nakama
cmd /c npm run test:tictactoe
cmd /c npm run test:tictactoe:forfeit
```

`test:tictactoe:forfeit` 會真實等待 turn timeout 與 reconnect grace period，所以執行時間較長是正常的。

---

## 8. 後續建議

1. 為 `tic_tac_toe_events` 補 history RPC 或 admin view，讓事件稽核不必每次直接查 PostgreSQL。
2. 在 UI 顯示更明確的 reconnect 狀態，例如「對手剩餘幾秒未重連就判負」。
3. 若未來要支援觀戰模式，可在同一套 authoritative 架構上加入 spectator role，但落子與 rematch 投票仍只允許正式玩家。
4. 若之後切回金融遊戲，可保留這一週建立的 resume、自動刷新、事件流、projection 與 cursor pagination 思路，直接套回新的遊戲規則層。
