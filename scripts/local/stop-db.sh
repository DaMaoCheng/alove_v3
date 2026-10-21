#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACE_DIR="$(cd "$PROJECT_DIR/.." && pwd)"
MYSQL_RUNTIME_DIR="$WORKSPACE_DIR/work/mysql-runtime"
MYSQL_HOME="$MYSQL_RUNTIME_DIR/mysql-8.4.0-macos14-arm64"
MYSQL_RUN_DIR="$MYSQL_RUNTIME_DIR/run"
MYSQL_PORT="${MYSQL_PORT:-3307}"
MYSQLADMIN="$MYSQL_HOME/bin/mysqladmin"
PID_FILE="$MYSQL_RUN_DIR/mysql.pid"

if [[ -x "$MYSQLADMIN" ]]; then
  if "$MYSQLADMIN" --protocol=tcp --host=127.0.0.1 --port="$MYSQL_PORT" -uroot ping >/dev/null 2>&1; then
    echo "Stopping MySQL on port $MYSQL_PORT..."
    "$MYSQLADMIN" --protocol=tcp --host=127.0.0.1 --port="$MYSQL_PORT" -uroot shutdown
    echo "MySQL stopped."
    exit 0
  fi
fi

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Stopping MySQL pid $(cat "$PID_FILE")..."
  kill "$(cat "$PID_FILE")"
  echo "MySQL stop signal sent."
  exit 0
fi

echo "MySQL is not running on port $MYSQL_PORT."
