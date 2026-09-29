# Code Review: `runtime_finance.go` (推斷內容)

**檔案路徑:** `c:\Users\kdsam\Documents\nakama-duel\services\nakama\runtime_finance.go`
**目的:** 此檔案預計包含遊戲中金融交易對戰的核心邏輯，包括權威性比賽的實現、處理玩家的交易操作、管理投資組合、計算收益以及相關的 RPC 接口。它是遊戲經濟系統的關鍵組成部分。

---

**注意:** `runtime_finance.go` 檔案的實際內容未在提供的上下文中，此審查文件基於其在 `runtime.go` 中註冊的 RPC 處理器和權威性比賽模組名稱 (`financeAuthoritativeModule`) 進行推斷。其所描述的具體函式實現可能分佈在 `runtime_finance_match.go`、`runtime_finance_history.go`、`runtime_finance_matchmaking.go` 等其他檔案中。

---

## 函式分析 (推斷)

由於 `runtime_finance.go` 的實際內容未提供，以下分析基於其在 `runtime.go` 中註冊的 RPC 處理器和權威性比賽模組名稱 (`financeAuthoritativeModule`) 進行推斷。

### `financeAuthoritativeMatch` (結構體及方法)

**功能描述:**
這是一個實現 `runtime.Match` 介面的結構體，代表一個權威性的金融交易對戰實例。它負責管理比賽的狀態、處理玩家的交易指令、執行市場模擬以及決定比賽結果。

**結構說明 (推斷):**
```go
// 假設的結構體定義
type financeAuthoritativeMatch struct {
	matchID string
	tick int64
	players map[runtime.SessionID]*financePlayerState
	marketData *financeMarketSimulator
	// ... 其他比賽狀態變數
}
```

**方法說明 (推斷):**
1.  **`MatchInit(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, params map[string]interface{}) (interface{}, error)`**
    *   **功能:** 初始化一個新的金融交易比賽實例。
    *   **結構說明:**
        *   從 `params` 中讀取比賽設定，例如初始資金、交易對等。
        *   初始化比賽狀態，包括玩家列表、市場模擬器、當前時間戳等。
        *   可能從 Nakama 儲存中載入必要的配置或數據。
        *   返回初始的比賽狀態。

2.  **`MatchJoin(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presence runtime.Presence) (interface{}, error)`**
    *   **功能:** 處理玩家加入比賽的請求。
    *   **結構說明:**
        *   將新加入的 `presence` (玩家) 添加到比賽的玩家列表中。
        *   為新玩家初始化其投資組合狀態（例如給予初始資金）。
        *   向新玩家發送當前比賽狀態和市場數據。
        *   返回更新後的比賽狀態。

3.  **`MatchLoop(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, messages []runtime.MatchData) (interface{}, error)`**
    *   **功能:** 這是比賽的核心循環，每個遊戲 tick 都會被呼叫。它處理所有來自玩家的輸入和遊戲邏輯的更新。
    *   **結構說明:**
        *   **處理輸入訊息:** 遍歷 `messages` (玩家發送的 `runtime.MatchData`)。根據 `MatchData.OpCode` (例如 `financeOrderOpCode`, `financeCancelOpCode`) 處理玩家的交易訂單、取消訂單等操作。
        *   **更新市場狀態:** 根據時間推進和外部市場數據（可能從 `runtime_market.go` 獲取），更新市場價格。
        *   **執行交易:** 根據市場價格和玩家訂單，執行買賣交易，更新玩家的資產和現金。
        *   **計算投資組合:** 定期計算每個玩家的投資組合價值和回報率。
        *   **發送狀態更新:** 使用 `dispatcher.BroadcastMessage` 向所有玩家廣播更新後的比賽狀態、市場數據和個人投資組合信息。
        *   **檢查比賽結束條件:** 檢查是否達到比賽結束條件（例如時間結束、所有玩家破產）。
        *   返回更新後的比賽狀態。

4.  **`MatchLeave(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) (interface{}, error)`**
    *   **功能:** 處理玩家離開比賽的請求。
    *   **結構說明:**
        *   從比賽的玩家列表中移除離開的 `presences`。
        *   如果比賽因玩家不足而無法繼續，則可能觸發比賽終止。
        *   返回更新後的比賽狀態。

5.  **`MatchTerminate(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, reason int) error`**
    *   **功能:** 終止比賽實例，進行清理和結果處理。
    *   **結構說明:**
        *   計算最終的比賽結果，例如每個玩家的最終投資組合回報。
        *   將比賽結果儲存到 Nakama 儲存中（例如 `collectionFinanceGames`, `collectionFinancePortfolios`）。
        *   更新排行榜（呼叫 `nk.LeaderboardRecordWrite`）。
        *   執行任何必要的清理工作。
        *   返回 `nil` 表示成功。

### `rpcCreateFinanceMatchHandler`

**功能描述:**
一個 RPC 處理器，用於處理玩家創建新的金融交易比賽的請求。

**函式簽名 (推斷):**
```go
func rpcCreateFinanceMatchHandler(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error)
```

