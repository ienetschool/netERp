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
#   * deploy-host.sh exiting 0 while the app it just restarted was never healthy
#   * the credential scan quietly stopping matching, which would leak the production
#     database password into a public repository (this shipped once and was missed)
#   * the auto-push hook failing a commit, or pushing when it was never armed
#
# Everything runs in a scratch directory. It never contacts the host or GitHub, and
# never touches the real working tree. Scratch git repositories are real ones, because
# git only runs hooks inside a repository.
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

# The hook bodies are the code that runs on every single commit, so they get the same
# parse and permission checks. Both are installed by setup-github.sh into .git/hooks/,
# which is not tracked, so these two files are the only version-controlled copy.
for hook in pre-commit post-commit; do
  if bash -n "$ROOT/scripts/git-hooks/$hook" 2>/dev/null; then
    ok "git-hooks/$hook parses"
  else
    bad "git-hooks/$hook parses" "bash -n exit 0" "syntax error"
  fi
done

# --- a scratch repository for the hook and scan tests ------------------------------
# A real repo is needed: git only runs hooks inside one, and the scan reads the index.
HOOKREPO="$SCRATCH/hookrepo"
HOOKORIGIN="$SCRATCH/hook-origin.git"
SCANREPO="$SCRATCH/scanrepo"
# Synthetic, not real. The marker tells the scan these fixtures are deliberate; see
# scripts/setup-github.sh:scan_secrets. Do not add a real value to this file.
LEAK='DATABASE_URL=postgresql://erp_api.abcdefghijklmnopqrst:deadbeef@aws-0-us-west-2.pooler.supabase.com:5432/postgres' # secret-guard:allow-synthetic

new_repo() { # path
  git init -q "$1"
  git -C "$1" config user.name "guard test"
  git -C "$1" config user.email "guard-test@example.invalid"
  git -C "$1" config commit.gpgsign false
  # Keep the user's own global hooks/config out of these fixtures.
  git -C "$1" config core.hooksPath .git/hooks
  return 0
}

echo "== 8. the auto-push hook is inert until armed, then pushes, and never fails a commit =="
git init -q --bare "$HOOKORIGIN"
new_repo "$HOOKREPO"
mkdir -p "$HOOKREPO/scripts"
cp "$ROOT/scripts/setup-github.sh" "$HOOKREPO/scripts/setup-github.sh"
cp "$ROOT/scripts/git-hooks/post-commit" "$HOOKREPO/.git/hooks/post-commit"
cp "$ROOT/scripts/git-hooks/pre-commit" "$HOOKREPO/.git/hooks/pre-commit"
chmod +x "$HOOKREPO/.git/hooks/post-commit" "$HOOKREPO/.git/hooks/pre-commit"
git -C "$HOOKREPO" remote add origin "$HOOKORIGIN"
printf 'one\n' > "$HOOKREPO/f.txt"
# Has this exact commit reached the scratch origin? A SHA is asserted rather than a
# commit count, because a push brings the whole ancestry with the tip.
at_origin() { # sha
  git --git-dir="$HOOKORIGIN" cat-file -e "$1" 2>/dev/null && echo present || echo absent
}

git -C "$HOOKREPO" add -A >/dev/null 2>&1
git -C "$HOOKREPO" commit -qm one >/dev/null 2>&1
check "unarmed post-commit sends nothing to origin" "absent" "$(at_origin "$(git -C "$HOOKREPO" rev-parse HEAD)")"

git -C "$HOOKREPO" config neterp.autopush true
printf 'two\n' > "$HOOKREPO/g.txt"
git -C "$HOOKREPO" add g.txt >/dev/null 2>&1
out="$(git -C "$HOOKREPO" commit -qm two 2>&1)"
rc=$?
check "an armed commit still exits 0" "0" "$rc"
check "an armed commit reaches origin" "present" "$(at_origin "$(git -C "$HOOKREPO" rev-parse HEAD)")"
if printf '%s' "$out" | grep -q '\[auto-push\]'; then
  ok "reports the branch it pushed"
else
  bad "reports the branch it pushed" "[auto-push] <branch> -> origin" "$(printf '%s' "$out" | tail -2)"
fi

