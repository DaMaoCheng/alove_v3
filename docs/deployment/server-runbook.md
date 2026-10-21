# Server Deployment Runbook

This project uses a release directory deployment model:

```txt
/srv/alove-new/
  current -> /srv/alove-new/releases/<release-id-timestamp>
  releases/
  shared/uploads/
  backups/
```

Every deploy publishes one complete code snapshot. The database, `.env.local`, and real uploads are preserved outside the release and are not copied from the local machine.

The current hardened target shape assumes:

- SSH deploy user: `alove`
- app root ownership: `alove:alove`
- service restart via `sudo systemctl ...`
- server env file stored once at `/srv/alove-new/shared/.env.local`

## 1. Create Local Package

Create a fresh deployment archive and checksum:

```bash
npm run package:deployment
```

Expected local outputs:

```txt
dist/alove-page-rebuild-deploy.tar.gz
dist/alove-page-rebuild-deploy.tar.gz.sha256
dist/alove-page-rebuild-deploy.version.json
```

## 2. Dry-Run Release Plan

Run the release deploy script without `--execute` first:

```bash
npm run deploy:release
```

Expected behavior:

```txt
mode: dry-run
No server changes were made.
```

The dry-run validates the local archive, checksum, and version metadata. It does not SSH to the server and does not change files.

## 3. Execute Release Deployment

After checking the dry-run plan, execute:

```bash
npm run deploy:release -- --execute
```

If a local VPN owns the default route and interrupts the SSH handshake, bind SSH/SCP to the current LAN address without changing server configuration:

```bash
DEPLOY_SSH_BIND_ADDRESS=<current-lan-ip> npm run deploy:release -- --execute
```

The script will:

- upload `alove-page-rebuild-deploy.tar.gz`, `alove-page-rebuild-deploy.tar.gz.sha256`, and `alove-page-rebuild-deploy.version.json` to `/tmp`;
- verify the checksum on the server with `sha256sum -c alove-page-rebuild-deploy.tar.gz.sha256`;
- extract the package into `/srv/alove-new/releases/<release-id-timestamp>`;
- ensure the canonical server `.env.local` exists at `/srv/alove-new/shared/.env.local`;
- create `/srv/alove-new/backups/db-before-<release>.sql.gz` with `mysqldump` or `mariadb-dump` before switching releases;
- link release-local `.env.local` to `/srv/alove-new/shared/.env.local` instead of copying secrets into each release;
- replace release-local `uploads` with a symlink to `/srv/alove-new/shared/uploads`;
- run `npm ci --omit=dev` inside the new release;
- back up the previous `/srv/alove-new/current` to `/srv/alove-new/backups`;
- switch `/srv/alove-new/current` to the new release using `ln -sfn`;
- restart `alove-new.service` through `sudo systemctl restart alove-new.service`;
- verify `sudo systemctl is-active alove-new.service`;
- verify `curl -fsS http://127.0.0.1:4173/api/health`;
- verify `curl -fsS https://alove.fans/api/health`;
- run `SMOKE_BASE_URL=http://127.0.0.1:4173 node scripts/multisite-http-smoke.mjs`;
- run `SMOKE_BASE_URL=https://alove.fans npm run smoke:multisite`.

## 4. First Conversion From Directory Current

If `/srv/alove-new/current` is still a real directory, the script treats it as a legacy current directory:

```txt
/srv/alove-new/current
```

During the first release deployment, it will:

- create a backup archive under `/srv/alove-new/backups`;
- move the old directory to `/srv/alove-new/releases/legacy-current-before-<release>`;
- create `/srv/alove-new/current` as a symlink to the new release.

This conversion is a one-time deployment structure change. It does not change the database, old project, domain, port, service name, or uploads.

## 5. Rollback

Find the previous release:

```bash
ls -lt /srv/alove-new/releases
```

Switch `current` back and restart:

```bash
ln -sfn /srv/alove-new/releases/<previous-release> /srv/alove-new/current
sudo systemctl restart alove-new.service
sudo systemctl is-active alove-new.service
curl -fsS http://127.0.0.1:4173/api/health
curl -fsS https://alove.fans/api/health
```

