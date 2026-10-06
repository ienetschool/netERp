#!/usr/bin/env bash
# One-time GitHub wiring for this checkout, plus opt-in auto-push.
#
#   bash scripts/setup-github.sh              # verify everything, install the hook (disabled)
#   bash scripts/setup-github.sh --auto-push  # enable the hook (only once the repo is private)
#   bash scripts/setup-github.sh --status     # report only, change nothing
#
# Auto-push sends every commit to origin. It is OFF until you enable it, because
# docs/adr/0006-production-database-target.md names the production database
# project, so the repository must be private before any push happens:
#   https://github.com/ienetschool/netERp/settings  ->  Danger Zone -> Change visibility
#
# The verifying half of this script is read-only and safe; it never pushes.
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$PATH"

REPO_SLUG="${REPO_SLUG:-ienetschool/netERp}"
REMOTE_URL="${REMOTE_URL:-git@github.com:$REPO_SLUG.git}"
KEY="${KEY:-$HOME/.ssh/id_ed25519_github}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

MODE="setup"
for arg in "$@"; do
  case "$arg" in
    --auto-push) MODE="enable" ;;
    --status) MODE="status" ;;
    -h | --help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown argument: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT"

echo "== 1/5 commit identity =="
if ! git config --get user.name >/dev/null || ! git config --get user.email >/dev/null; then
  git config user.name "BK"
  git config user.email "inc@BKs-MacBook-Air.local"
  echo "   set local identity (BK <inc@BKs-MacBook-Air.local>)"
fi
echo "   $(git config --get user.name) <$(git config --get user.email)>"

echo "== 2/5 origin =="
if git remote get-url origin >/dev/null 2>&1; then
  current="$(git remote get-url origin)"
  if [ "$current" != "$REMOTE_URL" ]; then
    echo "   origin was $current, repointing to $REMOTE_URL"
    git remote set-url origin "$REMOTE_URL"
  else
    echo "   origin $REMOTE_URL"
  fi
else
  git remote add origin "$REMOTE_URL"
  echo "   origin added: $REMOTE_URL"
fi
# A fresh branch has no upstream; let the first push create it.
git config push.autoSetupRemote true

echo "== 3/5 SSH key =="
if [ ! -f "$KEY" ]; then
  echo "   ERROR: $KEY is missing. Create it with:" >&2
  echo "     ssh-keygen -t ed25519 -C 'netERp deploy' -f \"$KEY\"" >&2
  exit 1
fi
fingerprint="$(ssh-keygen -lf "$KEY.pub" 2>/dev/null || echo 'unknown')"
echo "   $fingerprint"
if ! grep -qE '^Host[[:space:]]+github\.com' "$HOME/.ssh/config" 2>/dev/null; then
  echo "   WARNING: ~/.ssh/config has no 'Host github.com' block for this key." >&2
  echo "   Add:" >&2
  echo "     Host github.com" >&2
  echo "       IdentityFile $KEY" >&2
  echo "       IdentitiesOnly yes" >&2
fi

echo "== 4/5 GitHub authorization =="
authed=false
# ssh -T always exits 255 on GitHub, so read the banner instead of the status.
if ssh -o BatchMode=yes -o ConnectTimeout=10 -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
  authed=true
  echo "   authorized"
else
  echo "   NOT authorized yet: git@github.com: Permission denied (publickey)"
fi

visibility="unknown"
if [ "$authed" = true ] || [ "$MODE" = "status" ]; then
  if curl -fsS -o /dev/null --max-time 15 "https://github.com/$REPO_SLUG" 2>/dev/null; then
    visibility="public"
  else
    visibility="private (or unreachable)"
  fi
  echo "   repository $REPO_SLUG looks $visibility"
  if [ "$visibility" = "public" ]; then
    cat >&2 <<EOM
   !! The repository is still PUBLIC and the first push has not happened.
   !! Make it private before pushing, then push once by hand:
   !!   https://github.com/$REPO_SLUG/settings  ->  Danger Zone -> Change visibility -> Private
   !!   git push -u origin main
EOM
  fi
fi

HOOK="$ROOT/.git/hooks/post-commit"
if [ "$MODE" = "status" ]; then
  echo "== 5/5 auto-push hook (--status: not writing) =="
  if [ -f "$HOOK" ]; then
    echo "   installed"
  else
    echo "   not installed"
  fi
  if git config --get neterp.autopush >/dev/null; then
    echo "   auto-push: enabled"
  else
    echo "   auto-push: disabled"
  fi
  exit 0
fi

echo "== 5/5 auto-push hook =="
cat > "$HOOK" <<'EOM'
#!/usr/bin/env bash
# Installed by scripts/setup-github.sh. Pushes the current branch after each
# commit, but only when neterp.autopush is true, so it is inert by default.
# Disable:  git config --unset neterp.autopush     Remove:  rm .git/hooks/post-commit
if [ "$(git config --get neterp.autopush || true)" != "true" ]; then
  exit 0
fi
branch="$(git rev-parse --abbrev-ref HEAD)"
if git push --quiet --no-progress origin "$branch" >/dev/null 2>&1; then
  echo "[auto-push] $branch -> origin"
else
  echo "[auto-push] push of $branch failed; run: git push origin $branch" >&2
fi
exit 0
EOM
chmod +x "$HOOK"
echo "   installed $HOOK"

if [ "$MODE" = "enable" ]; then
  if [ "$visibility" = "public" ]; then
    echo "   REFUSING to enable auto-push while $REPO_SLUG is public." >&2
    echo "   Make it private, then re-run: bash scripts/setup-github.sh --auto-push" >&2
    exit 1
  fi
  if [ "$authed" != true ]; then
    echo "   REFUSING to enable auto-push: GitHub still rejects this key." >&2
    echo "   Add the key below as a deploy key with write access, then re-run." >&2
    exit 1
  fi
  git config neterp.autopush true
  echo "   enabled: every commit will now push to origin"
elif git config --get neterp.autopush >/dev/null; then
  echo "   auto-push: enabled"
else
  echo "   auto-push: disabled (safe default)"
fi

cat <<EOM

-- next steps ---------------------------------------------------------------
1. Deploy key, with "Allow write access" ticked:
     https://github.com/$REPO_SLUG/settings/keys
   $(cat "$KEY.pub")
2. Make the repository private:
     https://github.com/$REPO_SLUG/settings  ->  Danger Zone -> Change visibility
3. First push (once 1 and 2 are done):
     git push -u origin main
4. Enable auto-push:
     bash scripts/setup-github.sh --auto-push
5. Actions secrets for .github/workflows/deploy.yml:
     SSH_PRIVATE_KEY  = contents of ~/.ssh/neterp_deploy
     SSH_HOST         = 76.13.98.31
     SSH_USER         = root
EOM
