# Code Review 常見問題與程式碼位置

本文件整理 Finance Duel 後端 code review 常見問題。每個回答都附上目前實作位置，方便口頭說明後立即開啟程式驗證。

## 架構與 authoritative 邊界

### Q：Nakama 和 Go runtime 分別負責什麼？

A：Nakama 提供帳號、session、HTTP RPC、WebSocket、presence、matchmaker、authoritative match lifecycle、Storage、Group、Chat 與 Leaderboard API。Go runtime 則在 Nakama 提供的 lifecycle 中註冊 RPC、建立 match handler，並實作交易、結算、Guild 與資料保存規則。

程式位置：

- [InitModule](../runtime.go:12)：註冊 leaderboards、match handler、matchmaker callback 與 RPC。
- [RegisterMatch](../runtime.go:24)：將 `finance_authoritative_match` 掛入 Nakama。
- [RegisterMatchmakerMatched](../runtime.go:30)：註冊配對完成 callback。
- [RegisterRpc](../runtime.go:67)：註冊所有 HTTP RPC。

### Q：為什麼不讓前端計算成交、NAV、勝負？

A：前端只送交易意圖；後端在 match state 中重新驗證資金、持倉與行情，再計算成交、費用、稅、P&L、NAV 與結果。這些結果都由 server state 產生並廣播。

程式位置：

- [financeHandleMessage](../runtime_finance_orders.go:15)：解析玩家 WebSocket 意圖。
- [financeAcceptOrder](../runtime_finance_orders.go:106)：驗證並接受或拒絕訂單。
- [financeTryFillOrder](../runtime_finance_orders.go:189)：由 server price 計算成交與費用。
- [financeMarkPortfolios](../runtime_finance_orders.go:292)：重算 P&L、NAV、return。
- [financeFinish](../runtime_finance_match.go:239)：決定結算結果與保存。

### Q：為什麼選 Go runtime？

A：交易規則需要 `int64` cents／BTC micros、HMAC 行情驗證、Storage CAS、outbox retry 與長時間 authoritative state machine。Go runtime 將這些規則保持在同一個強型別 server plugin；前端 TypeScript 只負責畫面與意圖傳送。

程式位置：

- [financeAuthoritativeMatchState](../runtime_finance_models.go:18)：對局唯一 server state。
- [financePortfolio](../runtime_finance_models.go:65)：以整數保存 cash、BTC 與 P&L。
- [calculateBpsCeil](../runtime_finance_math.go:6)：basis points 整數費率計算。
- [validateMarketIngestSignature](../runtime_market.go:119)：HMAC 驗證。

## 配對、確認與同步

### Q：玩家按下 Match 後，後端如何處理？

A：前端呼叫 matchmaking RPC 的 `begin` action；後端建立 `searching` record 和 `QueueToken`，再讓 Nakama Matchmaker 尋找對手。配對完成後 callback 驗證兩人的 queue record，再建立 authoritative arena。

程式位置：

- [rpcFinanceMatchmakingHandler](../runtime_finance_matchmaking.go:186)：處理 `begin`、`cancel`、`status`。
- [financeMatchmakerMatched](../runtime_finance_matchmaking.go:16)：Matchmaker 找到對手後的 server callback。
- [claimFinanceMatchmaking](../runtime_finance_matchmaking.go:67)：比對 queue token 與狀態，避免舊配對誤成立。
- [financeMatchmakingRecord](../runtime_finance_models.go:178)：保存 queue token、status、lease、match ID。

### Q：`QueueToken` 的作用是什麼？

A：它代表「這一次排隊」而不是「這個玩家」。同一玩家取消後重新排隊會得到新 token；callback 比對 token，避免舊的 Matchmaker 結果把玩家帶進新一輪排隊。

程式位置：

- [begin action 建立 QueueToken](../runtime_finance_matchmaking.go:212)
- [claimFinanceMatchmaking 比對 QueueToken](../runtime_finance_matchmaking.go:67)
- [financeMatchmakingRecord.QueueToken](../runtime_finance_models.go:183)

