#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

docker compose -f docker-compose.dev.yml down

echo "Remote dev stack stopped."
