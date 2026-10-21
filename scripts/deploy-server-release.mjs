import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const DEFAULT_ARCHIVE = "dist/alove-page-rebuild-deploy.tar.gz";
const DEFAULT_HOST = "47.76.136.38";
const DEFAULT_USER = "alove";
const DEFAULT_ROOT = "/srv/alove-new";
const DEFAULT_SERVICE = "alove-new.service";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:4173";
const DEFAULT_PUBLIC_BASE_URL = "https://alove.fans";
const DEFAULT_PUBLIC_HEALTH_URL = "https://alove.fans/api/health";

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const help = args.has("--help") || args.has("-h");

if (help) {
  printHelp();
  process.exit(0);
}

const archivePath = getArgValue("--archive") || process.env.DEPLOY_ARCHIVE || DEFAULT_ARCHIVE;
const checksumPath = getArgValue("--checksum") || process.env.DEPLOY_CHECKSUM || `${archivePath}.sha256`;
const versionPath = getArgValue("--version") || process.env.DEPLOY_VERSION || archivePath.replace(/\.tar\.gz$/, ".version.json");
const host = process.env.DEPLOY_HOST || DEFAULT_HOST;
const user = process.env.DEPLOY_USER || DEFAULT_USER;
const root = process.env.DEPLOY_ROOT || DEFAULT_ROOT;
const service = process.env.DEPLOY_SERVICE || DEFAULT_SERVICE;
const localBaseUrl = process.env.DEPLOY_LOCAL_BASE_URL || DEFAULT_LOCAL_BASE_URL;
const publicBaseUrl = process.env.DEPLOY_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL;
const publicHealthUrl = process.env.DEPLOY_PUBLIC_HEALTH_URL || DEFAULT_PUBLIC_HEALTH_URL;
const sshBindAddress = String(process.env.DEPLOY_SSH_BIND_ADDRESS || "").trim();
const rollbackTarget = String(process.env.DEPLOY_ROLLBACK_TARGET || "").trim();
assert.ok(!rollbackTarget || rollbackTarget.startsWith(`${root}/releases/`) && /^[A-Za-z0-9_./-]+$/.test(rollbackTarget)
  && !rollbackTarget.split("/").includes(".."), "compatibility rollback target must stay inside this project releases directory");
const useSudo = String(process.env.DEPLOY_USE_SUDO || "true").trim().toLowerCase() !== "false";
const prune = String(process.env.DEPLOY_PRUNE_RELEASES || "false").trim().toLowerCase() === "true";
assert.ok(!(rollbackTarget && prune), "compatibility rollback deployments must retain previous releases");
const keepReleases = Number.parseInt(process.env.DEPLOY_KEEP_RELEASES || "5", 10);

assert.ok(existsSync(archivePath), `deployment archive is missing: ${archivePath}`);
assert.ok(existsSync(checksumPath), `deployment checksum is missing: ${checksumPath}`);
assert.ok(existsSync(versionPath), `deployment version metadata is missing: ${versionPath}`);
assert.ok(Number.isInteger(keepReleases) && keepReleases >= 2, "DEPLOY_KEEP_RELEASES must be an integer >= 2");

const metadata = JSON.parse(readFileSync(versionPath, "utf8"));
const archiveSha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
const checksumLine = readFileSync(checksumPath, "utf8").trim();
const expectedChecksumLine = `${archiveSha256}  ${basename(archivePath)}`;
assert.equal(checksumLine, expectedChecksumLine, "local checksum file must match the local archive");
assert.equal(metadata.archiveSha256, archiveSha256, "version metadata archiveSha256 must match the local archive");

const releaseId = sanitizeReleaseId(metadata.releaseId || "manual-release");
const timestamp = buildTimestamp();
const releaseName = `${releaseId}-${timestamp}`;
const remoteTemp = `/tmp/alove-release-${releaseName}`;
const sshTarget = `${user}@${host}`;
const archiveName = basename(archivePath);
const checksumName = basename(checksumPath);
const versionName = basename(versionPath);
const sshConnectionArgs = sshBindAddress ? ["-o", `BindAddress=${sshBindAddress}`] : [];
const remoteScript = buildRemoteScript({
  rollbackTarget,
  archiveName,
  checksumName,
  versionName,
  releaseName,
  root,
  service,
  localBaseUrl,
  publicBaseUrl,
  publicHealthUrl,
  useSudo,
  prune,
  keepReleases,
  remoteTemp,
});

