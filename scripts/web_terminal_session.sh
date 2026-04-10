#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TMUX_CONF="$ROOT_DIR/scripts/tmux-web.conf"
RAW_SESSION="${1:-rem-dev}"

SESSION=$(printf '%s' "$RAW_SESSION" | tr -cs 'A-Za-z0-9._-' '-')
SESSION=${SESSION#-}
SESSION=${SESSION%-}

if [ -z "$SESSION" ]; then
  SESSION="rem-dev"
fi

exec tmux -f "$TMUX_CONF" new-session -A -s "$SESSION" -c "$ROOT_DIR"