# A push that fails must never cost the local commit: the hook has to exit 0 anyway.
git -C "$HOOKREPO" remote set-url origin "$SCRATCH/no-such-remote.git"
printf 'three\n' > "$HOOKREPO/h.txt"
git -C "$HOOKREPO" add h.txt >/dev/null 2>&1
out="$(git -C "$HOOKREPO" commit -qm three 2>&1)"
rc=$?
check "a failed push does not fail the commit" "0" "$rc"
check "the commit survives locally" "present" "$(git -C "$HOOKREPO" cat-file -e HEAD:h.txt 2>/dev/null && echo present || echo absent)"
if printf '%s' "$out" | grep -q '\[auto-push\] push of'; then
  ok "says the push failed, on stderr"
else
  bad "says the push failed, on stderr" "[auto-push] push of <branch> failed" "$(printf '%s' "$out" | tail -2)"
fi

echo "== 9. the credential scan fires on real-looking secrets and not on localhost =="
new_repo "$SCANREPO"
mkdir -p "$SCANREPO/scripts"
# The scan is exercised through a copy, so the fixture cannot touch the real tree.
cp "$ROOT/scripts/setup-github.sh" "$SCANREPO/scripts/setup-github.sh"
printf 'DATABASE_URL=postgresql://erp:erp@localhost:5432/erp\n' > "$SCANREPO/.env.example"
git -C "$SCANREPO" add -A >/dev/null 2>&1
git -C "$SCANREPO" commit -qm initial >/dev/null 2>&1
out="$(bash "$SCANREPO/scripts/setup-github.sh" --check-secrets 2>&1)"
rc=$?
check "a localhost URL does not fire" "0" "$rc"
if printf '%s' "$out" | grep -q 'clean:'; then
  ok "reports the tree as clean"
else
  bad "reports the tree as clean" "clean: no credential-looking values" "$(printf '%s' "$out" | tail -2)"
fi

# Negative controls. Each pattern the gate claims to catch is checked individually,
# because a silently broken pattern is a false pass, which is the whole risk here.
fire_and_check() { # description file contents expected-fragment
  printf '%s\n' "$2" > "$SCANREPO/probe.txt"
  git -C "$SCANREPO" add probe.txt >/dev/null 2>&1
  local o r
  o="$(bash "$SCANREPO/scripts/setup-github.sh" --check-secrets 2>&1)"
  r=$?
  check "$1" "1" "$r"
  if printf '%s' "$o" | grep -q 'REFUSING to continue'; then
    ok "  ...and says it is refusing"
  else
    bad "  ...and says it is refusing" "REFUSING to continue" "$(printf '%s' "$o" | tail -2)"
  fi
  if printf '%s' "$o" | grep -qF "$3"; then
    ok "  ...and names the file it found"
  else
    bad "  ...and names the file it found" "$3" "$(printf '%s' "$o" | tail -2)"
  fi
  if printf '%s' "$o" | grep -q 'deadbeef'; then
    bad "  ...and masks the password" "no plaintext password" "the password was echoed"
  else
    ok "  ...and masks the password"
  fi
  git -C "$SCANREPO" rm -q --cached probe.txt >/dev/null 2>&1
  rm -f "$SCANREPO/probe.txt"
}
fire_and_check "a pooled managed-database password fires" "$LEAK" "probe.txt:1"
fire_and_check "a GitHub token fires" "GITHUB_TOKEN=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" "probe.txt:1" # secret-guard:allow-synthetic
fire_and_check "an AWS key fires" "aws_access_key_id = AKIAIOSFODNN7EXAMPLE" "probe.txt:1"                        # secret-guard:allow-synthetic
fire_and_check "a private key header fires" "-----BEGIN OPENSSH PRIVATE KEY-----" "probe.txt:1"                     # secret-guard:allow-synthetic
fire_and_check "a supabase pooler host alone fires" "host=aws-0-us-west-2.pooler.supabase.com" "probe.txt:1"        # secret-guard:allow-synthetic

# The opt-out must cover exactly one line. If it covered the whole file, a real secret
# dropped next to a fixture would go unreported, which is the failure that matters.
{
  printf '%s # secret-guard:allow-synthetic\n' "$LEAK"
  printf '%s\n' "$LEAK"
} > "$SCANREPO/mixed.txt"
git -C "$SCANREPO" add mixed.txt >/dev/null 2>&1
out="$(bash "$SCANREPO/scripts/setup-github.sh" --check-secrets 2>&1)"
check "an unmarked line still fires next to a marked one" "1" "$?"
if printf '%s' "$out" | grep -q 'mixed.txt:2:'; then
  ok "  ...reports the unmarked line"
