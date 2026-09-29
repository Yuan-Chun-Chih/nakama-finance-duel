# Week 8 開發紀錄：Finance Arena UX、冪等與營運指標

本文件記錄 2026-07-05 至 2026-07-11 的 BTC Finance Arena 優化，延續 Week 7 的 authoritative BTC 現貨交易規則。

## 1. 本週完成項目

- 配對成功後顯示 30 秒雙方確認彈窗；兩位玩家確認後才進入獨立 10 秒開局倒數。
- 移除 arena 內舊的 hidden `Match control`、legacy matchmaking 與重複 Live events JSX。
- 交易票券固定使用 Market order，暫時隱藏 Limit order 操作。
- Resign 與 Leave match 移至 `BTC market intelligence` 標題列，並增加二次確認提示。
- 交易前顯示可用現金、可用 BTC、行情年齡、預估名目金額、fee / tax 與停用原因。
- Transaction records 移至左下方；Performance、Finance rating、Live server events 集中於頁面底部。
- 每筆交易意圖新增 `clientOrderId`；相同玩家重送相同 id 時，不會建立重複 order 或 fill。
- `finance_order_idempotency` 保存最近 order result，保留 24 小時；新對局建立與對局結束時批次清理。
- 新增 `finance_system_metrics` 全域 projection，保存配對等待、完成對局、stale 行情秒數與拒單原因。
- metrics 從玩家 `list_finance_history` 回應移除，改由管理員專用 `get_finance_metrics` RPC 讀取。

## 2. 配對與開局流程

| 階段 | Server status | 前端行為 |
| --- | --- | --- |
| 搜尋對手 | `searching` | 顯示等待時間與取消搜尋 |
| 找到對手 | `matched_confirming` | 顯示 30 秒確認彈窗 |
| 雙方確認 | `countdown` | 顯示 3 秒開局倒數 |
| 對局中 | `running` | 開放 Market buy / sell |

確認與倒數均由 Go runtime 判定，前端只送出確認意圖。

## 3. 前端程式位置

- [FinanceDuelMatchPanel](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:69)：arena 主畫面、即時 snapshot、配對、交易與歷史資料整合。
- [tradeDisabledReason](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:148)：依 server 狀態、行情 freshness、現金與持倉顯示送單停用原因。
- [submitOrder](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:554)：送出 Market order 並產生 `clientOrderId`。
- [Mobile trade ticket](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:740)：在手機 Trade tab 固定於底部、限制最大高度並獨立滾動。
- [ActionConfirmModal](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:1109)：顯示 Resign / Leave 的自訂確認彈窗。
- [GameStartCountdown](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:1093)：顯示 server 提供的 3 秒倒數。
- [MarketPanel](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:1178)：顯示 BTC 行情、K 線、指數與對局操作。
- [Transaction records](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:1723)：顯示成交價格、數量、名目金額、fee、tax 與 round。
- [PerformanceSummary](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:1801)：顯示 NAV、realized / unrealized P&L 與最大回撤。
- [LiveServerEvents](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:1842)：顯示 server event stream。

### 3.5 本次背景錯誤修正與目前行號

本次修正避免使用者尚未按下 Match 時，因背景 session、配對狀態或歷史查詢失敗而看到泛用的 `Finance match operation failed.`。以下行號以目前工作樹為準，格式同步補上連結後的行號數字：

- [restoreLiveSession](/C:/Users/kdsam/Documents/nakamafrontend/lib/nakama/client.ts:80):80：頁面載入時還原登入 session；背景 RPC 必須等待此流程完成。
- [authReady / hasLiveAuth](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:90):90：確認 session 還原完成且確實存在登入狀態，避免未登入時提前呼叫後端。
- [background auth restore](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:182):182：先完成本地 session 還原，再啟動 lobby、配對狀態與歷史資料同步。
- [listCommunityMatchLobbies](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:225):225：配對前 lobby 背景刷新；失敗時改為顯示背景提示，不再設定操作錯誤。
- [updateFinanceMatchmaking status](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:266):266：頁面刷新後恢復後端配對 projection；只有登入狀態已就緒時才執行。
- [listFinanceHistory](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:466):466：只有已加入 finance match 後才刷新歷史資料，避免配對前呼叫需要 session 的 RPC。
- [backgroundNotice](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:89):89：區分背景同步提示與使用者主動操作錯誤。
- [describeError](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:2303):2303：解析 Error、字串與 Nakama plain object，優先顯示後端實際錯誤訊息。

