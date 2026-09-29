package main

import (
	"testing"
	"time"
)

// TestAllowRuntimeRPC 驗證固定時間窗達到上限後拒絕，跨窗後恢復接受。
func TestAllowRuntimeRPC(t *testing.T) {
	runtimeRPCRateLimiter.Lock()                                   //鎖定快取，避免其他測試或 goroutine 同時修改。
	runtimeRPCRateLimiter.Windows = map[string]runtimeRateWindow{} //清空快取，避免測試受到其他測試或先前狀態影響。
	runtimeRPCRateLimiter.Unlock()                                 //解鎖快取，允許其他測試或 goroutine 使用。
	now := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)            // 使用 time.Date 建立一個固定的時間點，模擬測試的當前時間，方便測試時間窗的行為。
	policy := runtimeRatePolicy{Limit: 2, Window: time.Minute}
	if !allowRuntimeRPC("user:rpc", policy, now) || !allowRuntimeRPC("user:rpc", policy, now.Add(time.Second)) { //兩次請求，未超過限制
		t.Fatal("requests within the configured limit should be accepted")
	} //用戶端的 storageList 取得排行榜投影的 outbox records，檢查是否有尚未完成的投影，若有則重試。
	if allowRuntimeRPC("user:rpc", policy, now.Add(2*time.Second)) { //如果超過限制(三次)，應該拒絕
		t.Fatal("request above the configured limit should be rejected")
	}
	if !allowRuntimeRPC("user:rpc", policy, now.Add(time.Minute)) { //跨窗後，應該恢復接受
		t.Fatal("request in a new time window should be accepted")
	}
}
