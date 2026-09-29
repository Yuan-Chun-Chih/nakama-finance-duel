package main

type matchCandleIngestPayload struct { //用於行情 ingest 的 payload，包含了社群 ID、標的、來源、K 線資料等資訊。
	Secret    string              `json:"secret"`
	SentAt    string              `json:"sentAt"`
	Nonce     string              `json:"nonce"`
	Signature string              `json:"signature"`
	Symbol    string              `json:"symbol"`
	Source    string              `json:"source"`
	Candles   []matchCandleRecord `json:"candles"`
}

type marketIngestNonceRecord struct { //用於儲存行情 ingest 的 nonce 記錄，包含了 nonce、過期時間與使用者 ID。
	Nonce     string `json:"nonce"`
	ExpiresAt string `json:"expiresAt"`
}
type matchCandleListPayload struct { //用於行情查詢的 payload，包含了標的、限制數量與分頁游標。
	Symbol string `json:"symbol"`
	Limit  int    `json:"limit"`
}

type matchPriceRecord struct { //用於行情價格的紀錄，包含了標的、價格、來源與更新時間。
	Symbol    string `json:"symbol"`
	Price     int64  `json:"price"`
	UpdatedAt string `json:"updatedAt"`
	Source    string `json:"source"`
}

type matchCandleRecord struct { //用於行情 K 線的紀錄，包含了標的、K 線輪次、開盤價、最高價、最低價、收盤價、成交量、時間戳與來源。
	Symbol    string `json:"symbol"`
	Round     int    `json:"round"`
	Open      int64  `json:"open"`
	High      int64  `json:"high"`
	Low       int64  `json:"low"`
	Close     int64  `json:"close"`
	Volume    int64  `json:"volume"`
	Timestamp int64  `json:"timestamp"`
	Source    string `json:"source"`
	UpdatedAt string `json:"updatedAt"`
}
