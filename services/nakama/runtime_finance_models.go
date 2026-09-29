package main

import "github.com/heroiclabs/nakama-common/runtime"

// matchLobbyPayload 是 Nakama authoritative match 的名稱，前端會使用這個名稱來建立 match。
type matchLobbyPayload struct {
	CommunityID string `json:"communityId"`
	Kind        string `json:"kind"`
	MatchID     string `json:"matchId"`
	Name        string `json:"name"`
	HostUserID  string `json:"hostUserId"`
	GameType    string `json:"gameType"`
}

// financeAuthoritativeMatchState 是 Nakama authoritative match 的狀態結構，包含了比賽的所有資訊，例如玩家、訂單、價格等。
type financeAuthoritativeMatchState struct {
	ArenaID              string
	CommunityID          string
	Kind                 string
	Name                 string
	HostUserID           string
	Presences            map[string]runtime.Presence
	Players              []string
	Usernames            map[string]string
	Ready                map[string]bool
	ExpectedPlayers      map[string]bool
	Portfolios           map[string]*financePortfolio
	Orders               map[string]*financeOrder
	ClientOrders         map[string]string
	MessageRateWindows   map[string]financeMessageRateWindow
	OrderSequence        int64
	EventSequence        int64
	Tick                 int64
	StartedTick          int64
	StartedAt            string
	CountdownStartedTick int64
	ConfirmationDeadline int64
	CanceledByUserID     string
	CancelReason         string
	Round                int
	Status               string
	PriceCents           int64
	PriceUpdatedAt       string
	MarketStale          bool
	StaleMarketSeconds   int64
	Fills                []financeFillRecord
	WinnerUserIDs        []string
	FinishReason         string
	DisconnectedAt       map[string]int64
	LastSnapshotTick     int64
	StateVersion         int64
	ResultSaved          bool
	EmptyTicks           int
}

// financeAuthoritativeMatch 是 Nakama authoritative match 的實作，負責處理比賽的邏輯，例如玩家加入、離開、下單、成交等。
type financeAuthoritativeMatch struct{}

// financeAuthoritativeModule 是 Nakama authoritative match 的名稱，前端會使用這個名稱來建立 match。
type financePortfolio struct {
	UserID             string `json:"userId"`
	CashCents          int64  `json:"cashCents"`
	QuantityMicros     int64  `json:"quantityMicros"`
	AverageCostCents   int64  `json:"averageCostCents"`
	RealizedPnLCents   int64  `json:"realizedPnlCents"`
	UnrealizedPnLCents int64  `json:"unrealizedPnlCents"`
	NAVCents           int64  `json:"navCents"`
	ReturnBps          int64  `json:"returnBps"`
}

// financePortfolioStorage 是 Nakama authoritative match 的狀態結構，包含了玩家的投資組合資訊，例如現金、持股、成本、損益等。
type financeOrder struct {
	ID                      string `json:"id"`
	UserID                  string `json:"userId"`
	ClientOrderID           string `json:"clientOrderId,omitempty"`
	Side                    string `json:"side"`
	OrderType               string `json:"orderType"`
	QuantityMicros          int64  `json:"quantityMicros"`
	RemainingQuantityMicros int64  `json:"remainingQuantityMicros"`
	LimitPriceCents         int64  `json:"limitPriceCents"`
	Status                  string `json:"status"`
	Reason                  string `json:"reason,omitempty"`
	Round                   int    `json:"round"`
	CreatedAt               string `json:"createdAt"`
	UpdatedAt               string `json:"updatedAt"`
}

// financeOrderStorage 是 Nakama authoritative match 的狀態結構，包含了玩家的訂單資訊，例如訂單類型、數量、價格、狀態等。
type financeOrderIntent struct {
	Side            string `json:"side"`
	OrderType       string `json:"orderType"`
	QuantityMicros  int64  `json:"quantityMicros"`
	LimitPriceCents int64  `json:"limitPriceCents"`
	ClientOrderID   string `json:"clientOrderId"`
}

// financeMessageRateWindow 保存單一玩家在目前 server tick 內的訊息數量。
type financeMessageRateWindow struct {
	Tick  int64
	Count int
}

// financeOrderIntent 是 Nakama authoritative match 的狀態結構，包含了玩家的下單意圖，例如買賣方向、訂單類型、數量、價格等。
type financeFillRecord struct {
	ID             string `json:"id"`
	ArenaID        string `json:"arenaId"`
	OrderID        string `json:"orderId"`
	UserID         string `json:"userId"`
	Side           string `json:"side"`
	QuantityMicros int64  `json:"quantityMicros"`
	PriceCents     int64  `json:"priceCents"`
	NotionalCents  int64  `json:"notionalCents"`
	FeeCents       int64  `json:"feeCents"`
	TaxCents       int64  `json:"taxCents"`
	SlippageCents  int64  `json:"slippageCents"`
	Round          int    `json:"round"`
	ExecutedAt     string `json:"executedAt"`
}

// financeFillRecord 是 Nakama authoritative match 的狀態結構，包含了成交的資訊，例如訂單 ID、玩家 ID、成交數量、價格、手續費、稅金等。
type financePortfolioSnapshotRecord struct {
	ArenaID    string           `json:"arenaId"`
	Round      int              `json:"round"`
	PriceCents int64            `json:"priceCents"`
	Portfolio  financePortfolio `json:"portfolio"`
	CreatedAt  string           `json:"createdAt"`
}

// financePortfolioSnapshotRecord 是 Nakama authoritative match 的狀態結構，包含了玩家的投資組合快照資訊，例如價格、投資組合、建立時間等。
type financeRatingChange struct {
	UserID string `json:"userId"`
	Before int    `json:"before"`
	After  int    `json:"after"`
	Delta  int    `json:"delta"`
}

