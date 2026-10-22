# AIOVE Page Rebuild Deployment Checklist

Date: 2026-06-10

> Historical checklist. Keep this file as an early deployment reference only.
> Current server releases should follow `docs/deployment/server-runbook.md` and the release/symlink flow driven by `npm run package:deployment` and `npm run deploy:release`.

## Goal

Deploy the rebuilt AIOVE web app to a Linux server with MySQL, static uploads, email auth, chat replies, and ElevenLabs speech-to-text configured explicitly.

## Runtime Requirements

- Node.js 20.18.1 or newer.
- MySQL 8 compatible database.
- A process manager such as `systemd` or `pm2`.
- Nginx or another reverse proxy for public HTTPS traffic.

## Production Environment

Create a server-side `.env` or `.env.local` from this template. Do not reuse local development secrets.

```env
PORT=4173
HOST=127.0.0.1
PUBLIC_BASE_URL=https://your-domain.example
TTMALL_RUNTIME_MODE=production
AIOVE_PROVIDER_LOG_WRITE_ENABLED=true
TTMALL_ALLOW_LOCAL_PRODUCTION=false
TTMALL_ACCOUNT_BINDING_SECRET_KEY=replace_with_dedicated_ttmall_binding_secret

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=aiove_app
DB_PASSWORD=replace_with_strong_production_password
DB_NAME=aiove_app

EMAIL_AUTH_DEV_MODE=false
EMAIL_PROVIDER=
EMAIL_FROM=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_SECURE=false
SMTP_PROXY=

AUTH_COOKIE_NAME=aiove_auth_token
AIOVE_SUPER_ADMIN_EMAILS=admin@your-domain.example
COOKIE_SECURE=true
FORCE_HTTPS=true
HSTS_ENABLED=true
HSTS_MAX_AGE_SECONDS=31536000
CSP_REPORT_ONLY_ENABLED=true
TRUST_PROXY=true
TRUSTED_PROXY_IPS=127.0.0.1,::1,::ffff:127.0.0.1
GUEST_NETWORK_PEPPER=replace_with_dedicated_guest_network_secret
# Compatibility fallback only; do not use it instead of dedicated production keys.
APP_SECRET=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://your-domain.example/api/auth/google/callback

AI_REPLY_PROVIDER=openai
VENICE_API_KEY=replace_with_venice_key
VENICE_BASE_URL=https://api.venice.ai/api/v1
VENICE_MODEL=gemma-4-uncensored
VENICE_API_MODE=chat_completions
VENICE_TIMEOUT_MS=20000
VENICE_INCLUDE_DEFAULT_SYSTEM_PROMPT=false
TYPESAFE_API_KEY=replace_with_typesafe_key
TYPESAFE_BASE_URL=https://api.typesafe.ai/v1
TYPESAFE_MODEL=jev-latest
TYPESAFE_TIMEOUT_MS=4500
OPENAI_BASE_URL=https://clclapi.com/v1
OPENAI_MODEL=gpt-5.6-luna
OPENAI_API_MODE=chat_completions
OPENAI_API_KEY=replace_with_clcl_key
OPENAI_REASONING_EFFORT=minimal
OPENAI_TIMEOUT_MS=30000
# Chat-only budgets; classifier and knowledge-task defaults remain separate.
CHAT_REPLY_GENERATION_TIMEOUT_MS=60000
CHAT_REPLY_REVIEW_TIMEOUT_MS=60000
CHAT_REPLY_LANGUAGE_REVIEW_TIMEOUT_MS=60000
# Optional secondary chat model: when set, retryable replies use 5 primary attempts then 5 fallback attempts.
# It always shares OPENAI_BASE_URL, API mode, reasoning effort and timeout with the primary model.
# Optional overrides inherit the primary endpoint/mode/timeout when empty.
OPENAI_FALLBACK_BASE_URL=
OPENAI_FALLBACK_API_MODE=
OPENAI_FALLBACK_TIMEOUT_MS=
# Set true only for a fallback Chat Completions channel requiring SSE.
OPENAI_FALLBACK_STREAM=false
OPENAI_FALLBACK_MODEL=
OPENAI_FALLBACK_API_KEY=

# Leave empty to reuse the chat AI settings.
KNOWLEDGE_AI_PROVIDER=
KNOWLEDGE_AI_BASE_URL=
KNOWLEDGE_AI_MODEL=
KNOWLEDGE_AI_API_KEY=
KNOWLEDGE_AI_API_MODE=
KNOWLEDGE_AI_TIMEOUT_MS=

IMAGE_GENERATION_PROVIDER=openai
IMAGE_GENERATION_BASE_URL=https://clclapi.com/v1
IMAGE_GENERATION_MODEL=gpt-image-2
IMAGE_GENERATION_EDIT_MODEL=
IMAGE_GENERATION_API_KEY=replace_with_image_generation_key
IMAGE_GENERATION_SIZE=1024x1792
IMAGE_GENERATION_COUNT=1
IMAGE_GENERATION_TIMEOUT_MS=180000
AVATAR_MODERATION_TIMEOUT_MS=12000

ELEVENLABS_API_KEY=replace_with_elevenlabs_key
ELEVENLABS_BASE_URL=https://api.elevenlabs.io/v1
ELEVENLABS_QUALITY_MODEL=eleven_v3
ELEVENLABS_FAST_MODEL=eleven_flash_v2_5
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
ELEVENLABS_TIMEOUT_MS=8000
ELEVENLABS_TTS_MAX_RETRIES=2
ELEVENLABS_STT_API_KEY=replace_with_elevenlabs_key
ELEVENLABS_STT_BASE_URL=https://api.elevenlabs.io/v1
ELEVENLABS_STT_MODEL=scribe_v2
ELEVENLABS_STT_REALTIME_MODEL=scribe_v2_realtime
ELEVENLABS_STT_TIMEOUT_MS=20000

GEO_SEARCH_PROVIDER=nominatim
GEO_SEARCH_BASE_URL=https://nominatim.openstreetmap.org
GEO_SEARCH_TIMEOUT_MS=12000
GEO_SEARCH_USER_AGENT="AIOVE Admin Geo Search"
GEO_IP_PROVIDERS=cloudflare,ip-api,ipwhois,ipapi
GEO_IP_PROVIDER=ipapi
GEO_IP_BASE_URL=https://ipapi.co
GEO_IP_IPWHOIS_BASE_URL=https://ipwho.is
GEO_IP_IP_API_BASE_URL=http://ip-api.com
GEO_IP_TIMEOUT_MS=3000

PRODUCT_API_TIMEOUT_MS=3000
TTMALL_PRODUCT_API_TIMEOUT_MS=12000
TTMALL_PRODUCT_DETAIL_TIMEOUT_MS=5000
# Fill only after the site token re-encryption migration is complete for this environment.
PRODUCT_API_SECRET_KEY=
SHOPIFY_ADMIN_API_VERSION=2026-04
SHOPIFY_ADMIN_ACCESS_TOKEN=

MEMORY_RUNNER_ENABLED=true
MEMORY_RUNNER_POLL_MS=5000
MEMORY_RUNNER_BATCH_SIZE=2
PROACTIVE_MESSAGE_SCHEDULER_ENABLED=true
PROACTIVE_MESSAGE_SCHEDULER_POLL_MS=60000
PROACTIVE_MESSAGE_SCHEDULER_BATCH_SIZE=20

# Leave empty when the server can reach clclapi.com directly.
# Only set this if the Linux server has its own working outbound proxy.
HTTPS_PROXY=
HTTP_PROXY=
ALL_PROXY=
```