### 3.6 前端索引行號校正

以下為目前程式碼的最新位置；本節行號優先於前面歷史紀錄中的舊索引：

- [FinanceDuelMatchPanel](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:70):70：Finance Arena 主元件。
- [tradeDisabledReason](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:155):155：依 server 狀態、行情 freshness、現金與持倉決定交易按鈕是否停用。
- [submitOrder](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:595):595：送出 market order intent 與 `clientOrderId`。
- [GameStartCountdown](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:1132):1132：顯示 authoritative 3 秒開局倒數。
- [ActionConfirmModal](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:1148):1148：顯示 resign / leave 的確認彈窗。
- [MarketPanel](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:1217):1217：顯示 BTC 行情、K 線、指標與 stale 狀態。
- [Transaction records](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:1762):1762：顯示訂單、成交、費用、稅與每回合資料。
- [PerformanceSummary](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:1840):1840：顯示 NAV、realized/unrealized P&L 與績效摘要。
- [LiveServerEvents](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:1881):1881：顯示 server append-only event stream。

### 3.7 最新前端行號校正（2026-07-12）

以下索引優先於前述較早的 Week 8 行號，包含對局時收斂 arena header 的最新修改：

- [FinanceDuelMatchPanel](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:70):70：Finance Arena 主元件，接收並回報對局展示狀態。
- [immersiveDuel](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:118):118：僅在 `countdown` 或 `running` 時標記為實際對局。
- [onDuelPresentationChange](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:209):209：將實際對局狀態通知 arena 父層；元件卸載時回復為非對局展示。
- [MobileArenaTabs](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:1048):1048：手機版 Market、Trade、Portfolio、History 切換列。
- [FinanceMatchmakingPanel](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:988):988：等待時間、Match 與 Cancel search 的配對入口。
- [findOpponent](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:546):546：送出 `begin` 意圖、取得 server queue token 並加入 Nakama matchmaker。
- [cancelSearch](/C:/Users/kdsam/Documents/nakamafrontend/components/finance-duel-match-panel.tsx:560):560：移除本機 matchmaker ticket，並送出 server `cancel` 意圖。
- [duelPresentation](/C:/Users/kdsam/Documents/nakamafrontend/components/match-arena-client.tsx:24):24：父層保存是否已進入實際對局。
- [compact arena header](/C:/Users/kdsam/Documents/nakamafrontend/components/match-arena-client.tsx:75):75：對局中縮短 header 高度，但保留 Match Arena、社群與 Back。
- [Trading duel workspace](/C:/Users/kdsam/Documents/nakamafrontend/components/match-arena-client.tsx:86):86：僅在等待配對與確認階段顯示標題及說明。
- [FinanceDuelMatchPanel callback](/C:/Users/kdsam/Documents/nakamafrontend/components/match-arena-client.tsx:109):109：將 `setDuelPresentation` 傳入對局面板。

## 4. 後端 authoritative 與 storage

- [financeConfirmationTicks](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:145)：配對確認期限 30 秒。
- [financeCountdownTicks](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:144)：開局倒數 3 秒。
- [financeAcceptOrder](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1870)：驗證行情、狀態、client order id、資金與持倉。
- [ClientOrderID](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:396)：保存 client id 與 server order 關聯。
- [readFinanceOrderIdempotency](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2255)：重送前讀取既有結果。
- [financePersistOrderIdempotency](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2274)：保存 status、reason 與 expiresAt。
- [financeCleanupExpiredIdempotency](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2290)：批次清理最多 100 筆過期資料。

