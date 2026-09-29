# Week 8 重點功能說明

本文件說明本週 Finance Arena 的三項核心能力：手機適應式介面、authoritative 匹配，以及管理員專用營運指標。所有交易、配對資格與權限判定皆以 Nakama Go runtime 為準，前端只負責顯示與傳送意圖。

## 1. 手機畫面的適應模式

手機版不是另一套頁面，而是同一個 `FinanceDuelMatchPanel` 透過 Tailwind breakpoint 和 tab 狀態切換呈現。

- [mobileTab state](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:110):110：保存目前手機頁籤，預設為 `market`。
- [MobileArenaTabs](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:1048):1048：在 `md` 以下顯示 Market、Trade、Portfolio、History 四個頁籤。
- [market visibility](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:769):769：手機僅顯示選取的 market 區塊；桌面使用 `md:block` 保留多欄資訊。
- [mobile trade ticket](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:811):811：Trade tab 在手機固定於底部，限制最大高度並可垂直捲動；桌面恢復靜態右側票券。
- [desktop layout](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:766):766：`xl:grid-cols-[minmax(0,1fr)_360px]` 在大螢幕形成行情與交易欄位。
- [compact arena header](/C:/Users/kdsam/Documents/nakamafrontend/components/match-arena-client.tsx:75):75：倒數或對局中縮短 header，只保留 Match Arena、社群資訊和 Back。
- [Trading duel workspace condition](/C:/Users/kdsam/Documents/nakamafrontend/components/match-arena-client.tsx:86):86：等待配對與確認時才顯示標題及說明，實際對局時隱藏以釋放版面。

手機 UI 的責任只在於資訊呈現與操作順序；交易可否送出仍由後端 snapshot 的對局狀態、行情 freshness、現金與持倉決定。

## 2. 現在的匹配功能

匹配流程分成前端意圖、Nakama matchmaker，以及 Go authoritative room 三層。

```text
Match
  -> finance_matchmaking RPC begin
  -> server queue token
  -> Nakama matchmaker (2 players)
  -> Go callback creates authoritative confirmation room
  -> both confirm within 30 seconds
  -> server 3-second countdown
  -> running
```

- [findOpponent](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:546):546：使用者按下 Match 時只送 `begin` 意圖，前端不自行選擇對手。
- [cancelSearch](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:560):560：取消本機 ticket 後通知後端將排隊狀態改為 `cancel`。
- [matchmaker callback](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:258):258：只接受與目前 ticket 相符的 server 配對結果，然後加入 server 給定的 match ID。
- [updateFinanceMatchmaking](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:472):472：前端 RPC wrapper，支援 `begin`、`cancel`、`status`。
- [startFinanceMatchmaking](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/match.ts:479):479：加入 `gameType=finance`、兩人一組的 Nakama matchmaker。
- [financeMatchmakerMatched](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1508):1508：後端驗證兩位不同玩家並建立 authoritative confirmation room。
- [rpcFinanceMatchmakingHandler](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3713):3713：保存 `searching`、`matched`、`running`、`cooldown` 等後端匹配 projection。
- [financeConfirmationTicks](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:145):145：雙方確認期限為 30 秒。
- [financeCountdownTicks](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:144):144：確認完成後由 server 執行 3 秒開局倒數。

頁面刷新後，前端會讀取後端 `status` projection，重新加入既有房間或恢復搜尋；原生 matchmaker ticket 不被視為唯一真相來源。

## 3. 管理員專用 `get_finance_metrics`

`get_finance_metrics` 是營運 RPC，不提供一般玩家的對局畫面使用。它回傳全域 `finance_system_metrics` projection，用來調整配對、行情與訂單規則。

- [RPC registration](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:866):866：將 RPC ID `get_finance_metrics` 註冊到 Go runtime。
- [rpcGetFinanceMetricsHandler](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3854):3854：先取得目前登入者 user ID，再進行管理員權限驗證，成功後才讀取 metrics。
- [financeMetricsAdminAllowed](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3869):3869：比對登入者 UUID 是否位於 allowlist。
- [FINANCE_METRICS_ADMIN_USER_IDS](/C:/Users/kdsam/Documents/nakamafrontend/nakama/docker-compose.yml:53):53：以逗號分隔的管理員 UUID 環境變數。
- [financeUpdateMetrics](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2318):2318：使用 CAS retry 更新全域 projection，降低多場對局同時寫入時遺失計數的風險。

目前 metrics 包含：

- `matchmakingStarts`：開始搜尋對手的次數。
- `matchedPlayers`：成功進入匹配結果的玩家數。
- `totalMatchWaitSeconds`：累積等待配對秒數。
- `completedMatches`：已完成對局數。
- `totalStaleMarketSeconds`：市場行情 stale 的累積秒數。
- `orderRejections`：依原因分組的訂單拒絕次數。

未在 `FINANCE_METRICS_ADMIN_USER_IDS` 的 user ID 呼叫時，後端會回傳 `Finance metrics admin privileges required.`。這個驗證在 Go runtime 執行，不能透過修改前端來繞過。

## 4. 維護注意事項

- `joinRealtimeMatch` 等中性 API 目前仍包裝舊的 `Relayed` 命名實作；遷移完成前避免把名稱誤解為 finance 是 client-authoritative。
- `FINANCE_METRICS_ADMIN_USER_IDS` 不應放入前端環境變數或提交真實 UUID 到版本控制。
- 管理員 metrics 適合接營運頁面或排程監控，不應混入玩家 history RPC。