### Q：為什麼配對成功後仍需要雙方確認？

A：`matched` 只代表後端找到了兩位玩家；確認結果由 server 保存，兩位玩家都確認後才進入開局倒數。取消或確認期限到期時，後端決定 record 要回到搜尋、cooldown 或結束。

程式位置：

- [financeSetConfirmationOutcome](../runtime_finance_matchmaking.go:99)：保存確認成功、取消或超時的配對結果。
- [MatchLoop](../runtime_finance_match.go:132)：每 tick 推進確認期限與開局流程。
- [financeConfirmationTicks 常數](../runtime_config.go:80)：確認期限。
- [financeStartCountdownTicks 常數](../runtime_config.go:81)：雙方確認後的開局倒數。

### Q：如何處理卡住的配對狀態？

A：每個 `searching`、`matching`、`matched`、`running` record 都有 lease expiry。讀取 record 時會檢查是否過期，過期後回復為可再次使用的狀態。

程式位置：

- [financeMatchmakingLeaseExpiry](../runtime_finance_matchmaking.go:138)：依 status 決定租約到期時間。
- [financeRecoverExpiredMatchmaking](../runtime_finance_matchmaking.go:150)：回收過期 record。
- [TestFinanceMatchmakingLeaseRecovery](../runtime_finance_test.go:139)：驗證 recovery 規則。

### Q：兩位玩家為什麼能即時同步？

A：每場對局只有一份 `financeAuthoritativeMatchState`。`MatchLoop` 更新它後，`financeBroadcastState` 針對每位玩家組裝 snapshot，再透過 Nakama dispatcher 發送 WebSocket match data。

程式位置：

- [MatchLoop](../runtime_finance_match.go:132)：每秒處理對局。
- [financeBroadcastState](../runtime_finance_match.go:268)：建立並推送 snapshot。
- [financeOpponentLeadStatus](../runtime_finance_match.go:327)：只回傳模糊化的對手領先狀態。

### Q：頁面刷新為什麼還能回到原對局？

A：前端以 resume metadata 重新加入同一 match；後端不依賴前端快取，而是從仍在執行的 authoritative state 發送最新 snapshot。前端 resume 邏輯不在 Go runtime，但 server snapshot 的來源是 `MatchJoin` 與 `financeBroadcastState`。

程式位置：

- [MatchJoin](../runtime_finance_match.go:54)：加入／重連後初始化 presence 並送 state。
- [financeBroadcastState](../runtime_finance_match.go:268)：廣播目前 server state。
- [joinRealtimeMatch](../../../apps/web/lib/nakama/match.ts:795)：前端中性 realtime join API。
- [FinanceDuelMatchPanel resume effect](../../../apps/web/components/finance-duel-match-panel.tsx:134)：刷新後重連畫面流程。

## 訂單、費率與投組

### Q：同一 tick 為什麼要限制訊息數量？

A：限制單一玩家在一個 server tick 可送出的交易 mutation 和 state request，避免大量 socket 訊息壟斷 match loop 或建立大量訂單。

程式位置：

- [financeAllowMessage](../runtime_finance_orders.go:87)：檢查每 tick 的訊息窗。
- [financeHandleMessage](../runtime_finance_orders.go:15)：在處理 opcode 前呼叫限流。
- [TestFinanceAllowMessage](../runtime_finance_test.go:30)：驗證上限與下一 tick 重設。

### Q：Market order 怎麼成交？

A：後端先驗證行情、資金與持倉，再用目前 server price 加入買賣方向的滑價，計算名目金額、費用、賣出稅，最後更新 portfolio 並保存 fill。

程式位置：

- [financeAcceptOrder](../runtime_finance_orders.go:106)：訂單資格與現貨限制。
- [financeTryFillOrder](../runtime_finance_orders.go:189)：成交、fee、tax、slippage、cash、BTC 更新。
- [applyMatchSlippage](../runtime_market.go:459)：依 side 套用滑價。
- [calculateBpsCeil](../runtime_finance_math.go:6)：以 basis points 算費率。