printPlan({
  archivePath,
  checksumPath,
  versionPath,
  archiveSha256,
  releaseName,
  sshTarget,
  sshBindAddress,
  rollbackTarget,
  root,
  service,
  useSudo,
  localBaseUrl,
  publicBaseUrl,
  execute,
  prune,
  keepReleases,
});

if (!execute) {
  console.log("\n[dry-run] No server changes were made. Add --execute to run this deployment.");
  process.exit(0);
}

await run("ssh", [...sshConnectionArgs, sshTarget, "mkdir", "-p", remoteTemp]);
await run("scp", [...sshConnectionArgs, archivePath, checksumPath, versionPath, `${sshTarget}:${remoteTemp}/`]);
await run("ssh", [...sshConnectionArgs, sshTarget, "bash", "-s"], { input: remoteScript });

console.log(`\nrelease deployment completed: ${releaseName}`);

function getArgValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function printHelp() {
  console.log(`Usage:
  node scripts/deploy-server-release.mjs [--execute] [--archive=dist/alove-page-rebuild-deploy.tar.gz]

Default mode is dry-run. It validates the local archive/checksum/version metadata and prints the
server release plan without touching the server.

Environment:
  DEPLOY_HOST                 SSH host, default ${DEFAULT_HOST}
  DEPLOY_USER                 SSH user, default ${DEFAULT_USER}
  DEPLOY_ROOT                 Server app root, default ${DEFAULT_ROOT}
  DEPLOY_SERVICE              Systemd service, default ${DEFAULT_SERVICE}
  DEPLOY_LOCAL_BASE_URL       Local app base URL, default ${DEFAULT_LOCAL_BASE_URL}
  DEPLOY_PUBLIC_BASE_URL      Public base URL for smoke checks, default ${DEFAULT_PUBLIC_BASE_URL}
  DEPLOY_PUBLIC_HEALTH_URL    Public health URL, default ${DEFAULT_PUBLIC_HEALTH_URL}
  DEPLOY_SSH_BIND_ADDRESS     Optional local source address for SSH/SCP when a VPN owns the default route
  DEPLOY_ROLLBACK_TARGET      Optional verified compatibility release inside DEPLOY_ROOT/releases
  DEPLOY_USE_SUDO             true to run restart/health systemctl through sudo, default true
  DEPLOY_PRUNE_RELEASES       true to prune old releases after a healthy switch
  DEPLOY_KEEP_RELEASES        releases to keep when pruning, default 5
`);
}

function printPlan(plan) {
  console.log("Release deployment plan");
  console.log(`- mode: ${plan.execute ? "execute" : "dry-run"}`);
  console.log(`- target: ${plan.sshTarget}`);
  console.log(`- SSH bind address: ${plan.sshBindAddress || "default route"}`);
  console.log(`- root: ${plan.root}`);
  console.log(`- service: ${plan.service}`);
  console.log(`- restart privilege: ${plan.useSudo ? "sudo" : "direct"}`);
  console.log(`- release: ${plan.releaseName}`);
  console.log(`- archive: ${plan.archivePath}`);
  console.log(`- checksum: ${plan.checksumPath}`);
  console.log(`- version metadata: ${plan.versionPath}`);
  console.log(`- archive sha256: ${plan.archiveSha256}`);
  console.log(`- preserve: server database, .env.local, shared uploads`);
  console.log(`- switch: ${plan.root}/current -> ${plan.root}/releases/${plan.releaseName}`);
  console.log(`- compatibility rollback target: ${plan.rollbackTarget || "previous release"}`);
  console.log(`- rollback shape: relink ${plan.root}/current to the previous release and restart ${plan.service}`);
  console.log(`- local smoke base: ${plan.localBaseUrl}`);
  console.log(`- public smoke base: ${plan.publicBaseUrl}`);
  console.log(`- prune old releases: ${plan.prune ? `yes, keep ${plan.keepReleases}` : "no"}`);
}

