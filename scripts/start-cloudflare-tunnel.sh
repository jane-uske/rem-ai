#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is required but was not found in PATH."
  echo "Install it first, or use the compose profile if you explicitly want the containerized tunnel."
  exit 1
fi

CONFIG_PATH="${1:-$ROOT_DIR/infra/cloudflared/config.yml}"

if [ ! -f "$CONFIG_PATH" ]; then
  echo "Tunnel config not found: $CONFIG_PATH"
  echo "Copy infra/cloudflared/config.example.yml to infra/cloudflared/config.yml and fill in your real tunnel/domain values."
  exit 1
fi

exec cloudflared tunnel --config "$CONFIG_PATH" run
