#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PID_FILE="$PROJECT_DIR/.local-app.pid"
PORT="${PORT:-4173}"
PLIST_FILE="$PROJECT_DIR/.local-app.plist"
LAUNCH_LABEL="com.aiove.localapp"
LAUNCH_DOMAIN="gui/$(id -u)"

if command -v launchctl >/dev/null 2>&1 && [[ -f "$PLIST_FILE" ]]; then
  if launchctl print "$LAUNCH_DOMAIN/$LAUNCH_LABEL" >/dev/null 2>&1; then
    echo "Stopping launchctl service $LAUNCH_LABEL..."
    launchctl bootout "$LAUNCH_DOMAIN" "$PLIST_FILE" >/dev/null 2>&1 || true
    rm -f "$PID_FILE"
    echo "App stopped."
    exit 0
  fi
fi

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Stopping app pid $(cat "$PID_FILE")..."
  kill "$(cat "$PID_FILE")"
  rm -f "$PID_FILE"
  echo "App stopped."
  exit 0
fi

PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN -n -P 2>/dev/null || true)"
if [[ -n "$PIDS" ]]; then
  echo "Stopping process(es) listening on port $PORT: $PIDS"
  kill $PIDS
  rm -f "$PID_FILE"
  echo "App stopped."
  exit 0
fi

echo "App is not running on port $PORT."
