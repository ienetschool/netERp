#!/usr/bin/env bash
# One-time GitHub wiring for this checkout, plus opt-in auto-push.
#
#   bash scripts/setup-github.sh                    # verify everything, install the hook (disabled)
#   bash scripts/setup-github.sh --check-secrets    # only scan tracked files for leaked credentials
#   bash scripts/setup-github.sh --token --push     # push over HTTPS with a fine-grained PAT
#   bash scripts/setup-github.sh --auto-push        # enable the hook (needs a clean scan + a working credential)
#   bash scripts/setup-github.sh --status           # report only, change nothing
#
# Two transports are supported:
#
#   SSH    git@github.com:<slug>.git       using the deploy key at $KEY
#   HTTPS  https://github.com/<slug>.git   using a fine-grained PAT (--token), read from
#                                          $GH_TOKEN / $GITHUB_TOKEN or pasted on stdin.
#
# A PAT is never written to .git/config, never embedded in the remote URL, and never
# printed. It is handed to the platform credential helper (macOS keychain), which is
# what lets the auto-push hook work afterwards without the token in the environment.
#
# Auto-push sends every commit to origin. It stays OFF until you enable it, and two
# gates must pass first: no tracked file may contain a credential-looking value, and a
# push credential must actually work. A public repository is fine once the scan passes.
#
# Everything except --push and --auto-push is read-only and safe.
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$PATH"

REPO_SLUG="${REPO_SLUG:-ienetschool/netERp}"
SSH_URL="git@github.com:$REPO_SLUG.git"
HTTPS_URL="https://github.com/$REPO_SLUG.git"
KEY="${KEY:-$HOME/.ssh/id_ed25519_github}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH="main"

MODE="setup"
USE_TOKEN=false
for arg in "$@"; do
  case "$arg" in
    --auto-push) MODE="enable" ;;
    --status) MODE="status" ;;
    --check-secrets) MODE="scan" ;;
    --push) MODE="push" ;;
    --token) USE_TOKEN=true ;;
    -h | --help)
      sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown argument: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT"

# ---------------------------------------------------------------------------
# Credential scan. Tracked files only -- ignored files (.env, data/) are expected
# to hold real credentials and are never pushed.
#
# Portable on purpose: BSD grep has no -P, so every pattern here is POSIX ERE.
# A credentialed URL is matched first, then localhost/dev hosts are filtered out,
# because .env.example and CI both legitimately point at a throwaway local database.
# ---------------------------------------------------------------------------
scan_secrets() {
  local cred='postgres(ql)?://[^:/@[:space:]"]+:[^@[:space:]"]*@[A-Za-z0-9][A-Za-z0-9._-]*'
  local devhost='@(localhost|127\.0\.0\.1|db|postgres|host\.docker\.internal)([:/]|$)'
  local other='BEGIN (RSA |OPENSSH |EC |PGP )?PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|pooler\.supabase\.com|ref `[a-z0-9]{20}`'

  local a b
  a="$( { git ls-files -z | xargs -0 grep -nE "$cred" 2>/dev/null | grep -vE "$devhost"; } || true)"
  b="$( { git ls-files -z | xargs -0 grep -nE "$other" 2>/dev/null; } || true)"

  if [ -n "$a" ] || [ -n "$b" ]; then
    # Mask everything between ":" and "@" so the finding itself is not echoed in full.
    printf '%s\n%s\n' "$a" "$b" | grep -v '^$' | sed -E 's#(://[^:[:space:]]*:)[^@[:space:]]*@#\1***@#g'
    return 1
  fi
  return 0
}

echo "== 1/6 credential scan =="
scan_out="$(scan_secrets || true)"
if [ -z "$scan_out" ]; then
  echo "   clean: no credential-looking values in tracked files"
else
  printf '%s\n' "$scan_out" >&2
  cat >&2 <<'EOM'
   REFUSING to continue: a tracked file above looks like it contains a credential.
   Move the value into .env (git-ignored) or redact it, then re-run.
EOM
  exit 1
fi
if [ "$MODE" = "scan" ]; then exit 0; fi

echo "== 2/6 commit identity =="
if ! git config --get user.name >/dev/null || ! git config --get user.email >/dev/null; then
  if [ "$MODE" = "status" ]; then
    echo "   MISSING (would set BK <inc@BKs-MacBook-Air.local>)"
  else
    git config user.name "BK"
    git config user.email "inc@BKs-MacBook-Air.local"
    echo "   set local identity (BK <inc@BKs-MacBook-Air.local>)"
  fi
fi
name="$(git config --get user.name || echo '(unset)')"
email="$(git config --get user.email || echo '(unset)')"
echo "   $name <$email>"

echo "== 3/6 remote =="
token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [ "$USE_TOKEN" = true ]; then
  if [ -z "$token" ] && [ -t 0 ]; then
    printf '   paste the fine-grained PAT (hidden): ' >&2
    read -r -s token
    echo >&2
  elif [ -z "$token" ]; then
    read -r token || true
  fi
  if [ -z "$token" ]; then
    echo "   ERROR: --token needs a token in \$GH_TOKEN/\$GITHUB_TOKEN, or on stdin." >&2
    exit 1
  fi
  remote="$HTTPS_URL"
else
  remote="$SSH_URL"
fi

if git remote get-url origin >/dev/null 2>&1; then
  current="$(git remote get-url origin)"
  if [ "$MODE" = "status" ]; then
    echo "   origin $current (wanted $remote)"
  elif [ "$current" != "$remote" ]; then
    echo "   origin was $current, repointing to $remote"
    git remote set-url origin "$remote"
  else
    echo "   origin $remote"
  fi
