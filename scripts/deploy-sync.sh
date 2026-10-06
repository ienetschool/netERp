#!/usr/bin/env bash
# Sync the working tree to the netERp app directory on the live server.
#
# Runs wherever SSH access to the host exists: a developer Mac or a GitHub runner.
#
#   scripts/deploy-sync.sh [ssh-target] [remote-app-dir]
#
# Defaults: ssh-target "neterp-plesk", remote-app-dir the Plesk docroot.
# After a successful sync, run the build/deploy on the host:
#   ssh <ssh-target> 'bash /var/www/vhosts/ienet.online/erp.ienet.online/app/scripts/deploy-host.sh'
#
# Pass the literal target "local" to sync into a plain directory on this machine
# instead of over SSH. That exists so scripts/test-deploy-guards.sh can exercise
# the real deletion guard against a scratch directory, and it doubles as a way to
# rehearse a sync locally without touching the host.
set -euo pipefail

TARGET="${1:-neterp-plesk}"
REMOTE_DIR="${2:-/var/www/vhosts/ienet.online/erp.ienet.online/app}"
SOURCE="${SOURCE:-$(cd "$(dirname "$0")/.." && pwd)}"

if [ "$TARGET" = "local" ]; then
  DEST="$REMOTE_DIR"
else
  DEST="$TARGET:$REMOTE_DIR"
fi

# Files that exist only on the server (root-owned env, build and pm2 config, uploaded
# documents) are excluded so an unattended sync can never overwrite or delete them.
# rsync treats excluded paths as protected from --delete, which keeps them safe.
EXCLUDES=(
  --exclude '.git'
  --exclude 'node_modules'
  --exclude '.next'
  --exclude 'dist'
  --exclude 'data'
  --exclude '.freebuff'
  --exclude '.env'
  --exclude '.env.bak.*'
  --exclude '.env.*.bak'
  --exclude '*.tsbuildinfo'
  --exclude 'coverage'
  --exclude 'uploads'
  --exclude '.DS_Store'
  --exclude 'build.sh'
  --exclude 'ecosystem.config.js'
  --exclude '.agents'
  --exclude '.claude'
  --exclude '.claude-flow'
  --exclude '.swarm'
  --exclude 'ruvector.db'
)

echo "== dry run: $SOURCE -> $DEST =="
DRY="$(rsync -an -i --delete "${EXCLUDES[@]}" "$SOURCE/" "$DEST/" || true)"
CHANGES="$(printf '%s\n' "$DRY" | grep -c '[^[:space:]]' || true)"
DELETIONS="$(printf '%s\n' "$DRY" | grep '^\*deleting' || true)"
DELETE_COUNT=0
if [ -n "$DELETIONS" ]; then
  DELETE_COUNT="$(printf '%s\n' "$DELETIONS" | grep -c '.' || true)"
fi
echo "would update $CHANGES entr(y|ies), delete $DELETE_COUNT"

if [ "$DELETE_COUNT" -gt 0 ]; then
  {
    echo "REFUSING to delete files on the server:"
    printf '%s\n' "$DELETIONS"
    echo "Removals are expected only during a deliberate manual cleanup."
  } >&2
  exit 1
fi

echo "== syncing =="
rsync -az --delete "${EXCLUDES[@]}" "$SOURCE/" "$DEST/"
echo "== sync complete =="
