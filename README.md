# Nakama Duel

Authoritative BTC trading duel built with Next.js, Nakama and PostgreSQL.

## Structure

- `apps/web`: Next.js UI, Nakama client and frontend smoke tests.
- `services/nakama`: Go authoritative match runtime, Dockerfile and Compose services.
- Root: Git repository, architecture notes and command proxies.

## Run locally

```powershell
cd services\nakama
docker compose up --build
```

In another terminal at the repository root:

```powershell
cmd /c npm run dev
```

See [QUICKSTART.md](QUICKSTART.md) for validation and Git commands.
