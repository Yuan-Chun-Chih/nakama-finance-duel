package main

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/heroiclabs/nakama-common/runtime"
)

// helper 函式主要是為了簡化 Nakama runtime 的開發，提供一些常用的功能，例如檢查社群成員資格、解析 JSON payload、建立錯誤訊息等。
func requireUserID(ctx context.Context) (string, error) {
	userID := contextString(ctx, runtime.RUNTIME_CTX_USER_ID)
	if userID == "" {
		return "", unauthenticated("Unauthenticated user.")
	}
	return userID, nil
}

// contextString 讀取 context 中的字串欄位，缺少或型別不符時回傳空字串。
func contextString(ctx context.Context, key string) string {
	value, _ := ctx.Value(key).(string)
	return value
}

// parsePayload 會將 JSON payload 解析到指定的結構體中，若 payload 為空或無法解析則回傳錯誤。
func parsePayload[T any](payload string, target *T) error {
	if strings.TrimSpace(payload) == "" { // 這裡檢查 payload 是否為空白字串，若是則回傳錯誤。
		return invalidArgument("Payload is required.")
	}
	if err := json.Unmarshal([]byte(payload), target); err != nil { // 這裡使用 json.Unmarshal 將 JSON payload 解析到 target 結構體中，若解析失敗則回傳錯誤。
		return invalidArgument("Payload is invalid JSON.")
	}
	return nil
}

// defaultString 在輸入為空白時套用預設值。
func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" { // 這裡檢查 value 是否為空白字串，若是則回傳 fallback。
		return fallback
	}
	return value
}

// mustJSON 將值序列化為 JSON；序列化失敗代表程式設計錯誤，因此直接 panic。
func mustJSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

// invalidArgument 建立 Nakama INVALID_ARGUMENT 錯誤。
func invalidArgument(message string) error {
	return runtime.NewError(message, grpcInvalidArgument)
}

// outOfRange 建立 Nakama OUT_OF_RANGE 錯誤。
func outOfRange(message string) error {
	return runtime.NewError(message, grpcOutOfRange)
} // 例如，當使用者輸入的參數超出允許範圍時，可以使用 outOfRange 來回傳錯誤訊息。

// notFound 建立 Nakama NOT_FOUND 錯誤。
func notFound(message string) error {
	return runtime.NewError(message, grpcNotFound)
}

// permissionDenied 建立 Nakama PERMISSION_DENIED 錯誤。
func permissionDenied(message string) error {
	return runtime.NewError(message, grpcPermissionDenied)
}

// resourceExhausted 建立資源耗盡錯誤，供頻率限制回傳可辨識的狀態碼。
func resourceExhausted(message string) error {
	return runtime.NewError(message, grpcResourceExhausted)
}

// failedPrecondition 建立 Nakama FAILED_PRECONDITION 錯誤。
func failedPrecondition(message string) error {
	return runtime.NewError(message, grpcFailedPrecondition)
}

// unauthenticated 建立 Nakama UNAUTHENTICATED 錯誤。
func unauthenticated(message string) error {
	return runtime.NewError(message, grpcUnauthenticated)
}
