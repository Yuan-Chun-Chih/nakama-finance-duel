# runtime_user.go Code Review 遷移說明

`runtime_user.go` 已不存在，使用者身分、搜尋與權限驗證已拆到下列檔案。

- Nakama context 身分與 RPC 錯誤：[`runtime_rpc_helpers_go_review.md`](runtime_rpc_helpers_go_review.md)
- 使用者搜尋 SQL：[`runtime_community_guild_queries_go_review.md`](runtime_community_guild_queries_go_review.md)
- Guild roster 身分驗證：[`runtime_community_helpers_go_review.md`](runtime_community_helpers_go_review.md)
