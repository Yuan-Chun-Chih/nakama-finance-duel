# Guild Handler Top-Down Code Review

原本的 `runtime_community_guild_handlers.go` 已依責任拆分。請依下列順序進入逐行 review：

1. [Guild lifecycle](runtime_community_guild_lifecycle_go_review.md)：建立、離開、解散。
2. [Guild members](runtime_community_guild_members_go_review.md)：邀請、申請、核准、拒絕、踢除。
3. [Guild governance](runtime_community_guild_governance_go_review.md)：升降 admin、owner 移交、設定。
4. [Guild queries](runtime_community_guild_queries_go_review.md)：申請清單、detail、使用者搜尋。

共用的 operation、membership reconciliation、storage 與 audit 請接著閱讀 [Community storage review](runtime_community_storage_go_review.md)。
