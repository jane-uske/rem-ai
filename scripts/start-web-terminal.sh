#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if ! command -v ttyd >/dev/null 2>&1; then
  echo "ttyd is required but was not found in PATH."
  echo "Install it with: brew install ttyd"
  exit 1
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required but was not found in PATH."
  exit 1
fi

PORT="${REM_TERMINAL_PORT:-7681}"
USERNAME="${REM_TERMINAL_USERNAME:-rem}"
PASSWORD="${REM_TERMINAL_PASSWORD:-${REM_ACCESS_PASSWORD:-}}"
TMUX_CONF="$ROOT_DIR/scripts/tmux-web.conf"

if [ -z "$PASSWORD" ]; then
  echo "REM_TERMINAL_PASSWORD is not set."
  echo "Set REM_TERMINAL_PASSWORD in .env (or reuse REM_ACCESS_PASSWORD) before exposing the terminal."
  exit 1
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use."
  exit 1
fi

exec ttyd \
  --port "$PORT" \
  --writable \
  --credential "$USERNAME:$PASSWORD" \
  tmux -f "$TMUX_CONF" new-session -A -s rem-dev -c "$ROOT_DIR"
