# Deployment

## Recommended layout

- `VPS 1` (`web`) - only the static frontend from `web/`
- `VPS 2` (`api`) - `api-gateway`, `auth-service`, `verification-service`, `test-lab-service`, `live-chat-service`, `duel-service`, `ml-service`

This layout fits the current codebase:

- frontend already reads `VITE_API_BASE_URL`
- gateway already proxies to internal microservices
- backend services already use environment variables for upstream URLs

## First production deploy

### API VPS

```bash
cd deploy/api
cp .env.example .env
docker compose up -d --build
```

### Web VPS

```bash
cd deploy/web
cp .env.example .env
docker compose up -d --build
```

## Domains

Recommended DNS split:

- `your-domain.com` -> web VPS
- `api.your-domain.com` -> api VPS

Put a reverse proxy with TLS in front of each VPS if needed. If you already use Cloudflare, expose only `80/443`.

## Convenient update flow

The simplest stable flow is:

1. Push changes to your repo.
2. CI builds images for `web` and backend services.
3. CI connects to the target VPS over SSH and runs:

```bash
docker compose pull
docker compose up -d
```

If you do not want a registry yet, use the same compose files and run:

```bash
docker compose up -d --build
```

directly on each VPS after `git pull`.

The compose files support both modes:

- `build:` for direct build on the VPS
- `image:` for registry-based deploys

## GitHub Actions auto deploy

The repo now includes [deploy workflow](</Users/kvsociety/omoggle/.github/workflows/deploy.yml:1>).

Flow:

1. Push to `main`
2. GitHub Actions builds and pushes images to `ghcr.io`
3. Workflow copies compose files to each VPS
4. Workflow writes fresh `.env` on each VPS
5. Workflow runs `docker compose pull && docker compose up -d`

### Required GitHub Secrets

- `API_SSH_HOST`
- `API_SSH_USER`
- `API_SSH_KEY`
- `API_SSH_PORT` if not `22`
- `WEB_SSH_HOST`
- `WEB_SSH_USER`
- `WEB_SSH_KEY`
- `WEB_SSH_PORT` if not `22`
- `GHCR_USERNAME`
- `GHCR_TOKEN`
- `PROD_API_CORS_ALLOWED_ORIGINS`
- `PROD_AUTH_ACCESS_TOKEN_SECRET`
- `PROD_AUTH_REFRESH_TOKEN_SECRET`
- `PROD_VERIFICATION_INTERNAL_SECRET`

### Required GitHub Variables

- `PROD_API_BASE_URL`
- `PROD_API_PUBLIC_PORT` optional, default `8080`
- `PROD_WEB_PUBLIC_PORT` optional, default `80`

### VPS prerequisites

- Docker Engine installed
- Docker Compose plugin installed
- the SSH user can run `docker compose` and `docker login`
- if you keep GHCR packages private, `GHCR_TOKEN` must have package read access

### Default remote paths

- API stack: `/opt/chadchat/api`
- Web stack: `/opt/chadchat/web`

If you want different paths, edit the workflow env block.

## Splitting microservices across different VPS later

You do not need to redesign the app. Move one service at a time and override only the needed URLs in `deploy/api/.env`.

Examples:

- `ML_SERVICE_URL=http://10.0.0.12:8090`
- `AUTH_SERVICE_URL=http://10.0.0.11:8081`
- `LIVE_CHAT_SERVICE_URL=http://10.0.0.13:8084`

The gateway and services already support this through env variables.

## Production notes

- Set `CORS_ALLOWED_ORIGINS` to your real frontend domain.
- Set persistent `AUTH_ACCESS_TOKEN_SECRET` and `AUTH_REFRESH_TOKEN_SECRET`, otherwise every auth-service restart invalidates user tokens.
- Set persistent `VERIFICATION_INTERNAL_SECRET`, otherwise internal verification consume flow is not safe for production.
- Keep private service ports closed if the service stays behind the gateway.
- Current backend state is in memory. After restart, users, chats, queues, rooms, and matches are lost.
- The next production step after this deployment baseline is Postgres plus Redis.
