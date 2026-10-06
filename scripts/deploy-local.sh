#!/usr/bin/env bash
# Ship the current working tree to the live Plesk host, from this Mac.
#
#   npm run deploy:live            # or: bash scripts/deploy-local.sh
#   scripts/deploy-local.sh <ssh-target>
#
# This is the same three steps the Deploy workflow runs, so a local deploy and a
# CI deploy produce identical results:
#   1. scripts/deploy-sync.sh   guarded rsync (refuses to delete anything)
#   2. scripts/deploy-host.sh   build, copy .next/static, pm2 reload, local smoke test
#   3. public smoke test        through the domain, i.e. the real user path
#
# The server keeps build.sh, ecosystem.config.js, .env, apps/api/.env and data/.
# Those are excluded from the sync, so nothing here can overwrite them.
set -euo pipefail

TARGET="${1:-neterp-plesk}"
APP_DIR="${APP_DIR:-/var/www/vhosts/ienet.online/erp.ienet.online/app}"
DOMAIN="${DOMAIN:-https://erp.ienet.online}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== 1/3 sync $ROOT -> $TARGET:$APP_DIR =="
bash "$ROOT/scripts/deploy-sync.sh" "$TARGET" "$APP_DIR"

echo "== 2/3 build and restart on the server =="
ssh -o BatchMode=yes "$TARGET" "APP_DIR='$APP_DIR' bash '$APP_DIR/scripts/deploy-host.sh'"

echo "== 3/3 public smoke test =="
for path in /api/v1/health/live /login; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$DOMAIN$path" || true)"
  echo "   $DOMAIN$path -> $code"
  if [ "$code" != "200" ]; then
    echo "ERROR: $DOMAIN$path returned $code" >&2
    exit 1
  fi
done

# Portable timestamp: BSD date (macOS) has no -I flag, GNU date does.
# Hoisted into a variable on purpose: set -e does not abort when a command
# substitution fails inside an argument to echo, but it does for an assignment.
FINISHED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "== deploy complete $FINISHED_AT =="
