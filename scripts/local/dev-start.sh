#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/start-db.sh"
"$SCRIPT_DIR/start-app.sh"

echo "AIOVE is running at http://127.0.0.1:${PORT:-4173}"
