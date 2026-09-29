# runtime_rpc_helpers.go 逐行 Code Review

## 1. `requireUserID`
```go
// L1
userID := contextString(ctx, runtime.RUNTIME_CTX_USER_ID)
// L2
if userID == "" { return "", unauthenticated("Unauthenticated user.") }
// L3
return userID, nil
```
- `L1`：從 Nakama authenticated context 取得 user ID。
- `L2`：缺 ID 時建立 gRPC `UNAUTHENTICATED` 錯誤。
- `L3`：只回傳後端 context 的身分，不讀 client payload。

## 2. `contextString`
```go
// L1
value, _ := ctx.Value(key).(string)
// L2
return value
```
- `L1`：從 context 取值並安全轉成字串；型別不符時得到空字串。
- `L2`：回傳該字串。

## 3. `parsePayload`
```go
// L1
if strings.TrimSpace(payload) == "" { return invalidArgument("Payload is required.") }
// L2
if err := json.Unmarshal([]byte(payload), target); err != nil { return invalidArgument("Payload is invalid JSON.") }
// L3
return nil
```
- `L1`：空 payload 直接回傳 `INVALID_ARGUMENT`。
- `L2`：將 JSON 解碼至泛型 target；格式錯誤不洩漏底層細節。
- `L3`：解析成功。

## 4. `defaultString`
```go
// L1
if strings.TrimSpace(value) == "" { return fallback }
// L2
return value
```
- `L1`：空白值改用 fallback。
- `L2`：非空白值原樣回傳。

## 5. `mustJSON`
```go
// L1
encoded, err := json.Marshal(value)
// L2
if err != nil { panic(err) }
// L3
return string(encoded)
```
- `L1`：將 server 已建立的值轉 JSON。
- `L2`：程式內部不應失敗的序列化失敗視為 programmer error，直接 panic。
- `L3`：回傳 JSON 字串。

## 6. gRPC error helpers
```go
// L1
return runtime.NewError(message, grpcInvalidArgument)
// L2
return runtime.NewError(message, grpcOutOfRange)
// L3
return runtime.NewError(message, grpcNotFound)
// L4
return runtime.NewError(message, grpcPermissionDenied)
// L5
return runtime.NewError(message, grpcFailedPrecondition)
// L6
return runtime.NewError(message, grpcUnauthenticated)
```
- `L1`：輸入格式或值不合法。
- `L2`：數值超過容許範圍。
- `L3`：請求資源不存在。
- `L4`：登入者沒有權限。
- `L5`：目前狀態不允許操作。
- `L6`：沒有可驗證的登入身分。