主要 collections：`finance_orders`、`finance_fills`、`finance_order_idempotency`、`finance_system_metrics`。

### 4.1 後端索引行號校正

- [financeCountdownTicks](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:144):144：對局開始前 3 秒倒數。
- [financeConfirmationTicks](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:145):145：配對確認期限 30 秒。
- [financeAcceptOrder](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:1870):1870：驗證 market order intent、行情 freshness、現金與現貨持倉。
- [readFinanceOrderIdempotency](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2255):2255：讀取已保存的 client order id 結果，避免重複成交。
- [financePersistOrderIdempotency](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2274):2274：保存最近 order result 與過期時間。
- [financeCleanupExpiredIdempotency](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2290):2290：清理已超過保留期限的冪等記錄。
- [financeUpdateMetrics](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2318):2318：以 CAS retry 更新配對等待、stale 行情與訂單拒絕 projection。
- [rpcGetFinanceMetricsHandler](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3854):3854：管理員專用 metrics RPC。
- [financeMetricsAdminAllowed](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3869):3869：依 allowlist 驗證管理員 user ID。
- [FINANCE_METRICS_ADMIN_USER_IDS](/C:/Users/kdsam/Documents/nakamafrontend/nakama/docker-compose.yml:53):53：設定 metrics RPC 的管理員 UUID allowlist。

## 5. Metrics 與管理權限

`finance_system_metrics` 保存：

- `matchmakingStarts`、`matchedPlayers`、`totalMatchWaitSeconds`。
- `completedMatches`、`totalStaleMarketSeconds`。
- `orderRejections`：依拒單 reason 分類的次數。

- [financeUpdateMetrics](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:2318)：CAS retry 更新全域 projection。
- [rpcGetFinanceMetricsHandler](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3854)：管理員專用 RPC。
- [financeMetricsAdminAllowed](/C:/Users/kdsam/Documents/nakamafrontend/nakama/runtime.go:3869)：依 server allowlist 驗證 user UUID。
- [FINANCE_METRICS_ADMIN_USER_IDS](/C:/Users/kdsam/Documents/nakamafrontend/nakama/docker-compose.yml:53)：逗號分隔的管理員 UUID；未設定時拒絕所有查詢。

RPC id：`get_finance_metrics`

## 6. PostgreSQL 查詢

```powershell
cd C:\Users\kdsam\Documents\nakamafrontend\nakama
docker compose exec postgres psql -U postgres -d nakama
```

查看 metrics：

```sql
select key, value, update_time at time zone 'Asia/Taipei' as updated_at_taipei
from storage
where collection = 'finance_system_metrics'
order by update_time desc;
```

查看 idempotency records：

```sql
select key, value, update_time at time zone 'Asia/Taipei' as updated_at_taipei
from storage
where collection = 'finance_order_idempotency'
order by update_time desc
limit 100;
```

查看已到期但尚未清理的資料：

```sql
select key, value->>'arenaId' as arena_id, value->>'orderId' as order_id,
       value->>'expiresAt' as expires_at
from storage
where collection = 'finance_order_idempotency'
  and (value->>'expiresAt')::timestamptz <= now()
order by update_time;
```

## 7. 驗證

已通過：

```powershell
cmd /c npx tsc --noEmit
cmd /c npm run lint
cd nakama
go test ./...
```

ESLint 目前只剩既有 `components/realtime-match-panel.tsx` Hook dependency warning。完整 Docker smoke test 需要 Docker Desktop Linux engine 啟動後執行：

```powershell
cd nakama
docker compose up -d --build nakama price-feed
cd ..
cmd /c npm run test:finance-duel
```

## 8. 後續建議

1. 將 idempotency cleanup 移到 Nakama cron 或 maintenance worker。
2. 將 metrics 依日期分片，降低 global CAS record 的併發競爭。
3. 建立管理員 metrics dashboard，顯示平均配對等待、拒單率、stale ratio 與行情 worker 可用性。
4. 為 metrics RPC 增加 audit event，記錄誰在何時讀取營運資料。
