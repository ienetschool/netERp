#!/usr/bin/env bash
# Build and restart netERp on the live Plesk host. Run as root on the server.
#
#   bash /var/www/vhosts/ienet.online/erp.ienet.online/app/scripts/deploy-host.sh
#
# Assumes the source tree has already been synced into $APP_DIR (scripts/deploy-sync.sh
# or the Deploy workflow). Host-only files (build.sh, ecosystem.config.js, .env, data/)
# are preserved and must exist.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/vhosts/ienet.online/erp.ienet.online/app}"
API_DIR="$APP_DIR/apps/api"
WEB_DIR="$APP_DIR/apps/web"
STANDALONE="$WEB_DIR/.next/standalone/apps/web"

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export NODE_OPTIONS=--max-old-space-size=4096
export API_URL="${API_URL:-http://127.0.0.1:4000}"

cd "$APP_DIR"
# Timestamps and tool versions are hoisted into variables so a failure inside the
# substitution aborts the deploy: set -e ignores a failed substitution that sits in
# an argument to echo, which would otherwise let a broken run report success.
STARTED_AT="$(date -Is)"
NODE_VERSION="$(node -v)"
NPM_VERSION="$(npm -v)"
echo "== deploy start $STARTED_AT =="
echo "app dir: $APP_DIR"
echo "node $NODE_VERSION / npm $NPM_VERSION"

if [ ! -f "$APP_DIR/package.json" ]; then
  echo "ERROR: $APP_DIR does not look like the netERp source tree" >&2
  exit 1
fi

# Guard the production database setting that caused the EMAXCONNSESSION 500s.
if [ -f "$API_DIR/.env" ]; then
  if ! grep -q 'connection_limit=' "$API_DIR/.env"; then
    echo "WARNING: connection_limit is missing from $API_DIR/.env (Supabase session pooler)" >&2
  fi
else
  echo "WARNING: $API_DIR/.env is missing; the API will start without configuration" >&2
fi

# 1. Install and build the API and packages. The host keeps build.sh because it pins
#    PATH/NODE_OPTIONS; fall back to the same steps inline when it is absent.
if [ -x "$APP_DIR/build.sh" ]; then
  echo "-- running $APP_DIR/build.sh"
  bash "$APP_DIR/build.sh"
else
  echo "-- build.sh missing, running steps inline"
  npm ci --no-audit --no-fund
  npm run db:generate
  npm run build
fi

# 2. Rebuild the web app with the API URL baked in for server-side fetches.
echo "-- web build (API_URL=$API_URL)"
API_URL="$API_URL" npm run build -w @erp/web

# 3. Next.js standalone does not copy .next/static (nor public) into the output dir.
if [ -d "$WEB_DIR/.next/static" ]; then
  mkdir -p "$STANDALONE/.next/static"
  rsync -a --delete "$WEB_DIR/.next/static/" "$STANDALONE/.next/static/"
  STATIC_FILES="$(find "$STANDALONE/.next/static" -type f | wc -l)"
  echo "-- copied .next/static ($STATIC_FILES files)"
fi
if [ -d "$WEB_DIR/public" ]; then
  mkdir -p "$STANDALONE/public"
  rsync -a --delete "$WEB_DIR/public/" "$STANDALONE/public/"
  echo "-- copied public/"
fi

# 4. Restart both processes and persist the pm2 process list.
if [ -f "$APP_DIR/ecosystem.config.js" ]; then
  echo "-- pm2 reload ecosystem.config.js"
  pm2 reload "$APP_DIR/ecosystem.config.js" --update-env
else
  echo "-- ecosystem.config.js missing, reloading by name"
  pm2 reload neterp-api --update-env
  pm2 reload neterp-web --update-env
fi
pm2 save

# 5. Smoke test through the local ports so a broken deploy fails the pipeline.
if command -v curl >/dev/null 2>&1; then
  echo "-- smoke test"
  api_ok=0
  web_ok=0
  for _ in $(seq 1 12); do
    sleep 5
    api_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/api/v1/health/live || true)"
    web_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login || true)"
    echo "   api/health/live=$api_code web/login=$web_code"
    [ "$api_code" = "200" ] && api_ok=1
    [ "$web_code" = "200" ] && web_ok=1
    if [ "$api_ok" = "1" ] && [ "$web_ok" = "1" ]; then
      break
    fi
  done
  if [ "$api_ok" != "1" ] || [ "$web_ok" != "1" ]; then
    echo "ERROR: smoke test failed (api=$api_ok web=$web_ok)" >&2
    exit 1
  fi
  echo "-- smoke test passed"
else
  echo "-- curl unavailable, skipping smoke test"
fi

FINISHED_AT="$(date -Is)"
echo "== deploy finished $FINISHED_AT =="
