# Nakama Server Workspace

This folder contains a local Nakama server setup for the finance-game phase 1 stack.

## Included

- `docker-compose.yml`: Postgres + Nakama services.
- `Dockerfile`: builds the Go runtime plugin and bakes it into the Nakama image.
- `local.yml`: local development configuration.
- `runtime.go`: authoritative leaderboard and guild RPCs.

## Runtime IDs

- Leaderboards:
  - `portfolio_return_global`
  - `portfolio_return_weekly`
  - `guild_average_return_weekly`
- RPCs:
  - `get_phase_config`
  - `submit_portfolio_score`
  - `create_guild`
  - `invite_guild_member`
  - `promote_guild_admin`
  - `demote_guild_admin`
  - `transfer_guild_owner`
  - `request_guild_join`
  - `approve_guild_join`
  - `reject_guild_join`
  - `leave_guild`
  - `kick_guild_member`
  - `list_guild_join_requests`
  - `get_guild_detail`

## Start

1. Configure your frontend `.env.local` from the root `.env.example`.
2. From this `nakama/` directory run:

```bash
docker compose up --build
```

If you are switching from the previous JavaScript runtime image, rebuild from a clean state:

```bash
docker compose down
docker compose build --no-cache
docker compose up
```

3. Open the Nakama console at `http://127.0.0.1:7351`.
   Credentials:
   - username: `admin`
   - password: `admin123`

## Notes

- This setup uses authoritative leaderboards, so score submission should go through `submit_portfolio_score`.
- Guild ranking is the weekly average of member returns. The guild leaderboard owner ID is the guild group ID.
- The current Go runtime plugin creates leaderboards on startup if they do not already exist.
- The config values are for local development only and should be rotated before any shared environment.