**結構說明 (推斷):**
1.  **驗證使用者:** 呼叫 `requireUserID(ctx)` 確保請求來自已驗證的使用者。
2.  **解析 Payload:** 解析 `payload` 以獲取比賽創建參數，例如比賽名稱、持續時間、初始資金等。
3.  **創建比賽:** 呼叫 `nk.MatchCreate(ctx, financeAuthoritativeModule, params)` 創建一個新的權威性比賽實例。
4.  **返回比賽 ID:** 返回新創建比賽的 ID。

### `rpcListFinanceHistoryHandler`

**功能描述:**
一個 RPC 處理器，用於列出玩家的歷史金融交易記錄。

**函式簽名 (推斷):**
```go
func rpcListFinanceHistoryHandler(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error)
```

**結構說明 (推斷):**
1.  **驗證使用者:** 呼叫 `requireUserID(ctx)`。
2.  **解析 Payload:** 解析 `payload` 以獲取查詢參數，例如時間範圍、交易對過濾器、分頁信息。
3.  **讀取儲存:** 從 Nakama 儲存中讀取玩家的交易歷史記錄（例如 `collectionFinanceFills`, `collectionFinanceOrders`）。
4.  **返回歷史記錄:** 將查詢結果序列化為 JSON 字串並返回。

### `rpcGetFinanceMetricsHandler`

**功能描述:**
一個 RPC 處理器，用於獲取玩家或系統的金融相關指標，例如投資組合表現、勝率等。

**函式簽名 (推斷):**
```go
func rpcGetFinanceMetricsHandler(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error)
```

**結構說明 (推斷):**
1.  **驗證使用者:** 呼叫 `requireUserID(ctx)`。
2.  **解析 Payload:** 解析 `payload` 以獲取查詢參數，例如要查詢的玩家 ID (如果查詢其他玩家的公開數據)、指標類型。
3.  **讀取儲存/計算:** 從 Nakama 儲存中讀取相關數據（例如 `collectionFinanceStats`, `collectionFinancePortfolios`），並可能進行實時計算。
4.  **返回指標:** 將計算或查詢到的指標序列化為 JSON 字串並返回。

### `rpcFinanceMatchmakingHandler`

**功能描述:**
一個 RPC 處理器，用於處理玩家進行金融交易比賽配對的請求。

**函式簽名 (推斷):**
```go
func rpcFinanceMatchmakingHandler(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error)
```

**結構說明 (推斷):**
1.  **驗證使用者:** 呼叫 `requireUserID(ctx)`。
2.  **解析 Payload:** 解析 `payload` 以獲取配對參數，例如期望的對手數量、技能等級範圍等。
3.  **添加配對請求:** 呼叫 `nk.MatchmakerAdd(ctx, userID, query, minCount, maxCount, stringProperties, numericProperties)` 將玩家添加到配對池中。
4.  **返回配對票據:** 返回配對操作的票據 ID。

### `financeMatchmakerMatched` (函式)

**功能描述:**
這個函式在 Nakama 配對器找到匹配對象後被呼叫。它負責將匹配到的玩家引導到一個新的或現有的金融交易比賽中。

**函式簽名 (推斷):**
```go
func financeMatchmakerMatched(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, entries []runtime.MatchmakerEntry) (string, error)
```

**結構說明 (推斷):**
1.  **處理匹配條目:** 遍歷 `entries` (匹配到的玩家列表)。
2.  **創建或加入比賽:**
    *   如果這是新的匹配，則呼叫 `nk.MatchCreate(ctx, financeAuthoritativeModule, params)` 創建一個新的金融交易比賽。
    *   然後，呼叫 `nk.MatchJoin(ctx, matchID, presences)` 將所有匹配到的玩家加入到這個新創建的比賽中。
3.  **返回比賽 ID:** 返回比賽的 ID，以便前端客戶端可以連接到該比賽。

### 其他輔助函式 (推斷)

此檔案可能還包含許多內部輔助函式，用於支持上述核心邏輯，例如：
-   `calculatePortfolioValue(player *financePlayerState, marketPrices map[string]int64) int64`: 計算玩家當前投資組合的總價值。
-   `processOrder(player *financePlayerState, order *financeOrder, marketPrice int64)`: 處理單個交易訂單的邏輯。
-   `updateLeaderboardScore(ctx context.Context, nk runtime.NakamaModule, userID string, score int64)`: 更新玩家在排行榜上的分數。
-   `savePlayerState(ctx context.Context, nk runtime.NakamaModule, playerID string, state *financePlayerState)`: 將玩家的金融狀態儲存到 Nakama 儲存。
-   `loadPlayerState(ctx context.Context, nk runtime.NakamaModule, playerID string) (*financePlayerState, error)`: 從 Nakama 儲存載入玩家的金融狀態。

---

## 總結

`runtime_finance.go` (推斷) 是 Nakama Duel 遊戲中金融交易系統的核心。它通過實現權威性比賽模組來確保遊戲邏輯的公正性和安全性，並通過一系列 RPC 接口為前端提供了創建比賽、查詢歷史數據和進行配對的功能。其內部邏輯將涉及複雜的狀態管理、市場模擬、交易執行和結果計算，是整個遊戲經濟系統的支柱。