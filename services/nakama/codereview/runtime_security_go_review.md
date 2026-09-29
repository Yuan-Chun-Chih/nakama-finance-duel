# runtime_security.go 逐行 Code Review

依照檔案中的 function 順序，說明 RPC 限流與環境安全設定。

## 1. withRPCRateLimit

~~~go
policy := runtimeRatePolicyFor(id)
return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
~~~

- `policy` 保存這個 RPC 的時間窗與最大呼叫數。
- 回傳的新 function 會包住原始 handler，因此不需要在每個 RPC 重複寫限流程式。

~~~go
identity := contextString(ctx, runtime.RUNTIME_CTX_USER_ID)
if identity == "" { identity = contextString(ctx, runtime.RUNTIME_CTX_CLIENT_IP) }
if identity == "" { identity = "anonymous" }
~~~

- 已登入請求優先使用 Nakama user ID，避免玩家換 IP 繞過限制。
- 未登入請求改用來源 IP；兩者都取不到時才放入 anonymous 群組。

~~~go
if !allowRuntimeRPC(identity+":"+id, policy, time.Now().UTC()) {
	return "", resourceExhausted("Too many requests. Please retry later.")
}
return handler(ctx, logger, db, nk, payload)
~~~

- key 同時包含 identity 與 RPC id，不同 RPC 不會共用計數。
- 超過上限回傳 gRPC `RESOURCE_EXHAUSTED`；通過後才執行真正 handler。

## 2. runtimeRatePolicyFor

~~~go
switch id {
case rpcFinanceMatchmaking:
	return runtimeRatePolicy{Limit: 120, Window: time.Minute}
case rpcListFinanceHistory, rpcSearchUsers:
	return runtimeRatePolicy{Limit: 30, Window: time.Minute}
}
~~~

- 配對 status 需要固定 polling，因此上限高於一般查詢。
- 歷史與搜尋可能產生較多 storage 或 account 查詢，因此使用較低上限。
- 沒有特別列出的 RPC 使用每分鐘 60 次預設值。

## 3. allowRuntimeRPC

~~~go
runtimeRPCRateLimiter.Lock()
defer runtimeRPCRateLimiter.Unlock()
~~~

- map 會被多個 RPC goroutine 同時讀寫，mutex 防止 data race。
- `defer` 確保 function 從任何 return 離開時都會解鎖。

~~~go
if window.StartedAt.IsZero() || now.Sub(window.StartedAt) >= policy.Window {
	runtimeRPCRateLimiter.Windows[key] = runtimeRateWindow{StartedAt: now, Count: 1}
	return true
}
if window.Count >= policy.Limit { return false }
~~~

- 第一次呼叫或舊時間窗已結束時建立新計數。
- Count 已達上限時不再執行 RPC；未達上限則加一並保存。

## 4. environmentFlag、environmentInt、environmentList

~~~go
value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
return value == "true" || value == "1"
~~~

- 未設定或拼錯的布林值都視為 false，危險功能預設關閉。

~~~go
value, err := strconv.ParseInt(strings.TrimSpace(os.Getenv(name)), 10, 64)
if err != nil || value <= 0 { return fallback }
~~~

- 數值設定必須是十進位正整數，否則使用程式內安全預設值。

~~~go
for _, value := range strings.Split(os.Getenv(name), ",") {
	if normalized := strings.TrimSpace(value); normalized != "" { result[normalized] = true }
}
~~~

- 逗號分隔字串會轉成 set，用於管理員、symbol 與來源 allowlist。