### Q：Limit order 為什麼不一定立刻成交？

A：不符合目前價格條件的 limit order 保留在 server state 的 open order book；每次 tick 或價格更新後，後端重新檢查是否可成交。

程式位置：

- [financeAcceptOrder](../runtime_finance_orders.go:106)：決定 order 是立即嘗試成交還是保留。
- [financeProcessOpenOrders](../runtime_finance_orders.go:260)：掃描 open orders 並嘗試成交。
- [financeRefreshPrice](../runtime_finance_orders.go:273)：更新 server price 後觸發後續處理。

### Q：`filled`、`partial`、`ioc_remainder_canceled` 的資料在哪裡？

A：狀態記錄在 `financeOrder.Status`；成交紀錄另寫成 append-only fill。`filled` 是全數成交，`partial` 是部分成交仍有剩餘量，`ioc_remainder_canceled` 是 IOC 未成交餘額取消。

程式位置：

- [financeOrder](../runtime_finance_models.go:83)：order status 與剩餘數量欄位。
- [financeTryFillOrder](../runtime_finance_orders.go:189)：更新成交／部分成交狀態。
- [financePersistOrder](../runtime_finance_persistence.go:53)：保存 order 最新 projection。
- [financePersistFill](../runtime_finance_persistence.go:247)：保存每筆 fill。

### Q：為什麼使用 cents 和 BTC micros？

A：避免浮點數誤差。美元以 `int64` cents 保存，BTC 以 `1 BTC = 1,000,000 micros` 保存；所有 notional、fee、tax、NAV 都以整數公式算出。

程式位置：

- [financeUSDScale、financeBTCScale](../runtime_config.go:58)：金額與 BTC 精度常數。
- [financePortfolio](../runtime_finance_models.go:65)：portfolio 的整數欄位。
- [financeNotional](../runtime_finance_orders.go:387)：BTC micros 轉換名目金額。
- [TestFinanceNotionalPreservesBTCMicrosPrecision](../runtime_finance_test.go:10)：精度測試。

### Q：未實現損益如何計算？

A：後端以目前 server price、平均成本與持有 BTC 數量計算 unrealized P&L；同一個函式同時重算 NAV 和報酬率。

程式位置：

- [financeMarkPortfolios](../runtime_finance_orders.go:292)：mark-to-market 計算。
- [financePortfolio](../runtime_finance_models.go:65)：`UnrealizedPnLCents`、`NAVCents`、`ReturnBps` 欄位。
- [financePersistRoundPortfolios](../runtime_finance_persistence.go:256)：每回合保存結果。

## 市場資料與防護

### Q：為什麼行情 worker 不直接寫 PostgreSQL？

A：直接寫資料庫會繞過行情來源驗證、HMAC、nonce、防過期、allowlist 與價格跳動保護。worker 只能呼叫 ingestion RPC，Go runtime 在寫入前統一驗證。

程式位置：

- [price-feed worker](../../../apps/web/scripts/price-feed-worker.mjs:121)：抓 OHLCV 並呼叫 RPC。
- [rpcIngestMatchCandlesHandler](../runtime_market.go:22)：受保護的行情入口。
- [validateMarketIngestSignature](../runtime_market.go:119)：驗證 HMAC 與時間。
- [claimMarketIngestNonce](../runtime_market.go:142)：防止 payload 重播。

### Q：HMAC、timestamp、nonce 分別保護什麼？

A：HMAC 確認 payload 由持有 secret 的 worker 產生；timestamp 限制可接受的傳送時間偏差；nonce 確保相同有效 payload 不能重播。

程式位置：

- [marketIngestCanonical](../runtime_market.go:101)：決定哪些欄位被簽章保護。
- [validateMarketIngestSignature](../runtime_market.go:119)：驗證時間與 signature。
- [claimMarketIngestNonce](../runtime_market.go:142)：以 Storage record claim nonce。
- [TestValidateMarketIngestSignature](../runtime_market_test.go:28)：驗證竄改 candle 後簽章失效。

### Q：什麼是 `marketStale`？

