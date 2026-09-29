# Nakama Duel Quick Start

## Repository layout

```text
nakama-duel/
  apps/web/          # Next.js frontend and smoke-test scripts
  services/nakama/   # Go authoritative runtime and Docker Compose
```

## Start local services

```powershell
cd services\nakama
docker compose up --build
```

Nakama API: `http://127.0.0.1:7350`
Nakama Console: `http://127.0.0.1:7351`

## Install frontend dependencies

```powershell
npm run install:web
```

## Start the frontend

From the repository root:

```powershell
cmd /c npm run dev
```

The root scripts delegate to `apps/web`, so existing commands remain valid.

## Validation

```powershell
cmd /c npm run lint
cmd /c npx tsc -p apps\web\tsconfig.json --noEmit

cd services\nakama
go test ./...
docker compose config --quiet
```

## Git workflow

The root Git repository remains connected to GitLab:

```powershell
git remote -v
git status
git add -A
git commit -m "Split web and Nakama services"
git push origin main
```

Do not run Git commands from `apps/web` or `services/nakama`; use the repository root.
