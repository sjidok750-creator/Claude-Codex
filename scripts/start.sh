#!/usr/bin/env bash
# 허브 실행 (macOS / Linux). 저장소 루트에서: ./scripts/start.sh
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
command -v pnpm >/dev/null || npm i -g pnpm
[ -d node_modules ] || pnpm install
[ -d apps/web/dist ] || pnpm build
exec pnpm --filter @claude-codex/hub start