else
  bad "  ...reports the unmarked line" "mixed.txt:2" "$(printf '%s' "$out" | tail -3)"
fi
if printf '%s' "$out" | grep -q 'mixed.txt:1:'; then
  bad "  ...and stays quiet about the marked line" "no mixed.txt:1 finding" "the allowlisted line was reported"
else
  ok "  ...and stays quiet about the marked line"
fi
git -C "$SCANREPO" rm -q --cached mixed.txt >/dev/null 2>&1
rm -f "$SCANREPO/mixed.txt"

# The gate must go quiet again once the offending file is gone, or every later commit
# in the fixture (and every commit a developer makes) would be blocked.
out="$(bash "$SCANREPO/scripts/setup-github.sh" --check-secrets 2>&1)"
check "the scan goes quiet after the leak is removed" "0" "$?"

echo "== 10. the pre-commit guard blocks the leak, and has working escape hatches =="
cp "$ROOT/scripts/git-hooks/pre-commit" "$SCANREPO/.git/hooks/pre-commit"
chmod +x "$SCANREPO/.git/hooks/pre-commit"
printf '%s\n' "$LEAK" > "$SCANREPO/leak.txt"
git -C "$SCANREPO" add leak.txt >/dev/null 2>&1
out="$(git -C "$SCANREPO" commit -qm leak 2>&1)"
rc=$?
check "the guard refuses the commit" "1" "$rc"
check "nothing was committed" "absent" \
  "$(git -C "$SCANREPO" cat-file -e HEAD:leak.txt 2>/dev/null && echo present || echo absent)"
if printf '%s' "$out" | grep -q 'secret-guard'; then
  ok "explains the block"
else
  bad "explains the block" "[secret-guard] commit blocked" "$(printf '%s' "$out" | tail -2)"
fi
if printf '%s' "$out" | grep -q 'deadbeef'; then
  bad "does not echo the secret" "no plaintext secret" "the password was echoed"
else
  ok "does not echo the secret"
fi

out="$(git -C "$SCANREPO" commit -qm leak --no-verify 2>&1)"
check "--no-verify overrides the guard" "0" "$?"
git -C "$SCANREPO" reset -q --hard HEAD~1
printf '%s\n' "$LEAK" > "$SCANREPO/leak.txt"
git -C "$SCANREPO" add leak.txt >/dev/null 2>&1
git -C "$SCANREPO" config neterp.secretguard false
out="$(git -C "$SCANREPO" commit -qm leak 2>&1)"
check "neterp.secretguard false overrides the guard" "0" "$?"
git -C "$SCANREPO" reset -q --hard HEAD~1

# A clean commit must stay quiet: a hook that chatters on every commit gets disabled,
# and a disabled hook protects nothing.
git -C "$SCANREPO" config --unset neterp.secretguard
printf 'fine\n' > "$SCANREPO/normal.txt"
git -C "$SCANREPO" add normal.txt >/dev/null 2>&1
out="$(git -C "$SCANREPO" commit -qm normal 2>&1)"
check "a clean commit still succeeds" "0" "$?"
check "a clean commit stays silent" "" "$out"

echo "== 11. deploy-host.sh fails the deploy when the smoke test never passes =="
# This is the half of a deploy that touches production, and its worst failure is exiting 0
# while the app it just restarted is down. deploy-host.sh overwrites PATH, so the stub
# tools are injected as shell functions via BASH_ENV: functions win over PATH lookup, so
# the script under test needs no test-only seam. `sleep` is stubbed as well, or the
# 12-step retry loop would cost a minute on every failed assertion.
HOSTAPP="$SCRATCH/hostapp"
HOSTSTUB="$SCRATCH/hoststub"
HOSTPM2="$SCRATCH/pm2.log"
mkdir -p "$HOSTAPP/apps/api" "$HOSTAPP/apps/web/.next/static" "$HOSTAPP/apps/web/public" "$HOSTSTUB"
printf '{"name":"stub"}\n' > "$HOSTAPP/package.json"
# Deliberately a localhost URL: this fixture must never look like a real leaked credential
# to the scan, which is also what the scan's devhost filter is there to recognise.
printf 'DATABASE_URL=postgresql://u:p@localhost:5432/db?connection_limit=5\n' > "$HOSTAPP/apps/api/.env"
printf 'chunk\n' > "$HOSTAPP/apps/web/.next/static/chunk.js"
printf 'icon\n' > "$HOSTAPP/apps/web/public/favicon.ico"
cat > "$HOSTSTUB/env.sh" <<'STUBEOF'
npm() { case "${1:-}" in -v) echo "10.0.0-stub" ;; *) return 0 ;; esac; }
node() { echo "v20.0.0-stub"; }
pm2() { printf 'pm2 %s\n' "$*" >> "$PM2_LOG"; }
curl() { echo "${HOSTCURL_CODE:-200}"; }
sleep() { return 0; }
STUBEOF
run_host() { # curl-code -> the script's output; exit status is the script's
  HOSTCURL_CODE="$1" PM2_LOG="$HOSTPM2" BASH_ENV="$HOSTSTUB/env.sh" APP_DIR="$HOSTAPP" \
    bash "$ROOT/scripts/deploy-host.sh" 2>&1
}
: > "$HOSTPM2"