A：最新 server price 太舊、格式無法解析，或來源是 bootstrap 假行情時，市場被視為 stale。後端拒絕新訂單，而不是繼續用舊價格成交。

程式位置：

- [financePriceIsStale](../runtime_finance_history.go:438)：時間 freshness 判定。
- [financePriceRecordIsStale](../runtime_finance_history.go:428)：bootstrap 一律 stale。
- [financeAcceptOrder](../runtime_finance_orders.go:106)：stale market 時拒絕訂單。
- [TestFinancePriceFreshness](../runtime_finance_test.go:61)：fresh／stale／無效時間測試。

### Q：為什麼 bootstrap 行情不可交易？

A：bootstrap 僅供隔離測試或畫面初始化，不能被誤當成外部真實價格；即使更新時間新鮮，`Source = bootstrap` 也會被判定 stale。

程式位置：

- [marketBootstrapEnabled](../runtime_market.go:363)：只有明確環境開關才允許建立。
- [financePriceRecordIsStale](../runtime_finance_history.go:428)：bootstrap record 永遠不可交易。
- [TestBootstrapMarketDataIsNeverTradable](../runtime_finance_test.go:77)：不可交易測試。

## 保存、一致性與營運

### Q：如何防止重送下單造成重複成交？

A：order intent 帶有 client order ID。後端用 arena ID、user ID、client order ID 建立 idempotency key，保存第一次 authoritative 結果；相同意圖重送時讀回既有結果，而不建立第二筆訂單。

程式位置：

- [financeOrderIdempotencyKey](../runtime_finance_persistence.go:67)：建立唯一 key。
- [readFinanceOrderIdempotency](../runtime_finance_persistence.go:72)：讀取既有結果。
- [financePersistOrderIdempotency](../runtime_finance_persistence.go:92)：保存第一次結果。
- [financeAcceptOrder](../runtime_finance_orders.go:106)：下單流程內使用 idempotency。

### Q：為什麼同時保存 order、fill、event、snapshot、game 與 stats？

A：它們用途不同：order 是目前狀態、fill 是實際成交、event 是稽核、snapshot 是時間序列、game 是最終結果、stats 是快速查詢 projection。

程式位置：

- [financeAppendEvent](../runtime_finance_persistence.go:15)：append-only event。
- [financePersistOrder](../runtime_finance_persistence.go:53)：order 最新狀態。
- [financePersistFill](../runtime_finance_persistence.go:247)：成交明細。
- [financePersistRoundPortfolios](../runtime_finance_persistence.go:256)：每回合 snapshot。
- [persistFinanceGameAndStats](../runtime_finance_persistence.go:284)：完成對局與 stats。

### Q：CAS retry 解決什麼問題？

A：同一玩家可能接近同時完成多局。若兩個結算都讀舊 stats 後直接覆寫，會遺失其中一局的更新。CAS 比對 Storage version；衝突時重新讀取、重算後再寫。

程式位置：

- [persistFinanceGameAndStats](../runtime_finance_persistence.go:284)：寫入 game、stats、history 與 outbox。
- [financeUpdatedPlayerStats](../runtime_finance_persistence.go:327)：讀取並重算 Elo／戰績。
- [financePlayerStatsRecord](../runtime_finance_models.go:139)：stats projection 結構。

### Q：為什麼需要 leaderboard outbox？

A：對局 final record 與 Nakama leaderboard 更新不是同一個原子操作。先將待投影資料同批保存；如果 leaderboard API 寫入失敗，maintenance 會重試，避免戰績已保存但排行榜漏更新。

程式位置：

- [persistFinanceGameAndStats](../runtime_finance_persistence.go:284)：建立 game/stats/history/outbox。
- [projectFinanceResultLeaderboards](../runtime_community_score.go:165)：嘗試投影 authoritative return。
- [financeRetryPendingLeaderboardProjections](../runtime_maintenance.go:91)：重試失敗 outbox。

### Q：maintenance lease 解決什麼問題？

