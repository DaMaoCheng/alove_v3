#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACE_DIR="$(cd "$PROJECT_DIR/.." && pwd)"
MYSQL_RUNTIME_DIR="$WORKSPACE_DIR/work/mysql-runtime"
MYSQL_HOME="$MYSQL_RUNTIME_DIR/mysql-8.4.0-macos14-arm64"
MYSQL_DATA_DIR="$MYSQL_RUNTIME_DIR/data"
MYSQL_LOG_DIR="$MYSQL_RUNTIME_DIR/logs"
MYSQL_RUN_DIR="$MYSQL_RUNTIME_DIR/run"
MYSQL_PORT="${MYSQL_PORT:-3307}"

MYSQLD="$MYSQL_HOME/bin/mysqld"
MYSQLADMIN="$MYSQL_HOME/bin/mysqladmin"
PID_FILE="$MYSQL_RUN_DIR/mysql.pid"
SOCKET_FILE="$MYSQL_RUN_DIR/mysql.sock"
ERROR_LOG="$MYSQL_LOG_DIR/mysql.err"

if [[ ! -x "$MYSQLD" ]]; then
  echo "MySQL binary not found: $MYSQLD" >&2
  exit 1
fi

mkdir -p "$MYSQL_LOG_DIR" "$MYSQL_RUN_DIR"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "MySQL is already running on port $MYSQL_PORT (pid $(cat "$PID_FILE"))."
  exit 0
fi

if "$MYSQLADMIN" --protocol=tcp --host=127.0.0.1 --port="$MYSQL_PORT" -uroot ping >/dev/null 2>&1; then
  echo "MySQL is already responding on port $MYSQL_PORT."
  exit 0
fi

echo "Starting MySQL on 127.0.0.1:$MYSQL_PORT..."
"$MYSQLD" \
  --basedir="$MYSQL_HOME" \
  --datadir="$MYSQL_DATA_DIR" \
  --port="$MYSQL_PORT" \
  --bind-address=127.0.0.1 \
  --socket="$SOCKET_FILE" \
  --pid-file="$PID_FILE" \
  --log-error="$ERROR_LOG" \
  --daemonize

for _ in {1..30}; do
  if "$MYSQLADMIN" --protocol=tcp --host=127.0.0.1 --port="$MYSQL_PORT" -uroot ping >/dev/null 2>&1; then
    echo "MySQL is ready on 127.0.0.1:$MYSQL_PORT."
    exit 0
  fi
  sleep 1
done

echo "MySQL did not become ready. Last log lines:" >&2
tail -n 80 "$ERROR_LOG" >&2
exit 1