elif [ "$MODE" != "status" ]; then
  git remote add origin "$remote"
  echo "   origin added: $remote"
else
  echo "   origin absent (wanted $remote)"
fi
[ "$MODE" = "status" ] || git config push.autoSetupRemote true

echo "== 4/6 credentials =="
ssh_authed=false
if [ -f "$KEY" ]; then
  if ssh -o BatchMode=yes -o ConnectTimeout=10 -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
    ssh_authed=true
    echo "   SSH deploy key: authorized"
  else
    echo "   SSH deploy key: NOT authorized (git@github.com: Permission denied (publickey))"
  fi
else
  echo "   SSH deploy key: absent ($KEY)"
fi

token_ok=false
if [ -n "$token" ]; then
  body="$(curl -fsS --max-time 20 -H "Authorization: Bearer $token" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$REPO_SLUG" 2>/dev/null || true)"
  if printf '%s' "$body" | grep -qE '"push"[[:space:]]*:[[:space:]]*true'; then
    token_ok=true
    echo "   PAT: valid for $REPO_SLUG with push permission"
  elif printf '%s' "$body" | grep -q '"full_name"'; then
    echo "   PAT: valid for $REPO_SLUG but WITHOUT push permission (needs Contents: Read and write)"
  else
    echo "   PAT: rejected by the API (not verified)"
  fi
  # Only persist a token the API actually vouched for, so a typo is never stored.
  if [ "$token_ok" = true ] && [ "$MODE" != "status" ]; then
    if printf 'protocol=https\nhost=github.com\nusername=%s\npassword=%s\n\n' \
      "x-access-token" "$token" | git credential approve 2>/dev/null; then
      echo "   PAT: stored via '$(git config --get credential.helper 2>/dev/null || echo none)'"
    else
      echo "   PAT: could not hand it to a credential helper" >&2
    fi
  fi
  unset token
fi

if [ "$ssh_authed" = false ] && [ "$token_ok" = false ]; then
  cat >&2 <<EOM
   No working credential. Either:
     1. paste a fine-grained PAT (Contents: Read and write):
          GH_TOKEN=<pat> bash scripts/setup-github.sh --token --push
     2. or add $KEY.pub as a deploy key with write access:
          https://github.com/$REPO_SLUG/settings/keys
EOM
fi

echo "== 5/6 push readiness =="
push_ready=false
probe_ssh="ssh -o BatchMode=yes -o ConnectTimeout=10"
if [ "$ssh_authed" = false ] && [ "$token_ok" = false ] && [ "$MODE" != "setup" ]; then
  echo "   skipped (no verified credential to test)"
else
  if GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="$probe_ssh" \
    git push --dry-run --quiet origin "$BRANCH" >/tmp/netERp-push-probe.$$ 2>&1; then
    push_ready=true
    echo "   'git push --dry-run origin $BRANCH' would succeed"
  else
    echo "   'git push --dry-run origin $BRANCH' failed:"
    sed 's/^/     /' /tmp/netERp-push-probe.$$ >&2
  fi
  rm -f /tmp/netERp-push-probe.$$
fi

if [ "$MODE" = "push" ]; then
  if [ "$push_ready" != true ]; then
    echo "   REFUSING to push: the dry run did not succeed." >&2
    exit 1
  fi
  echo "   pushing $BRANCH -> origin ..."
  GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="$probe_ssh" git push -u origin "$BRANCH"
  echo "   pushed; remote now has:"
  GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="$probe_ssh" git ls-remote --heads origin | sed 's/^/     /'
fi

HOOK="$ROOT/.git/hooks/post-commit"
if [ "$MODE" = "status" ]; then
  echo "== 6/6 auto-push hook (--status: not writing) =="
else
  echo "== 6/6 auto-push hook =="
  cat >"$HOOK" <<'EOM'
#!/usr/bin/env bash
# Installed by scripts/setup-github.sh. Pushes the current branch after each
# commit, but only when neterp.autopush is true, so it is inert by default.
# Disable:  git config --unset neterp.autopush     Remove:  rm .git/hooks/post-commit
[ "$(git config --get neterp.autopush || true)" = "true" ] || exit 0
branch="$(git rev-parse --abbrev-ref HEAD)"
if GIT_TERMINAL_PROMPT=0 git push --quiet --no-progress origin "$branch" >/dev/null 2>&1; then
  echo "[auto-push] $branch -> origin"
else
  echo "[auto-push] push of $branch failed; run: git push origin $branch" >&2
fi
exit 0
EOM
  chmod +x "$HOOK"
  echo "   installed $HOOK"
fi

if [ -f "$HOOK" ]; then echo "   hook: installed"; else echo "   hook: not installed"; fi

if [ "$MODE" = "enable" ]; then
  if [ "$push_ready" != true ]; then
    echo "   REFUSING to enable auto-push: no push credential works yet." >&2
    exit 1
  fi
  git config neterp.autopush true
  echo "   enabled: every commit will now push to origin"
elif git config --get neterp.autopush >/dev/null; then
  echo "   auto-push: enabled"
else
  echo "   auto-push: disabled (safe default)"
fi
[ "$MODE" = "status" ] && exit 0

cat <<EOM

-- next steps ---------------------------------------------------------------
1. Push (creates main on the remote -- it is empty today):
     bash scripts/setup-github.sh --token --push     # PAT over HTTPS
     bash scripts/setup-github.sh --push             # or the SSH deploy key
2. Enable auto-push once the push above worked:
     bash scripts/setup-github.sh --auto-push
3. Actions secrets for .github/workflows/deploy.yml:
     SSH_PRIVATE_KEY  = contents of ~/.ssh/neterp_deploy
     SSH_HOST         = the production host
     SSH_USER         = root
EOM