## Database Setup

1. Create database and user using `database/create-database.sql`, or run equivalent SQL manually with a strong production password.
   Replace `replace_with_strong_production_password` before executing the SQL, and do not commit or package the filled password back into the repository.
2. Import schema:

```bash
mysql -u aiove_app -p aiove_app < database/schema.sql
```

3. If restoring a prepared dump is desired instead:

```bash
gunzip -c database/aiove_app.sql.gz | mysql -u aiove_app -p aiove_app
```

Use either schema import or dump restore intentionally. Do not blindly run both on a production database without checking whether duplicate seed data is acceptable.

## Create Deployment Archive

For the server-side execution order, follow `docs/deployment/server-runbook.md`.

Prefer creating a clean archive instead of uploading the whole working directory.

```bash
npm run package:deployment
```

The archive is written to `dist/alove-page-rebuild-deploy.tar.gz`. It is built from a whitelist and excludes `.env`, `.env.local`, `node_modules`, old database dumps, real uploaded files, `.git`, and other local-only artifacts. The script runs `npm run check:deployment` before packaging and verifies the archive contents after packaging.
A SHA-256 checksum file is written next to it at `dist/alove-page-rebuild-deploy.tar.gz.sha256`.

Copy and extract that archive on the server, then create the server-side `.env` manually from the deployment template.
After uploading both files, verify the archive before extracting it:

```bash
sha256sum -c alove-page-rebuild-deploy.tar.gz.sha256
```

On macOS, use `shasum -a 256 -c alove-page-rebuild-deploy.tar.gz.sha256` instead.

## Install And Start

```bash
npm ci --omit=dev
npm start
```

For production, run through `systemd` or `pm2`; do not leave the app attached to an interactive SSH session.
A systemd example is provided at `docs/deployment/alove-page-rebuild.service.example`; copy it to `/etc/systemd/system/alove-page-rebuild.service` and adjust `WorkingDirectory`, `EnvironmentFile`, `User`, and `Group` for the server.

Example `pm2` command:

```bash
pm2 start server/server.js --name aiove-page-rebuild
pm2 save
```

## Upload Directories

The app stores uploaded files under:

- `uploads/avatars`
- `uploads/carousel`
- `uploads/chat`
- `uploads/voice`

Make sure the Node process user can create and write these directories.

```bash
mkdir -p uploads/avatars uploads/carousel uploads/chat uploads/voice
chown -R appuser:appuser uploads
```

## Reverse Proxy

An Nginx example is provided at `docs/deployment/nginx-alove-page-rebuild.conf.example`; copy it to the server Nginx sites directory and replace `your-domain.example` and certificate paths.

Nginx should proxy public traffic to the Node process, for example:

