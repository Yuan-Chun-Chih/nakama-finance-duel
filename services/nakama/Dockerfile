# 第一階段：使用 Heroic Labs 官方 plugin builder 編譯 Go runtime plugin。
# 這個 image 內建可與 Nakama 3.38.0 ABI 相容的 Go toolchain。
FROM registry.heroiclabs.com/heroiclabs/nakama-pluginbuilder:3.38.0 AS builder

# Go runtime plugin 需要 Go module 模式與 CGO，因為最後會編譯成 .so plugin。
ENV GO111MODULE=on
ENV CGO_ENABLED=1

WORKDIR /backend

# 只複製 Go module 與 runtime.go，讓 Docker cache 盡量穩定。
# runtime.go 是目前正式 authoritative backend。
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./

# go mod tidy 會補齊 go.sum / 依賴解析；build 產出 Nakama 可載入的 backend.so。
RUN go build --trimpath --buildmode=plugin -o ./backend.so

# 第二階段：使用正式 Nakama server image，只放入編譯好的 plugin 與 local.yml。
FROM registry.heroiclabs.com/heroiclabs/nakama:3.38.0

# Nakama 啟動時會掃描 /nakama/data/modules 下的 Go plugin。
COPY --from=builder /backend/backend.so /nakama/data/modules/

# 本地開發設定，包含 console、socket、runtime path 等。
COPY local.yml /nakama/data/local.yml
