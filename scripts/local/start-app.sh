#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PID_FILE="$PROJECT_DIR/.local-app.pid"
LOG_FILE="$PROJECT_DIR/.local-app.log"
PORT="${PORT:-4173}"
PLIST_FILE="$PROJECT_DIR/.local-app.plist"
LAUNCH_LABEL="com.aiove.localapp"
LAUNCH_DOMAIN="gui/$(id -u)"

if lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN -n -P | head -n 1)"
  echo "$PID" >"$PID_FILE"
  echo "App is already running on port $PORT (pid $PID)."
  exit 0
fi

cd "$PROJECT_DIR"

if [[ ! -d node_modules ]]; then
  echo "Installing npm dependencies..."
  npm install
fi

if command -v launchctl >/dev/null 2>&1 && [[ -f "$PLIST_FILE" ]]; then
  echo "Starting app on http://127.0.0.1:$PORT via launchctl ..."
  launchctl bootstrap "$LAUNCH_DOMAIN" "$PLIST_FILE" >/dev/null 2>&1 || true
  launchctl kickstart -k "$LAUNCH_DOMAIN/$LAUNCH_LABEL"
else
  echo "Starting app on http://127.0.0.1:$PORT ..."
  PORT="$PORT" nohup node server/server.js >"$LOG_FILE" 2>&1 &
fi

for _ in {1..30}; do
  PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN -n -P | head -n 1 || true)"
  if [[ -n "$PID" ]]; then
    echo "$PID" >"$PID_FILE"
    echo "App is ready at http://127.0.0.1:$PORT"
    exit 0
  fi
  sleep 1
done

echo "App did not become ready. Last log lines:" >&2
if [[ -f "$LOG_FILE" ]]; then
  tail -n 80 "$LOG_FILE" >&2
fi
exit 1