// financeRatingChange 是 Nakama authoritative match 的狀態結構，包含了玩家的評分變化資訊，例如變化前後的評分、變化量等。
type financePlayerStatsRecord struct {
	UserID         string `json:"userId"`
	Games          int    `json:"games"`
	Wins           int    `json:"wins"`
	Losses         int    `json:"losses"`
	Draws          int    `json:"draws"`
	Rating         int    `json:"rating"`
	RatingDelta    int    `json:"ratingDelta"`
	TotalReturnBps int64  `json:"totalReturnBps"`
	BestReturnBps  int64  `json:"bestReturnBps"`
	UpdatedAt      string `json:"updatedAt"`
}

// financePlayerStatsRecord 是 Nakama authoritative match 的狀態結構，包含了玩家的統計資訊，例如遊戲數、勝負、評分、總報酬率、最佳報酬率等。
type financeHistoryPayload struct {
	ArenaID string `json:"arenaId"`
	Limit   int    `json:"limit"`
	Cursor  string `json:"cursor"`
}
type financeMatchmakingPayload struct {
	Action string `json:"action"`
}

// financeMatchmakingRecord 是 Nakama authoritative match 的狀態結構，包含了玩家的配對資訊，例如配對狀態、比賽 ID、排隊令牌、搜尋開始時間、冷卻時間等。
type financeMatchmakingRecord struct {
	UserID          string `json:"userId"`
	Status          string `json:"status"`
	MatchID         string `json:"matchId,omitempty"`
	QueueToken      string `json:"queueToken,omitempty"`
	SearchStartedAt string `json:"searchStartedAt,omitempty"`
	CooldownUntil   string `json:"cooldownUntil,omitempty"`
	LeaseExpiresAt  string `json:"leaseExpiresAt,omitempty"`
	UpdatedAt       string `json:"updatedAt"`
}

// financeSystemMetrics 是 Nakama authoritative match 的狀態結構，包含了系統的統計資訊，例如配對開始數、匹配玩家數、總等待時間、完成比賽數、總過期市場時間、訂單拒絕數等。
type financeSystemMetrics struct {
	MatchmakingStarts       int64            `json:"matchmakingStarts"`
	MatchedPlayers          int64            `json:"matchedPlayers"`
	TotalMatchWaitSeconds   int64            `json:"totalMatchWaitSeconds"`
	CompletedMatches        int64            `json:"completedMatches"`
	TotalStaleMarketSeconds int64            `json:"totalStaleMarketSeconds"`
	OrderRejections         map[string]int64 `json:"orderRejections"`
	UpdatedAt               string           `json:"updatedAt"`
}

// financeSystemMetrics 是 Nakama authoritative match 的狀態結構，包含了系統的統計資訊，例如配對開始數、匹配玩家數、總等待時間、完成比賽數、總過期市場時間、訂單拒絕數等。
type financeOrderIdempotencyRecord struct {
	ArenaID       string `json:"arenaId"`
	UserID        string `json:"userId"`
	ClientOrderID string `json:"clientOrderId"`
	OrderID       string `json:"orderId"`
	Status        string `json:"status"`
	Reason        string `json:"reason,omitempty"`
	ExpiresAt     string `json:"expiresAt"`
	UpdatedAt     string `json:"updatedAt"`
}

// financeOrderIdempotencyRecord 是 Nakama authoritative match 的狀態結構，包含了玩家的訂單冪等性資訊，例如比賽 ID、玩家 ID、客戶端訂單 ID、訂單 ID、狀態、原因、過期時間、更新時間等。
type financeArenaIndexRecord struct {
	ArenaID               string   `json:"arenaId"`
	OrderIDs              []string `json:"orderIds"`
	FillIDs               []string `json:"fillIds"`
	PortfolioSnapshotKeys []string `json:"portfolioSnapshotKeys"`
	UpdatedAt             string   `json:"updatedAt"`
}
type financeMaintenanceCursor struct {
	Cursor    string `json:"cursor"`
	UpdatedAt string `json:"updatedAt"`
}

// financeLeaderboardProjectionRecord 保存待投影的 authoritative 對局分數，供失敗後重試。
type financeLeaderboardProjectionRecord struct {
	ArenaID   string            `json:"arenaId"`
	Scores    map[string]int64  `json:"scores"`
	Usernames map[string]string `json:"usernames"`
	CreatedAt string            `json:"createdAt"`
}

// financeCancelIntent 是 Nakama authoritative match 的狀態結構，包含了玩家的取消訂單意圖，例如訂單 ID。
type financeCancelIntent struct {
	OrderID string `json:"orderId"`
} // financeCancelIntent 是 Nakama authoritative match 的狀態結構，包含了玩家的取消訂單意圖，例如訂單 ID。
// financeGameRecord 是 Nakama authoritative match 的狀態結構，包含了比賽的資訊，例如比賽 ID、社群 ID、比賽種類、玩家、投資組合、勝利者、結束原因、開始時間、結束時間、評分變化等。
type financeGameRecord struct {
	ArenaID       string                       `json:"arenaId"`
	CommunityID   string                       `json:"communityId"`
	Kind          string                       `json:"kind"`
	Players       []string                     `json:"players"`
	Portfolios    map[string]*financePortfolio `json:"portfolios"`
	WinnerUserIDs []string                     `json:"winnerUserIds"`
	FinishReason  string                       `json:"finishReason"`
	StartedAt     string                       `json:"startedAt"`
	FinishedAt    string                       `json:"finishedAt"`
	Ratings       []financeRatingChange        `json:"ratings"`
}
