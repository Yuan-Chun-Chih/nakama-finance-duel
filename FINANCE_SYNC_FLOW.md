# Finance 對戰前後端同步流程

本文件單獨整理 Authoritative BTC 交易對戰在頁面初次進入、對戰中，以及頁面刷新後的同步流程。重點不是前端自己保存盤面，而是前端重新加入同一場 match，向 Nakama authoritative runtime 請求最新 snapshot，再用後端廣播的 authoritative state 覆蓋畫面。

---

## 1. 同步原則

- 前端只送玩家意圖，例如 `ready`、`order`、`cancel`、`resign`、`state request`。
- 後端保存 authoritative match state，包含玩家、回合、價格、持倉、NAV、open orders 與結算狀態。
- 前端畫面不是權威來源；真正的真相只在 Go runtime。
- 因此前端刷新後，不是把本地舊畫面復原，而是重新向後端索取最新 snapshot。

---

## 2. 主要程式碼區塊

### 2.1 前端：建立或恢復同一場對局

- [persistRelayedMatchResume()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:531)
  - 保存目前 `matchId`，供刷新後重連使用。
- [restoreRelayedMatchResume()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:536)
  - 讀取本地保存的 `matchId` 與基本 metadata。
- [joinRealtimeMatch](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:795)
  - 中性 realtime API 名稱；實際上是加入 Nakama match socket。
- [FinanceDuelMatchPanel()](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:56)
  - 對戰主畫面元件。
- [refresh resume effect](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:134)
  - 頁面刷新後，讀取 resume metadata 並重新加入同一場 finance match。

### 2.2 前端：訂閱後端即時狀態

- [ensureRelayedMatchSocket()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:574)
  - 建立或重用 Nakama WebSocket。
- [subscribeToRelayedMatchData()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:481)
  - 依 `matchId` 註冊資料 listener。
- [WebSocket snapshot listener](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:144)
  - 接收 `finance_state` 與 `finance_event`，並更新畫面。

### 2.3 前端：主動請求最新 snapshot

- [state request send](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:161)
  - 前端送出 `finance_state_request`。
- [sendRealtimeMatchData](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:797)
  - 將 opcode 與 payload 經由 Nakama socket 送到後端。
- [FINANCE_MATCH_OP_CODES](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:60)
  - `stateRequest = 223`
  - `state = 224`
  - `event = 225`

### 2.4 後端：接收 request 並回傳 authoritative state

- [financeHandleMessage()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1627)
  - authoritative finance match 的訊息入口。
  - 依 opcode 分派 `ready`、`order`、`cancel`、`state request`、`resign`。
- [financeStateRequestOpCode](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:69)
  - 定義 state request 的 opcode `223`。
- [financeBroadcastState()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1880)
  - 使用目前 server state 組出 `finance_state` snapshot，並透過 `dispatcher.BroadcastMessage(...)` 廣播給前端。
- [MatchLoop()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1554)
  - 每秒處理倒數、行情 freshness、回合與結算，必要時再次廣播最新 state。

---

## 3. 頁面刷新時的同步流程

### 步驟 1：前端保留 `matchId`

當使用者已加入一場對局後，前端會把目前 `matchId` 保存到本地 resume metadata。這份資料只用來重新找到同一場房間，不保存 authoritative 盤面。

對應程式：

- [persistRelayedMatchResume()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:531)

### 步驟 2：刷新後重新加入同一場房間

頁面刷新後，`FinanceDuelMatchPanel` 會先讀取 resume metadata。如果找到先前的 `matchId`，就呼叫 `joinRealtimeMatch()` 重新加入同一場 Nakama match。

對應程式：

- [restoreRelayedMatchResume()](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:536)
- [refresh resume effect](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:134)
- [joinRealtimeMatch](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:795)

### 步驟 3：前端送出 `state request`

重新加入後，前端不直接相信本地舊資料，而是立刻送出：

```json
{ "kind": "finance_state_request" }
```

這個 payload 透過 opcode `223` 傳給後端，要求目前 authoritative match 回傳最新 snapshot。

對應程式：

- [state request send](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:161)
- [sendRealtimeMatchData](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:797)

### 步驟 4：後端用自己的 state 組出 snapshot

後端收到 `finance_state_request` 後，並不是吃前端傳來的盤面，而是直接讀目前 authoritative state，例如：

- 玩家名單
- Ready 狀態
- 回合與剩餘秒數
- 最新價格與 `marketStale`
- 各玩家 cash / BTC / NAV / P&L
- open orders
- winner / finishReason

然後由 `financeBroadcastState()` 組成 `finance_state` payload，再透過 `dispatcher.BroadcastMessage(...)` 廣播回去。

對應程式：

- [financeHandleMessage()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1627)
- [financeBroadcastState()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1880)

### 步驟 5：前端收到 snapshot 並覆蓋 UI

前端在 WebSocket listener 中收到 opcode `224` 的 `finance_state` 後，直接用這份 authoritative snapshot 更新本地畫面。

因此刷新後畫面能恢復，是因為：

- 前端重新加入同一場 match
- 後端重新廣播 authoritative state
- 前端用後端 snapshot 覆蓋自己的 React state

對應程式：

- [WebSocket snapshot listener](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:144)

---

## 4. 對戰進行中為什麼也能持續同步

不只刷新時，對戰進行中也是靠同一套機制同步。

當以下事件發生時，後端都可能再次呼叫 `financeBroadcastState()`：

- 玩家 ready / cancel ready
- 倒數開始或倒數變化
- 新回合開始
- 新價格刷新
- 下單被接受、拒絕、成交、取消
- Portfolio 被重算
- 對局結束

因此前端不是自己推演盤面，而是持續接收後端每次狀態變更後的 authoritative snapshot。

對應程式：

- [MatchLoop()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1554)
- [financeHandleMessage()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1627)
- [financeBroadcastState()](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1880)

---

## 5. 為什麼兩位玩家能同步刷新

因為雙方看的都不是彼此前端的本地資料，而是同一個後端 authoritative state。

兩位玩家即使同時刷新，各自流程都是：

1. 用本地 resume metadata 找回同一個 `matchId`
2. 重新加入同一場 Nakama match
3. 送出 `finance_state_request`
4. 收到同一個後端 state machine 當下產生的 snapshot

所以兩位玩家畫面最終一致，不是因為前端彼此同步，而是因為兩邊都重新向同一個 authoritative 後端索取真相。

---

## 6. 一句話總結

Finance 對戰的同步方式不是「前端把 snapshot 傳給後端」，而是「前端重新加入 match 並請求 snapshot，後端再把 authoritative state 廣播回前端」。
