# Nakama 正式部署邊界

`docker-compose.yml` 與 `local.yml` 僅供本機開發，包含可預期的 development keys，也會映射 PostgreSQL、gRPC 與 Console port，禁止直接部署到公開主機。

## 正式設定

1. 將 `.env.production.example` 複製到不納入 Git 的 secret store，為每個 placeholder 產生獨立隨機值。
2. 使用 `docker-compose.production.yml`。這份設定只把 Nakama HTTP/WebSocket 綁定到主機 `127.0.0.1:7350`，PostgreSQL、gRPC 與 Console 不對外映射。
3. 在 Nakama 前方配置 TLS reverse proxy，只公開 `443`，並限制 request body、連線數、每 IP 登入與 RPC 頻率。
4. Console 只能透過 VPN、Zero Trust gateway 或管理網路存取，不可直接公開。
5. 正式環境固定關閉 `MATCH_PRICE_ALLOW_BOOTSTRAP`、`ALLOW_CLIENT_PORTFOLIO_SCORE_SUBMISSION` 與 `ALLOW_DIRECT_FINANCE_MATCH_CREATION`。
6. `MATCH_PRICE_REQUIRE_SIGNATURE=true` 必須保持啟用；price-feed 會使用 ingestion secret 產生 HMAC，secret 不會放入 RPC payload。

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml config
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

## 資料與營運

- PostgreSQL 必須定期備份並啟用 point-in-time recovery，且需實際演練還原。
- 正式資料庫帳號只擁有 Nakama schema 所需權限，不使用 PostgreSQL superuser 執行服務。
- 多節點部署時，migration 應改為獨立的一次性 job，再啟動 Nakama replicas。
- 監控 Nakama RPC latency/error、WebSocket connections、配對等待時間、stale market、拒單原因、Storage CAS 衝突與 price-feed heartbeat。
- `finance_events`、orders、fills、portfolio snapshots 與 guild audit 必須依稽核需求制定封存及刪除期限。
- 發布前執行重複訂單、同帳號多連線、行情中斷、資料庫短暫失聯、Nakama rolling restart 與高併發配對測試。

## 多層限流

Go runtime 內建的 RPC limiter 是單 Nakama 節點的最後一道保護，不取代 reverse proxy、API gateway 或 WAF 的全域 IP/account rate limit。多節點正式環境必須在入口層再實作共享限流。