out="$(run_host 500)"
rc=$?
check "exits 1 when the smoke test never passes" "1" "$rc"
if printf '%s' "$out" | grep -q 'ERROR: smoke test failed'; then
  ok "says the smoke test failed"
else
  bad "says the smoke test failed" "ERROR: smoke test failed (api=0 web=0)" "$(printf '%s' "$out" | tail -2)"
fi
if printf '%s' "$out" | grep -q 'smoke test passed'; then
  bad "never claims success for a dead app" "no success line" "claimed the smoke test passed"
else
  ok "never claims success for a dead app"
fi

out="$(run_host 200)"
rc=$?
check "exits 0 when the smoke test passes" "0" "$rc"
if printf '%s' "$out" | grep -q -- '-- smoke test passed'; then
  ok "reports the passing smoke test"
else
  bad "reports the passing smoke test" "-- smoke test passed" "$(printf '%s' "$out" | tail -2)"
fi
# Next.js standalone ships without .next/static or public, and the app 404s its own
# assets until they are copied in. That is exactly the bug that shipped once.
STANDALONE_OUT="$HOSTAPP/apps/web/.next/standalone/apps/web"
check "populated the standalone .next/static" "chunk" \
  "$(cat "$STANDALONE_OUT/.next/static/chunk.js" 2>/dev/null || echo missing)"
check "populated the standalone public dir" "icon" \
  "$(cat "$STANDALONE_OUT/public/favicon.ico" 2>/dev/null || echo missing)"
if printf '%s' "$out" | grep -q 'build.sh missing, running steps inline'; then
  ok "falls back to inline steps when build.sh is absent"
else
  bad "falls back to inline steps when build.sh is absent" "-- build.sh missing, running steps inline" "$(printf '%s' "$out" | grep -c 'npm' | tr -d ' ')"
fi
if printf '%s' "$out" | grep -q 'connection_limit is missing'; then
  bad "no false pool warning when the setting is present" "no warning" "warned about a setting that exists"
else
  ok "no false pool warning when the setting is present"
fi
if grep -q 'reload neterp-api' "$HOSTPM2" && grep -q 'reload neterp-web' "$HOSTPM2"; then
  ok "reloaded both processes by name"
else
  bad "reloaded both processes by name" "pm2 reload neterp-api / neterp-web" "$(cat "$HOSTPM2" | tr '\n' ' ')"
fi
if grep -qx 'pm2 save' "$HOSTPM2"; then
  ok "persisted the process list"
else
  bad "persisted the process list" "pm2 save" "$(cat "$HOSTPM2" | tr '\n' ' ')"
fi

# The warning is advisory: it must be loud, but it must not fail an otherwise healthy
# deploy, or every deploy without the setting would be blocked.
printf 'DATABASE_URL=postgresql://u:p@localhost:5432/db\n' > "$HOSTAPP/apps/api/.env"
out="$(run_host 200)"
rc=$?
check "still exits 0 when only the pool warning fires" "0" "$rc"
if printf '%s' "$out" | grep -q 'connection_limit is missing'; then
  ok "warns when the pool setting is absent"
else
  bad "warns when the pool setting is absent" "WARNING: connection_limit is missing" "$(printf '%s' "$out" | tail -2)"
fi

echo
echo "== $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ] || exit 1
