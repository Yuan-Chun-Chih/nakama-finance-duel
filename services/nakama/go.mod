// Go module for the Nakama runtime plugin.
// Dockerfile 會用 nakama-pluginbuilder image 編譯這個 module 成 backend.so。
module nakama-finance-runtime

// Go version 需和 pluginbuilder image 內的 toolchain 相容。
go 1.26.1

// Nakama runtime plugin 使用的官方 common API 型別與 runtime interface。
require github.com/heroiclabs/nakama-common v1.45.0

require google.golang.org/protobuf v1.36.11 // indirect
