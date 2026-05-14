# Deployment

## Recommended layout

- `VPS 1` (`web`) - static frontend from `web/` and admin frontend from `admin-web/`
- `VPS 2` (`api`) - `api-gateway`, `auth-service`, `verification-service`, `test-lab-service`, `live-chat-service`, `duel-service`, `rating-service`, `customization-service`, `admin-service`, `ml-service`, `mysql`

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
- `PROD_RATING_INTERNAL_SECRET`
- `PROD_CUSTOMIZATION_INTERNAL_SECRET`
- `PROD_ADMIN_API_SECRET`
- `PROD_MYSQL_PASSWORD`
- `PROD_MYSQL_ROOT_PASSWORD`
- `PROD_WEBRTC_TURN_USERNAME`
- `PROD_WEBRTC_TURN_CREDENTIAL`
- `PROD_STORAGE_ACCESS_KEY`
- `PROD_STORAGE_SECRET_KEY`

### Required GitHub Variables

- `PROD_API_BASE_URL`
- `PROD_API_PUBLIC_PORT` optional, default `8080`
- `PROD_WEB_PUBLIC_PORT` optional, default `80`
- `PROD_ADMIN_WEB_PUBLIC_PORT` optional, default `8082`
- `PROD_DEFAULT_RESULT_SOUND_URL`
- `PROD_WEBRTC_STUN_URL` optional, default `stun:stun.l.google.com:19302`
- `PROD_WEBRTC_TURN_URLS`
- `PROD_STORAGE_BUCKET` optional, default `chadchat`
- `PROD_STORAGE_ENDPOINT` optional, default `https://ams1.vultrobjects.com`
- `PROD_STORAGE_REGION` optional, default `us-east-1`
- `PROD_STORAGE_PUBLIC_BASE_URL`
- `PROD_STORAGE_AVATAR_PREFIX` optional, default `avatars`

### VPS prerequisites

- Docker Engine installed
- Docker Compose plugin installed
- the SSH user can run `docker compose` and `docker login`
- if you keep GHCR packages private, `GHCR_TOKEN` must have package read access

### Default remote paths

- API stack: `/opt/chadchat/api`
- Web stack: `/opt/chadchat/web`

## Admin Web

`admin-web/` is deployed on the same web VPS as a separate container.

Recommended Caddy routing:

- `chadchat.fun` -> `127.0.0.1:8081`
- `admin.chadchat.fun` -> `127.0.0.1:8082`

The current `admin-web` talks to the public API base URL via `VITE_API_BASE_URL`.

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
- `mysql` is now part of the API stack baseline; app state for auth, verification, live chat, and test lab depends on `MYSQL_DSN`.
- `profile-service` avatar uploads depend on object storage settings; `STORAGE_PUBLIC_BASE_URL` must be publicly reachable, and the bucket should allow public reads for avatar objects.
- Configure bucket CORS so your frontend origins can upload directly to object storage.
- Keep private service ports closed if the service stays behind the gateway.
- `duel-service` queue/live match state, SSE subscribers, and rate limiting are still in memory.
- `duel-service` WebRTC relay config comes from `WEBRTC_STUN_URL`, `WEBRTC_TURN_URLS`, `WEBRTC_TURN_USERNAME`, and `WEBRTC_TURN_CREDENTIAL`.
- Public API health is available at `/health` on `api-gateway`; it aggregates health of auth, verification, test lab, live chat, duel, and ML services.

## MySQL rollout

1. Add GitHub secrets `PROD_MYSQL_PASSWORD` and `PROD_MYSQL_ROOT_PASSWORD`.
2. Deploy the API stack so `mysql` starts and app `.env` receives `MYSQL_DSN`.
3. Wait for `mysql` to become ready, then restart the API stack if needed.
4. Tables are created automatically by services at startup.

Default built-in DSN in this deploy:

```text
app:<password>@tcp(mysql:3306)/chadchat?parseTime=true&multiStatements=true&charset=utf8mb4
```

If you later move to managed MySQL, keep `MYSQL_DSN` semantics the same and update the deploy flow to write your external DSN instead of the local `mysql` host.
