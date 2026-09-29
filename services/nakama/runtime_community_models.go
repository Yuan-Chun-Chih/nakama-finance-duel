package main // 這個檔案定義了 Nakama runtime 的社群模型，包含了公會、成員、邀請、設定等資料結構，以及排行榜的分數紀錄。

type createGuildPayload struct { // 建立公會的 payload，包含了公會的名稱、描述與所屬社群。
	GuildID     string `json:"guildId"`
	Name        string `json:"name"`
	Description string `json:"description"`
}
type guildJoinPayload struct { // 加入公會的 payload，包含了公會的 ID。
	GuildID string `json:"guildId"`
}
type guildLeavePayload struct { // 離開公會的 payload，包含了公會的 ID。
	GuildID string `json:"guildId"`
}
type guildInvitePayload struct { // 邀請玩家加入公會的 payload，包含了公會的 ID 與玩家的使用者名稱。
	GuildID  string `json:"guildId"`
	Username string `json:"username"`
}
type guildMemberPayload struct {
	GuildID     string `json:"guildId"`
	UserID      string `json:"userId"`
	OperationID string `json:"operationId,omitempty"`
}
type guildSettingsPayload struct {
	GuildID      string `json:"guildId"`
	Announcement string `json:"announcement"`
	JoinPolicy   string `json:"joinPolicy"`
}
type submitPortfolioScorePayload struct {
	Score  int64  `json:"score"`
	Source string `json:"source"`
}
type userSearchPayload struct {
	Query string `json:"query"`
	Limit int    `json:"limit"`
}
type guildMembershipStorage struct {
	GuildID string `json:"guildId"`
	Role    string `json:"role"`
}
type guildJoinRequestRecord struct {
	GuildID     string `json:"guildId"`
	UserID      string `json:"userId"`
	Username    string `json:"username"`
	RequestedAt string `json:"requestedAt"`
	Status      string `json:"status"`
}
type guildConfigStorage struct {
	GuildID       string `json:"guildId"`
	Announcement  string `json:"announcement"`
	JoinPolicy    string `json:"joinPolicy"`
	UpdatedAt     string `json:"updatedAt"`
	UpdatedBy     string `json:"updatedBy"`
	UpdatedByName string `json:"updatedByName"`
}
type guildAuditRecord struct {
	ID           string `json:"id"`
	GuildID      string `json:"guildId"`
	Action       string `json:"action"`
	ActorID      string `json:"actorId"`
	ActorName    string `json:"actorName"`
	TargetUserID string `json:"targetUserId,omitempty"`
	TargetName   string `json:"targetName,omitempty"`
	Summary      string `json:"summary"`
	CreatedAt    string `json:"createdAt"`
}
type guildOperationRecord struct {
	ID           string `json:"id"`
	GuildID      string `json:"guildId"`
	Action       string `json:"action"`
	ActorUserID  string `json:"actorUserId"`
	TargetUserID string `json:"targetUserId"`
	Status       string `json:"status"`
	Step         string `json:"step"`
	LastError    string `json:"lastError,omitempty"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}
type portfolioScoreStorage struct {
	Score     int64  `json:"score"`
	UpdatedAt string `json:"updatedAt"`
}
type leaderboardRecordSummary struct {
	OwnerID  string `json:"ownerId"`
	Username string `json:"username"`
	Score    int64  `json:"score,omitempty"`
	Subscore int64  `json:"subscore,omitempty"`
	Rank     int64  `json:"rank,omitempty"`
}