```nginx
server {
  listen 443 ssl http2;
  server_name your-domain.example;

  client_max_body_size 30m;

  location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Preflight Checks On Server

Run these on the Linux server before declaring deployment complete.

```bash
node --version
npm ci --omit=dev
node --check server/*.js
node scripts/server-shutdown-self-check.mjs
ALLOW_MUTATING_SELF_CHECKS=true npm run check:deployment
curl -I http://127.0.0.1:4173/
curl -s http://127.0.0.1:4173/api/health
curl -s http://127.0.0.1:4173/api/site/resolve
curl -I http://127.0.0.1:4173/gogoalshop/login
curl -I http://127.0.0.1:4173/footballkituk/discover
```

Check clcl connectivity:

```bash
curl -v https://clclapi.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

If direct connectivity fails, configure a server-side proxy and set `HTTPS_PROXY` to that server-side proxy. Do not use the Mac local proxy address on Linux.

Check multi-site routing and IP forwarding:

Brave factual search configuration (keep the real key only in the server shared env file):

```env
BRAVE_SEARCH_API_KEY=
BRAVE_SEARCH_BASE_URL=https://api.search.brave.com/res/v1
BRAVE_SEARCH_TIMEOUT_MS=8000
BRAVE_SEARCH_MIN_INTERVAL_MS=1100
BRAVE_SEARCH_MAX_RESULTS=5
BRAVE_SEARCH_MAX_TOKENS=6000
```

- `ALLOW_MUTATING_SELF_CHECKS=true npm run check:deployment` runs the full deployment gate on the server. Set the opt-in only after the release database backup is verified; without it, mutating checks refuse the production loopback database.
- `node scripts/server-shutdown-self-check.mjs` verifies SIGTERM graceful shutdown; run it after service-management changes or before first Linux deployment.
- The deployment gate checks the current Node.js version against `package.json` `engines.node` before running other checks.
- The deployment gate checks `database/create-database.sql` and `database/schema.sql` for the database placeholder password, required core tables, default multi-site seeds, and key relational constraints.
- The deployment gate checks `package-lock.json` root dependencies and Node engine stay aligned with `package.json`.
- The deployment gate checks upload directory creation and write permission before running route checks.
- The deployment gate warns if ignored local artifacts such as `database/*.sql.gz` exist; set `STRICT_DEPLOYMENT_FILES=true` before packaging/uploading to make those artifacts fail the gate.
- By default, missing `旧媒体工具` / `旧媒体工具` only warns because the app can fall back to original audio; set `` on Linux to make missing media tools fail the gate.
- The deployment gate scans tracked source, docs, and logs for common secret leaks such as `sk-...`, `GOCSPX-...`, Gmail app-password patterns, and filled secret env assignments. Keep real secrets in `.env` / `.env.local` on the server only.
- `npm run preflight:multisite` checks code, data, and routing rules.
- `npm run smoke:multisite` checks the running local HTTP service on the server; run it after the Node process is listening on `PORT`.
- The HTTP smoke includes `/api/health`, a lightweight process/routing health check that does not depend on the database or external providers.
- Local smoke also verifies that a temporary file under `uploads/chat` can be served through `/uploads/chat/...`, then removes the file.
- Run `preflight:multisite` and `smoke:multisite` separately only when `check:deployment` fails and you need to isolate the failing layer.
- `SMOKE_BASE_URL=https://your-domain.example npm run smoke:multisite` checks the public domain through the reverse proxy after DNS/HTTPS are ready.
- The reverse proxy must pass `X-Forwarded-For`; otherwise IP-based site routing will see the proxy IP instead of the visitor IP.
- If the domain is behind Cloudflare with IP Geolocation enabled, `CF-IPCountry` is used first and avoids external geo API calls.
- `GEO_IP_PROVIDERS` is an ordered list. Recommended production value: `cloudflare,ip-api,ipwhois,ipapi`; if one API is rate limited, the next provider is tried before falling back to the default site.
- `/api/site/resolve` should return the default site for private/local IPs.
- Public IP routing should be tested with a known region after DNS/proxy are in place.

```bash
SMOKE_BASE_URL=https://your-domain.example npm run smoke:multisite
curl -s https://your-domain.example/api/health
curl -s https://your-domain.example/api/site/resolve
curl -I https://your-domain.example/gogoalshop/login
curl -I https://your-domain.example/footballkituk/discover
```

Run a strict production environment gate before switching real traffic to the new service:

```bash
ALLOW_MUTATING_SELF_CHECKS=true STRICT_DEPLOYMENT_FILES=true STRICT_PRODUCTION_ENV=true npm run check:deployment
```

The strict production environment gate rejects common server mistakes such as local `PUBLIC_BASE_URL`, placeholder database/email/API passwords, email verification dev mode, missing AI/image/ElevenLabs STT keys, invalid image size, Google callback URLs that do not match `PUBLIC_BASE_URL`, and local external-service URLs.
The strict deployment files gate rejects ignored local artifacts that should not be uploaded, such as old database dumps under `database/*.sql.gz`.

Run a strict npm install dry-run when checking the final server package state:

```bash
ALLOW_MUTATING_SELF_CHECKS=true STRICT_NPM_CI=true npm run check:deployment
```

## Functional Smoke Tests

After start, verify:

- Email registration and login.
- Character list loads.
- Normal text chat:
  - user message appears immediately;
  - typing dots appear;
  - AI reply appears after delay.
- Multiple text messages inside 1.5 seconds are merged into one reply cycle.
- Voice message:
  - recording can stop;
  - ASR returns text;
  - user bubble shows text;
  - AI reply appears.
- Avatar upload and attachment upload write to `uploads/`.

## Known Deployment Risks

- Local development currently needs `HTTPS_PROXY=http://127.0.0.1:7897` to reach `clclapi.com`; Linux may not need this.
- If Linux cannot reach `clclapi.com:443`, AI replies will fail until a valid server-side proxy is configured.
- If `旧媒体工具` / `旧媒体工具` are missing, ASR may still attempt original browser audio format, but compatibility is weaker.
- SMTP is still placeholder unless production email credentials are configured.
