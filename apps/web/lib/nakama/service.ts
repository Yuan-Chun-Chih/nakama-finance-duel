// 對外相容入口。
// component 仍然可以從 "@/lib/nakama/service" 匯入，不需要知道實作被拆到哪些檔案。
// 實際責任分工：
// - types.ts：共用資料型別。
// - client.ts：Nakama client、session、runtime env、錯誤包裝。
// - dashboard.ts：登入、好友、group/guild、leaderboard、detail 資料流程。
// - chat.ts：realtime socket、聊天室、未讀數、presence、typing。
export * from "./types";
export * from "./dashboard";
export * from "./chat";
export * from "./match";
