#!/usr/bin/env bash
# Regression tests for the deploy safety guards.
#
#   bash scripts/test-deploy-guards.sh
#
# These cover the failure modes that are expensive to discover in production:
#   * an unguarded sync silently deleting host-only files
#   * the guard firing on a clean sync, which would block every deploy
#   * a GNU-only `date` flag, or a failed substitution hidden inside echo, letting a
#     broken deploy exit 0 (this shipped once and was missed)
#   * deploy-host.sh running against something that is not the source tree
#
# Everything runs in a scratch directory. It never contacts the host and never
# touches the real working tree.
set -uo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

# Fail loudly rather than reporting a pass when the tool under test is absent.
for tool in rsync mktemp; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: $tool is required to run the deploy guard tests" >&2
    exit 1
  fi
done

ok() {
  echo "  ok   - $1"
  PASS=$((PASS + 1))
}

bad() {
  echo "  FAIL - $1" >&2
  echo "         expected: $2" >&2
  echo "         actual:   $3" >&2
  FAIL=$((FAIL + 1))
}

check() { # description expected actual
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "$2" "$3"; fi
}

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/neterp-guards.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

SRC="$SCRATCH/src"
DST="$SCRATCH/dst"
mkdir -p "$SRC" "$DST"

# A miniature source tree and a miniature "server" that already has the host-only
# artifacts deploy-sync.sh must never remove.
printf 'v1\n' > "$SRC/tracked.txt"
mkdir -p "$SRC/apps/api"
printf 'source env\n' > "$SRC/apps/api/.env.example"

mkdir -p "$DST/apps/api" "$DST/data"
printf 'secret\n' > "$DST/.env"
printf 'api secret\n' > "$DST/apps/api/.env"
printf '#!/bin/bash\necho build\n' > "$DST/build.sh"
printf 'module.exports = {};\n' > "$DST/ecosystem.config.js"
printf 'uploaded\n' > "$DST/data/upload.txt"
printf 'v1\n' > "$DST/tracked.txt"
# rsync's default check is size + mtime at 1s resolution, so a same-size rewrite in
# the same second is legitimately skipped. Backdate the copy to make the change
# unambiguous instead of depending on wall-clock timing.
touch -t 202001010000 "$DST/tracked.txt"

echo "== 1. the deletion guard refuses a sync that would remove a remote file =="
printf 'do not lose me\n' > "$DST/untracked-on-server.txt"
# Bump the source so a sync that started before the guard would be visible.
printf 'v2\n' > "$SRC/tracked.txt"
out="$(SOURCE="$SRC" bash "$ROOT/scripts/deploy-sync.sh" local "$DST" 2>&1)"
rc=$?
check "exits 1 when a remote file would be deleted" "1" "$rc"
if printf '%s' "$out" | grep -q "REFUSING to delete files on the server:"; then
  ok "prints the refusal reason"
else
  bad "prints the refusal reason" "REFUSING to delete files on the server:" "$(printf '%s' "$out" | tail -3)"
fi
if printf '%s' "$out" | grep -q "untracked-on-server.txt"; then
  ok "names the file it would have deleted"
else
  bad "names the file it would have deleted" "untracked-on-server.txt" "not mentioned"
fi
check "the refused file still exists" "do not lose me" "$(cat "$DST/untracked-on-server.txt")"
check "the sync did not start before the refusal" "v1" "$(cat "$DST/tracked.txt" 2>/dev/null || echo missing)"

echo "== 2. a clean sync succeeds and preserves host-only artifacts =="
rm -f "$DST/untracked-on-server.txt"
out="$(SOURCE="$SRC" bash "$ROOT/scripts/deploy-sync.sh" local "$DST" 2>&1)"
rc=$?
check "exits 0 with no deletions pending" "0" "$rc"
check "copied the changed file" "v2" "$(cat "$DST/tracked.txt")"
for artifact in .env apps/api/.env build.sh ecosystem.config.js data/upload.txt; do
  if [ -f "$DST/$artifact" ]; then
    ok "host-only artifact preserved: $artifact"
  else
    bad "host-only artifact preserved: $artifact" "file present" "missing"
  fi
done
if printf '%s' "$out" | grep -q "would update .* delete 0"; then
  ok "reports zero deletions"
else
  bad "reports zero deletions" "would update N entr(y|ies), delete 0" "$(printf '%s' "$out" | grep 'would update' || echo 'no summary line')"
fi

echo "== 3. an excluded path is never deleted even when the source lacks it =="
printf 'kept\n' > "$DST/.env"
SOURCE="$SRC" bash "$ROOT/scripts/deploy-sync.sh" local "$DST" >/dev/null 2>&1
check "excluded .env survived a sync" "kept" "$(cat "$DST/.env")"

echo "== 4. deploy-host.sh refuses a directory that is not the source tree =="
EMPTY="$SCRATCH/empty"
mkdir -p "$EMPTY"
out="$(APP_DIR="$EMPTY" bash "$ROOT/scripts/deploy-host.sh" 2>&1)"
rc=$?
check "exits 1 on a non-app directory" "1" "$rc"
if printf '%s' "$out" | grep -q "does not look like the netERp source tree"; then
  ok "explains why it refused"
else
  bad "explains why it refused" "does not look like the netERp source tree" "$(printf '%s' "$out" | tail -3)"
fi

echo "== 5. no GNU-only date flags (BSD date on macOS has no -Is) =="
# Comment lines are ignored: prose is allowed to name the flag it warns about.
for script in deploy-host.sh deploy-local.sh; do
  uses="$(grep -nE 'date -I' "$ROOT/scripts/$script" | grep -vE '^[0-9]+:[[:space:]]*#' || true)"
  if [ -n "$uses" ]; then
    bad "$script uses a GNU-only date flag" "no date -I" "found $(printf '%s' "$uses" | head -1)"
  else
    ok "$script avoids date -I"
  fi
done

echo "== 6. every command substitution is hoisted out of echo (set -e blind spot) =="
# set -e does not abort when a substitution fails inside an argument to echo, so a
# broken deploy could still exit 0. Every $(...) used for output must be assigned
# to a variable first.
for script in deploy-host.sh deploy-local.sh; do
  inline="$(grep -nE 'echo "\$\(|echo "[^"]*\$\((date|node|npm|find|hostname)' "$ROOT/scripts/$script" | grep -vE '^[0-9]+:[[:space:]]*#' || true)"
  if [ -n "$inline" ]; then
    bad "$script keeps substitutions out of echo" "no inline \$( ) in echo" "$(printf '%s' "$inline" | head -2)"
  else
    ok "$script keeps substitutions out of echo"
  fi
done

echo "== 7. the scripts still parse and are executable =="
for script in deploy-sync.sh deploy-host.sh deploy-local.sh setup-github.sh test-deploy-guards.sh; do
  if bash -n "$ROOT/scripts/$script" 2>/dev/null; then
    ok "$script parses"
  else
    bad "$script parses" "bash -n exit 0" "syntax error"
  fi
  if [ -x "$ROOT/scripts/$script" ]; then
    ok "$script is executable"
  else
    bad "$script is executable" "mode +x" "$(stat -f '%Sp' "$ROOT/scripts/$script" 2>/dev/null || stat -c '%A' "$ROOT/scripts/$script")"
  fi
done

echo
echo "== $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ] || exit 1
