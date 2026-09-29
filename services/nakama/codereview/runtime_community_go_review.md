# Community 模組 Top-Down Code Review

Community 不再由單一 `runtime_community.go` 承載。所有檔案仍是同一個 Go package，因此可共用 model、常數與 helper；拆分只是在程式碼層面明確劃分責任，不會改變 RPC 名稱、storage collection 或 Nakama 行為。

## 1. 上層責任

Community 模組處理兩個領域：使用者的投組分數排行榜，以及 Guild 的建立、治理、加入與明細查詢。前端只透過 HTTP RPC 提出請求；角色、成員資格、排行榜分數、audit log 與 storage projection 均由 Nakama runtime 決定。

```text
apps/web
  -> Nakama HTTP RPC
     -> Guild handlers：解析 payload、驗證身分與權限、協調流程
        -> storage：讀寫 membership/config/request/audit
        -> views：組合 guild detail read model
        -> helpers：角色、成員、冷卻與摘要共用判斷
     -> score：驗證投組分數並寫入 Nakama leaderboard
```

## 2. 檔案分層與閱讀順序

1. [runtime_community_models.go](../runtime_community_models.go)：Community payload、storage record 與 view model 的資料形狀。
2. [runtime_community_score.go](../runtime_community_score.go)：Phase config、投組分數與 Guild 平均排行榜。
3. [runtime_community_guild_lifecycle.go](../runtime_community_guild_lifecycle.go)：建立、離開與解散。
4. [runtime_community_guild_members.go](../runtime_community_guild_members.go)：邀請、申請、核准、拒絕與踢除。
5. [runtime_community_guild_governance.go](../runtime_community_guild_governance.go)：角色、owner operation 與設定。
6. [runtime_community_guild_queries.go](../runtime_community_guild_queries.go)：申請、detail 與使用者搜尋 read path。
7. [runtime_community_storage.go](../runtime_community_storage.go)：Group、Storage、operation、reconciliation 與 audit。
8. [runtime_community_views.go](../runtime_community_views.go)：把 roster、分數與 profile 投影成前端可讀明細。
9. [runtime_community_helpers.go](../runtime_community_helpers.go)：共用的角色、membership 與 leaderboard helper。

## 3. 下層 Code Review

| 層級 | 主要問題 | Code review |
| --- | --- | --- |
| 分數與排行榜 | 分數如何驗證、寫入、重新聚合 | [Score review](runtime_community_score_go_review.md) |
| Guild RPC | 呼叫者怎麼被驗證、流程如何協調 | [Guild handler review](runtime_community_guild_handlers_go_review.md) |
| 資料保存 | 哪些資料寫入 Nakama storage、audit key 如何建立 | [Storage review](runtime_community_storage_go_review.md) |
| 前端 read model | Guild detail 如何由多個來源組裝 | [View review](runtime_community_views_go_review.md) |
| 共用規則 | roster state、管理權限、冷卻邏輯 | [Helper review](runtime_community_helpers_go_review.md) |
| 型別定義 | payload 與 record 欄位 | [Model review](runtime_community_models_go_review.md) |

## 4. 主要資料流

### 建立 Guild

`rpcCreateGuildHandler` 驗證使用者尚未加入 Guild 後，建立或驗證 Nakama Group，接著寫入 owner membership、預設 config 與第一筆 `guild_created` audit。細節從 [Guild handler review](runtime_community_guild_handlers_go_review.md) 開始，再閱讀 [Storage review](runtime_community_storage_go_review.md)。

### 加入與治理

邀請、申請加入、核准、拒絕、升降職、移交 owner、踢除與解散，皆先由 handler 驗證呼叫者與 payload，再透過 storage/helper 操作 roster 與 projection。這能避免前端自行決定角色或直接修改 audit。

### Guild Detail

`rpcGetGuildDetailHandler` 是 read path：先讀 Group 與 roster，再由 view layer 合成 members、contribution、config、join requests、audit 與 leaderboard summary；它不在 read 時修改治理狀態。

### 分數與排行榜

`rpcSubmitPortfolioScoreHandler` 驗證分數與冷卻後寫入個人 global/weekly leaderboard，再重新計算目前 Guild 的平均分數。Guild 成員變動後，對應 handler 也會觸發平均榜重算。

## 5. 舊檔案說明

舊的 `runtime_community.go` 已移除。舊 review 的行數連結不再適用；請以本文件與四份新 review 文件中的新檔案連結為準。