A：多個 match 或多節點可能同時進行 idempotency、nonce 清理或 outbox retry。lease 用 Storage version CAS 讓同一工作在一段時間內只由一個執行者執行。

程式位置：

- [financeRunMaintenanceTask](../runtime_maintenance.go:17)：執行被 lease 保護的工作。
- [financeTryAcquireMaintenanceLease](../runtime_maintenance.go:42)：用 CAS 取得 lease。
- [financeCleanupExpiredIdempotency](../runtime_finance_persistence.go:109)：被保護的清理工作。
- [cleanupMarketIngestNonces](../runtime_market.go:162)：nonce 清理工作。

## 權限與部署

### Q：`runtime_security.go` 的 identity 是什麼？

A：identity 是 RPC 呼叫者的限流身分。已登入時優先使用 Nakama user ID；沒有 user ID 時才使用 client IP。這樣不同玩家有獨立限流額度，匿名來源也受基本防護。

程式位置：

- [withRPCRateLimit](../runtime_security.go:37)：取得 user ID／IP 並建立 identity key。
- [allowRuntimeRPC](../runtime_security.go:72)：依 identity key 記錄與檢查時間窗。
- [InitModule RPC registration](../runtime.go:67)：所有 RPC 註冊時套用 wrapper。

### Q：為什麼一般玩家不能呼叫 `get_finance_metrics`？

A：metrics 包含配對量、拒單原因、行情 stale 等營運資料，不屬於玩家的個人 history。後端從環境 allowlist 驗證管理員 user ID。

程式位置：

- [rpcGetFinanceMetricsHandler](../runtime_finance_history.go:80)：管理員 metrics RPC。
- [financeMetricsAdminAllowed](../runtime_finance_history.go:96)：比對 `FINANCE_METRICS_ADMIN_USER_IDS`。
- [docker-compose production metrics env](../docker-compose.production.yml:58)：正式環境 allowlist 注入位置。

### Q：為什麼 client 直接提交 portfolio score 預設關閉？

A：若接受 client score，玩家可以偽造排行榜。正式流程只讓 Finance 結算後的 server-calculated `ReturnBps` 投影 leaderboard。

程式位置：

- [rpcSubmitPortfolioScoreHandler](../runtime_community_score.go:70)：舊直接送分數入口與政策檢查。
- [projectFinanceResultLeaderboards](../runtime_community_score.go:165)：結算後投影分數。
- [production feature flag](../docker-compose.production.yml:59)：`ALLOW_CLIENT_PORTFOLIO_SCORE_SUBMISSION=false`。

### Q：`local.yml` 為什麼保留？正式部署能使用嗎？

A：它保存 Nakama 的基礎結構設定，例如 plugin path、session、socket 與 tracker。正式部署仍可作為基底，但本機固定 secret、DEBUG logger 與預設 Console 帳密不可直接使用；production Compose 以環境變數與 CLI 覆寫敏感欄位。

程式位置：

- [local.yml runtime path](../local.yml:39)：指定 `backend.so` 載入路徑。
- [local.yml session](../local.yml:50)：本機 session 設定。
- [local.yml socket](../local.yml:66)：本機 API／WebSocket 設定。
- [production secret overrides](../docker-compose.production.yml:32)：覆寫 logger、Console、session、runtime、socket secret。
- [production localhost binding](../docker-compose.production.yml:67)：只綁 `127.0.0.1:7350`，交由 TLS proxy 對外。

### Q：目前是否已完整 production-ready？

A：目前有 production baseline：secret 強制注入、localhost API binding、bootstrap/直接送分數/直接建房關閉、HMAC 啟用。但仍必須在基礎設施完成 TLS reverse proxy、WAF/共享限流、secret manager、PostgreSQL PITR、集中監控、壓力與故障演練後，才可稱完整正式部署。

程式位置：

- [production Compose](../docker-compose.production.yml:1)：現有安全設定。
- [DEPLOYMENT.md](../DEPLOYMENT.md:1)：TLS、備份、多節點與監控要求。
- [runtime limiter](../runtime_security.go:37)：單 process 防線，不是多節點共享限流。