If the previous state was the legacy real directory, use the `legacy-current-before-<release>` directory as the rollback target.

### Compatibility rollback targets

When a new release stores private metadata that the previous source does not hide, prepare and verify an old-business-code compatibility release containing only the required projection protection. Keep the original release and backups. Do not restore the entire database to remove metadata written after publication.

For that deployment only, set `DEPLOY_ROLLBACK_TARGET` to the verified absolute directory inside `/srv/alove-new/releases`. The preview shows the target; the remote script resolves it, rejects paths or symlinks outside the releases directory, and refuses to switch when the target is missing. Failed post-switch checks then restore that target. Without this option the original previous-release rollback is unchanged. Compatibility-target deployments reject pruning; retain any old dependency directory used by that target. Validation occurs before any legacy-current directory is moved.

## 6. Optional Release Cleanup

By default the deployment script does not delete old releases.

To clean up old releases after a successful healthy switch:

```bash
DEPLOY_PRUNE_RELEASES=true DEPLOY_KEEP_RELEASES=5 npm run deploy:release -- --execute
```

Keep at least two releases. Do not delete the latest healthy previous release until the new release has been tested.

## 7. Server Environment Rules

Never place real secrets in source files or deployment archives.

Required server-side values stay in `/srv/alove-new/shared/.env.local`, including:

- database credentials;
- SMTP credentials;
- Google OAuth credentials;
- AI, image generation, ASR, and ElevenLabs keys;
- production base URL.

The deploy archive must not contain `.env`, `.env.local`, `.env.*.local`, real uploads, database dumps, `dist`, `.git`, or `node_modules`.

## 8. Nginx And IP Routing

Nginx must preserve the user IP headers used by site routing:

```txt
X-Forwarded-For
X-Real-IP
CF-IPCountry
```

After deployment, verify:

```bash
curl -s http://127.0.0.1:4173/api/site/resolve
SMOKE_BASE_URL=http://127.0.0.1:4173 node scripts/multisite-http-smoke.mjs
SMOKE_BASE_URL=https://alove.fans npm run smoke:multisite
```

## 9. Verification

Local verification:

```bash
npm run check:deployment
npm run package:deployment
npm run deploy:release
```

Server verification after execute:

```bash
sudo systemctl status alove-new.service --no-pager
curl -fsS http://127.0.0.1:4173/api/health
curl -fsS https://alove.fans/api/health
SMOKE_BASE_URL=http://127.0.0.1:4173 node scripts/multisite-http-smoke.mjs
SMOKE_BASE_URL=https://alove.fans npm run smoke:multisite
readlink -f /srv/alove-new/current
ls -l /srv/alove-new/current/.env.local /srv/alove-new/shared/.env.local
ls -lh /srv/alove-new/backups/db-before-<release>.sql.gz
ls -ld /srv/alove-new/current/uploads /srv/alove-new/shared/uploads
```


## 10. GitHub Synchronization

The user specified on 2026-10-10 that subsequent verified updates must also be merged into `main`, rather than stopping at a working-branch push. This applies when GitHub synchronization is within the requested scope; read-only reviews and local-only changes do not authorize a deployment or push by themselves.

After the required checks and, when requested, server deployment and verification:

- fetch the current remote references and confirm the source and target branches;
- push the verified working branch and merge the verified update into `main`;
- prefer a normal fast-forward when `main` is an ancestor; preserve commits and the working branch;
- review actual differences if branches diverge; do not force-push or discard concurrent changes;
- verify the remote `main` reference contains the verified source commit and record the result.

This GitHub operation does not replace or change the release/symlink deployment. Keep the actual deployed source commit and archive checksum in its release metadata. Server rollback uses the retained prior release and backups described above, including compatibility limits in the corresponding release notes. Git source reversions use new revert commits, preserving shared history.

For the 2026-10-10 synchronization, `main` was fast-forwarded from `3cfbb088e52120c919cee331529480803b96a79a` to `d8cde9d6ed42be855c8d8ff7aa164ee0928ac165`, retaining all 178 intervening commits. This operation did not switch or restart the server release.