function buildRemoteScript(options) {
  return `set -Eeuo pipefail
umask 077

ROOT=${shellQuote(options.root)}
RELEASE_NAME=${shellQuote(options.releaseName)}
REMOTE_TEMP=${shellQuote(options.remoteTemp)}
SERVICE=${shellQuote(options.service)}
LOCAL_BASE_URL=${shellQuote(options.localBaseUrl)}
PUBLIC_BASE_URL=${shellQuote(options.publicBaseUrl)}
PUBLIC_HEALTH_URL=${shellQuote(options.publicHealthUrl)}
USE_SUDO=${options.useSudo ? "true" : "false"}
ARCHIVE_NAME=${shellQuote(options.archiveName)}
CHECKSUM_NAME=${shellQuote(options.checksumName)}
VERSION_NAME=${shellQuote(options.versionName)}
PRUNE_RELEASES=${options.prune ? "true" : "false"}
KEEP_RELEASES=${options.keepReleases}
ROLLBACK_TARGET=${shellQuote(options.rollbackTarget || "")}

waitForHealth() {
  label="$1"
  url="$2"
  attempts=30
  delay=1
  i=1
  while [ "$i" -le "$attempts" ]; do
    if curl -fsS "$url" >/dev/null; then
      echo "$label health check passed: $url"
      return 0
    fi
    sleep "$delay"
    i=$((i + 1))
  done
  echo "$label health check failed after $attempts attempts: $url" >&2
  return 1
}

serviceCtl() {
  if [ "$USE_SUDO" = "true" ]; then
    sudo -n systemctl "$@"
  else
    systemctl "$@"
  fi
}

selectRollbackTarget() {
  if [ -z "$ROLLBACK_TARGET" ]; then return 0; fi
  candidate="$(readlink -f "$ROLLBACK_TARGET")"
  releases_root="$(readlink -f "$RELEASES_DIR")"
  case "$candidate" in "$releases_root/"*) ;; *) echo "rollback target escapes releases directory" >&2; return 1 ;; esac
  if [ ! -d "$candidate" ] || [ ! -f "$candidate/server/server.js" ]; then
    echo "compatibility rollback release is missing" >&2
    return 1
  fi
  PREVIOUS_TARGET="$candidate"
}

PREVIOUS_TARGET=""
CURRENT_SWITCHED=false

rollbackOnError() {
  exit_code=$?
  set +e
  if [ "$CURRENT_SWITCHED" = "true" ] && [ -n "$PREVIOUS_TARGET" ] && [ -e "$PREVIOUS_TARGET" ]; then
    echo "release verification failed; restoring previous release: $PREVIOUS_TARGET" >&2
    ln -sfn "$PREVIOUS_TARGET" "$CURRENT_LINK"
    serviceCtl restart "$SERVICE"
    serviceCtl is-active "$SERVICE" >/dev/null
    curl -fsS "$LOCAL_BASE_URL/api/health" >/dev/null
    echo "previous release restored after failed verification" >&2
  fi
  exit "$exit_code"
}

trap rollbackOnError ERR

RELEASES_DIR="$ROOT/releases"
BACKUPS_DIR="$ROOT/backups"
SHARED_DIR="$ROOT/shared"
SHARED_UPLOADS="$SHARED_DIR/uploads"
SHARED_ENV="$SHARED_DIR/.env.local"
CURRENT_LINK="$ROOT/current"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"
LEGACY_DIR="$RELEASES_DIR/legacy-current-before-$RELEASE_NAME"
BACKUP_PATH="$BACKUPS_DIR/current-before-$RELEASE_NAME.tar.gz"
DB_BACKUP_PATH="$BACKUPS_DIR/db-before-$RELEASE_NAME.sql.gz"

mkdir -p "$RELEASES_DIR" "$BACKUPS_DIR" "$SHARED_UPLOADS"
selectRollbackTarget
cd "$REMOTE_TEMP"
sha256sum -c "$CHECKSUM_NAME"

if [ -e "$RELEASE_DIR" ]; then
  echo "release directory already exists: $RELEASE_DIR" >&2
  exit 1
fi

mkdir -p "$RELEASE_DIR"
tar -xzf "$REMOTE_TEMP/$ARCHIVE_NAME" -C "$RELEASE_DIR"
cp "$REMOTE_TEMP/$VERSION_NAME" "$RELEASE_DIR/docs/releases/current-deployment.json"

if [ ! -f "$SHARED_ENV" ] && [ -f "$CURRENT_LINK/.env.local" ]; then
  cp "$CURRENT_LINK/.env.local" "$SHARED_ENV"
fi

if [ ! -f "$SHARED_ENV" ]; then
  echo "missing server .env.local; refusing to start a release without environment secrets" >&2
  exit 1
fi

set -a
. "$SHARED_ENV"
set +a

MYSQL_DUMP_BIN=""
if command -v mysqldump >/dev/null 2>&1; then
  MYSQL_DUMP_BIN="mysqldump"
elif command -v mariadb-dump >/dev/null 2>&1; then
  MYSQL_DUMP_BIN="mariadb-dump"
else
  echo "missing mysqldump/mariadb-dump; refusing to deploy without database backup support" >&2
  exit 1
fi

if [ -z "\${DB_NAME:-}" ] || [ -z "\${DB_USER:-}" ]; then
  echo "missing DB_NAME or DB_USER in shared .env.local; refusing to deploy without database backup inputs" >&2
  exit 1
fi

if [ -n "\${DB_PASSWORD:-}" ]; then
  export MYSQL_PWD="$DB_PASSWORD"
fi
"$MYSQL_DUMP_BIN" \
  --single-transaction \
  --quick \
  --skip-lock-tables \
  --no-tablespaces \
  --host="\${DB_HOST:-127.0.0.1}" \
  --port="\${DB_PORT:-3306}" \
  --user="$DB_USER" \
  "$DB_NAME" | gzip -c > "$DB_BACKUP_PATH"
unset MYSQL_PWD

rm -rf "$RELEASE_DIR/uploads"
ln -s "$SHARED_UPLOADS" "$RELEASE_DIR/uploads"
rm -f "$RELEASE_DIR/.env.local"
ln -s "$SHARED_ENV" "$RELEASE_DIR/.env.local"

cd "$RELEASE_DIR"
npm ci --omit=dev
node scripts/creator-character-owner-audit.mjs

if [ -e "$CURRENT_LINK" ]; then
  tar -czf "$BACKUP_PATH" -C "$ROOT" current
fi

if [ -L "$CURRENT_LINK" ]; then
  PREVIOUS_TARGET="$(readlink -f "$CURRENT_LINK" || true)"
elif [ -d "$CURRENT_LINK" ]; then
  mv "$CURRENT_LINK" "$LEGACY_DIR"
  PREVIOUS_TARGET="$LEGACY_DIR"
fi

selectRollbackTarget
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
CURRENT_SWITCHED=true
serviceCtl restart "$SERVICE"
serviceCtl is-active "$SERVICE" >/dev/null
waitForHealth "local" "http://127.0.0.1:4173/api/health"
waitForHealth "public" "$PUBLIC_HEALTH_URL"
SMOKE_EXPECT_LOCAL_DEFAULT_SITE=false SMOKE_BASE_URL="$LOCAL_BASE_URL" node scripts/multisite-http-smoke.mjs
SMOKE_BASE_URL="$PUBLIC_BASE_URL" node scripts/multisite-http-smoke.mjs
CURRENT_SWITCHED=false
trap - ERR

if [ "$PRUNE_RELEASES" = "true" ]; then
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d \\
    ! -path "$RELEASE_DIR" \\
    ! -path "$PREVIOUS_TARGET" \\
    -printf '%T@ %p\\n' | sort -rn | awk -v keep="$KEEP_RELEASES" 'NR > keep {print $2}' | xargs -r rm -rf
fi

rm -rf "$REMOTE_TEMP"
echo "release switched: $CURRENT_LINK -> $(readlink -f "$CURRENT_LINK")"
echo "backup: $BACKUP_PATH"
echo "database backup: $DB_BACKUP_PATH"
`;
}

function sanitizeReleaseId(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "manual-release";
}

function buildTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.input ? ["pipe", "inherit", "inherit"] : "inherit",
    });
    if (options.input) child.stdin.end(options.input);
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with ${signal || code}`));
    });
  });
}
