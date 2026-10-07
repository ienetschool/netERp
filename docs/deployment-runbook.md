# Deployment runbook — netERp on the Plesk host

Operational procedure for building, deploying, and rolling back the netERp monorepo on
the production Plesk host. This is the concrete companion to
[CLAUDE.md](CLAUDE.md) §73 and the topology in §73.9. See
[deployment-db-conflict.md](deployment-db-conflict.md) and
[adr/0006-production-database-target.md](adr/0006-production-database-target.md) for the
PostgreSQL-vs-MariaDB decision.

> **Secrets policy.** No credentials, `DATABASE_URL` values, or JWT secrets appear in
> this document or anywhere in git. They live only in the host `.env` files. Never copy
> them back into the repository (CLAUDE.md §73.8).

## 1. Target environment

| Item                     | Value                                                         |
| ------------------------ | ------------------------------------------------------------- |
| Public URL               | `https://erp.ienet.online`                                    |
| Host                     | Plesk Obsidian, AlmaLinux 9.x (`76.13.98.31`)                 |
| SSH                      | key-based, host alias `neterp-plesk` (see `~/.ssh/config`)    |
| Checkout / build root    | `/var/www/vhosts/ienet.online/erp.ienet.online/app`           |
| DocumentRoot             | `/var/www/vhosts/ienet.online/erp.ienet.online`               |
| Reverse-proxy directives | `/var/www/vhosts/system/erp.ienet.online/conf/vhost_ssl.conf` |
| pm2 process list         | `app/ecosystem.config.js` → `/root/.pm2/dump.pm2`             |
| Logs                     | `/var/log/neterp/{api,web}.{out,err}.log`                     |
| Runtime                  | Node.js 20.x, npm 10.x, pm2 7.x, no Redis, no gcc             |

Runtime topology (one reverse-proxy rule to port 3000 is enough, because Next.js fronts
`/api/v1/*` itself):

```text
nginx :443 → Apache (loopback) → neterp-web (:3000) → neterp-api (:4000) → Supabase Postgres
```

Neither Node process is exposed publicly; both bind loopback.

## 2. Prerequisites

- The production database is **PostgreSQL** (Supabase, session pooler). The `DATABASE_URL`
  in `apps/api/.env` **must include** `connection_limit=5`. Without it Prisma opens
  `cpus*2+1` connections and the session pooler rejects them with
  `(EMAXCONNSESSION) max clients reached`, surfacing as HTTP 500s on
  `/api/v1/workflow/approval-tasks` and friends.
- A successful build needs `NODE_OPTIONS=--max-old-space-size=4096` (the build helper
  scripts already set this).
- Never run `npm run build -w @erp/web` on the host while a `next dev` server is running,
  and never edit the Plesk-generated `httpd.conf` / `nginx.conf` — they are regenerated.

## 3. Deploy a new revision

All commands run from a machine that has the `neterp-plesk` SSH alias and the local
checkout. `$APP` below is the host build root.

### 3.1 Sync source

The host copy is **not** a git checkout; it is a fresh copy of the working tree.
Synchronize the build inputs (exclude local artifacts so the host does its own install
and build):

```bash
APP=/var/www/vhosts/ienet.online/erp.ienet.online/app

# Preferred: the tracked helper does a guarded dry run first and refuses to delete
# anything on the server, then performs the real sync.
scripts/deploy-sync.sh neterp-plesk "$APP"

# Equivalent manual command:
rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude '.next' \
  --exclude 'dist' --exclude 'data' --exclude '.freebuff' \
  --exclude '.env' --exclude '.env.bak.*' --exclude '*.tsbuildinfo' \
  --exclude 'coverage' --exclude 'uploads' --exclude '.DS_Store' \
  --exclude 'build.sh' --exclude 'ecosystem.config.js' \
  ./ neterp-plesk:"$APP"/
```

**Host-only artifacts — never let `--delete` remove these.** `build.sh`,
`ecosystem.config.js`, `.env`, `apps/api/.env`, and `data/` exist _only_ on the host (they
are absent from the repo and untracked), so an unguarded `--delete` sync silently wipes
them. `rsync` protects excluded paths from deletion, which is why every one of them must
appear in the exclude list. Always dry-run first (`--dry-run --itemize-changes`) and
confirm that no `*deleting` line names a host-only file.

After the sync, verify the guards held:

```bash
ssh neterp-plesk "ls -l $APP/build.sh $APP/ecosystem.config.js $APP/.env $APP/apps/api/.env"
ssh neterp-plesk "grep -c connection_limit $APP/apps/api/.env"   # expect 1
```

### 3.2 Build on the host

```bash
ssh neterp-plesk "$APP/build.sh"
```

`build.sh` runs `npm ci --no-audit --no-fund`, `npm run db:generate`, then
`npm run build`, logging to stdout (tee it to `/var/log/neterp-build.log` if desired).

Only the packages that actually need it: when the changes are confined to `apps/web`
(and `package-lock.json` is untouched), skip the full `build.sh` and go straight to §3.3 —
`npm ci` and the API build add minutes for nothing. Run the full `build.sh` whenever an
API, `packages/*`, or dependency change is part of the revision.

### 3.3 Rebuild the web bundle with the local API URL

The web rewrite destinations are baked into `.next` at build time, so the web app must
be built with `API_URL=http://127.0.0.1:4000`:

```bash
ssh neterp-plesk /root/neterp-webbuild.sh
```

### 3.4 Copy static assets into the standalone output

Next.js `output: 'standalone'` does **not** copy `.next/static` (or `public`, if one
exists) — the standalone server will render without CSS/JS unless these are placed
manually:

```bash
STANDALONE=$APP/apps/web/.next/standalone/apps/web
rsync -a --delete "$APP/apps/web/.next/static/" "$STANDALONE/.next/static/"
[ -d "$APP/apps/web/public" ] && rsync -a --delete "$APP/apps/web/public/" "$STANDALONE/public/"
```

### 3.5 Ensure the reverse-proxy config is present

`vhost_ssl.conf` must contain:

```apache
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "https"
ProxyPass / http://127.0.0.1:3000/ retry=0
ProxyPassReverse / http://127.0.0.1:3000/
```

The Plesk-generated `httpd.conf` only `Include`s this file **after** a reconfigure, so
after writing it run:

```bash
ssh neterp-plesk '/usr/local/psa/admin/bin/httpdmng --reconfigure-domain erp.ienet.online'
ssh neterp-plesk 'httpd -t && nginx -t'
```

Confirm inclusion with `grep -n vhost_ssl /var/www/vhosts/system/erp.ienet.online/conf/httpd.conf`
(expect an `Include` line). Only re-run the reconfigure if the file changed.

### 3.6 Restart the processes

```bash
ssh neterp-plesk 'pm2 reload ecosystem.config.js --update-env || pm2 restart ecosystem.config.js --update-env'
ssh neterp-plesk 'pm2 save'
```

Use `--update-env` whenever `.env` values changed. `pm2 save` refreshes
`/root/.pm2/dump.pm2`; `pm2-root.service` is enabled and restores the list on boot.

### 3.7 Smoke tests

Run from anywhere with network access:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://erp.ienet.online/login
curl -sS https://erp.ienet.online/api/v1/health/live
curl -sS -o /dev/null -w '%{http_code}\n' https://erp.ienet.online/api/v1/health/ready
```

Expected: `/login` → `200`, health endpoints → `200` with `{"data":{"status":"up"}}`.
Then authenticate with a real account and confirm a token is returned:

```bash
curl -sS -X POST https://erp.ienet.online/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"<admin-email>","password":"<password>"}' -o /dev/null -w '%{http_code}\n'
```

Expected `201`. Finally, sign in through the browser form and confirm the redirect to
`/dashboard`. Watch `pm2 logs` / `/var/log/neterp/api.err.log` for new `PrismaClient…`
or `EMAXCONNSESSION` lines during the checks.

## 4. Continuous deployment (GitHub Actions)

[.github/workflows/deploy.yml](../.github/workflows/deploy.yml) ships every push to
`main` to the live host. It runs the same steps as §3, so a manual deploy is only needed
as a fallback.

```text
push to main
  → verify (npm ci, prisma generate, typecheck, lint, unit tests, deploy guard tests)
  → rsync working tree to $APP      (scripts/deploy-sync.sh, deletion-guarded)
  → build + restart on the host     (scripts/deploy-host.sh)
  → smoke test :3000/login and :4000/api/v1/health/live
```

`scripts/deploy-host.sh` runs the host `build.sh` (falls back to inline steps if it is
missing), rebuilds the web bundle with `API_URL=http://127.0.0.1:4000`, copies
`.next/static` into the standalone output, reloads pm2, and fails the pipeline if the
smoke test does not return `200`. It also warns when `connection_limit=` is missing from
`apps/api/.env`.

### 4.1 One-time setup

1. Wire the checkout to GitHub and push `main`: run `bash scripts/setup-github.sh` and
   follow the steps it prints (see §4.4).
2. Add repository secrets under **Settings → Secrets and variables → Actions**:

   | Secret                         | Value                                                                                   |
   | ------------------------------ | --------------------------------------------------------------------------------------- |
   | `SSH_PRIVATE_KEY`              | Private key that logs in to the host (the `IdentityFile` from the `neterp-plesk` alias) |
   | `SSH_HOST`                     | `76.13.98.31`                                                                           |
   | `SSH_USER`                     | `root`                                                                                  |
   | `SSH_KNOWN_HOSTS` _(optional)_ | Output of `ssh-keyscan -H 76.13.98.31`; fetched automatically when unset                |

3. Run the workflow once with **Actions → Deploy → Run workflow** to confirm it succeeds.

Secret values are never printed or committed; paste them from the machine that already
has host access. Use a dedicated deploy key rather than a personal key.

### 4.2 Remote configuration

The build root is **not** a git checkout, so deploys use `rsync` over SSH instead of
`git pull`. That keeps the host-only artifacts (`build.sh`, `ecosystem.config.js`,
`.env`, `apps/api/.env`, `data/`) untouched, because `scripts/deploy-sync.sh` excludes
them and both the script and the workflow abort if a sync would delete any remote file.

A local fallback is always available: `scripts/deploy-sync.sh` and
`ssh neterp-plesk "bash <APP>/scripts/deploy-host.sh"` — the same two commands the
workflow runs.

From a Mac with SSH access to the host, one command runs all three steps:

```bash
npm run deploy:live          # = bash scripts/deploy-local.sh
```

It syncs (deletion-guarded), builds and restarts on the host, then smoke-tests
`/api/v1/health/live` and `/login` **through the public domain**, so it measures the
same path a real user takes. The script needs nothing from GitHub, so a deploy is
possible even if the Actions secrets are not configured yet. It exits non-zero on any
failed step, including a non-200 from the domain.

### 4.3 Data

Local development and production point at the **same Supabase PostgreSQL database**, so
there is no replication step and no data-sync job to run: a change made locally is
immediately visible in production and the other way round. Schema changes still need
`npm run db:migrate:deploy` to be applied to that shared database.

Check that rather than trusting it:

```bash
npm run verify:shared-db
```

It reads rows through the local `apps/api/.env` `DATABASE_URL`, then asks the live API for
the same rows and compares `id` and `updatedAt`. It writes nothing on either side, so it
is safe against production, and it exits non-zero if the two sides stop agreeing — which
is what a second database, or a local Postgres in `DATABASE_URL`, would look like.

The flip side of one shared database: **running the API locally writes to production**, so
there is no sandbox behind a local dev session. Point `DATABASE_URL` at a local Postgres
before doing anything destructive.

### 4.4 Checkout wiring and auto-push

`bash scripts/setup-github.sh` (`npm run github:setup`) makes a checkout ready to push:
it scans tracked files for leaked credentials, sets the commit identity if absent, points
`origin` at the repository, verifies a push credential, and installs three git hooks — a
`pre-commit` secret guard, a `pre-push` secret guard, and a `post-commit` auto-pusher. All
three hook bodies are version-controlled in `scripts/git-hooks/` and copied into
`.git/hooks/`, so the code that runs on every commit and every push is reviewable and
covered by `npm run test:deploy`.

```bash
npm run github:setup                              # verify + install the hook (disabled)
npm run github:setup -- --check-secrets           # scan tracked files only, then stop
npm run github:setup -- --status                  # report only, change nothing
npm run github:setup -- --token --push            # push over HTTPS with a fine-grained PAT
npm run github:setup -- --auto-push               # enable auto-push after the checks pass
```

**Credential scan.** Step 1 refuses to continue if a _tracked_ file looks like it holds a
credential — a Postgres connection URL carrying an inline username and password and
pointing anywhere but a local dev host, a private-key block, a GitHub or AWS key literal,
a Supabase pooler endpoint, or a Supabase project ref named in prose. Ignored files (`.env`, `data/`) are expected to hold
real credentials and are never pushed. The patterns are POSIX ERE, because BSD `grep` has
no `-P`, and matching findings are masked before they are printed. This scan is why a
public repository is acceptable: it is the gate, not the repository's visibility.

A single line can opt out with the marker `secret-guard:allow-synthetic`. That exists
because a scanner needs fixtures that look exactly like what it detects; only the marked
line is skipped, so an unmarked secret in the same file still fires. Adding the marker is
deliberate and shows up in review.

**Transports.** SSH uses the deploy key at `~/.ssh/id_ed25519_github`, which GitHub
accepts only after it is registered as a **deploy key with write access** at
`https://github.com/<owner>/<repo>/settings/keys`; until then every push fails with
`Permission denied (publickey)`. HTTPS uses a fine-grained PAT (`--token`, read from
`$GH_TOKEN`/`$GITHUB_TOKEN` or pasted on stdin) needing **Contents: Read and write**.
The PAT is verified against the API, then handed to the platform credential helper
(macOS keychain) so later pushes are silent. It is never written to `.git/config`, never
embedded in the remote URL, and never printed, and it is only stored once the API has
vouched for it.

**The `post-commit` auto-push hook** is **inert until enabled**: it pushes the current
branch after each commit only while `git config neterp.autopush` is `true`, and a failed
push prints a reminder instead of failing the commit — losing a push must never cost a
commit. `--auto-push` refuses to enable it unless both gates pass: a clean credential scan
and a `git push --dry-run` that actually succeeds. Disable with
`git config --unset neterp.autopush`; remove with `rm .git/hooks/post-commit`. The first
keychain access from the hook may raise a macOS permission prompt.

**The `pre-commit` secret guard** runs the step-1 scan before every commit and blocks the
commit if it finds anything, so a credential cannot enter the history of a public
repository. It is quiet on a clean commit — a hook that chatters gets disabled, and a
disabled hook protects nothing. Escape hatches: `git commit --no-verify` for one commit,
`git config neterp.secretguard false` to switch it off. Re-install all hooks with
`npm run github:setup`.

**The `pre-push` secret guard** covers what `pre-commit` structurally cannot. `pre-commit`
sees only the working tree, so a value committed once and deleted in the next commit looks
clean there — yet both objects are still uploaded, and on a public repository the exposure
is permanent, because deleting the commit afterwards does not unpublish it. The push guard
scans **commits**, not the tree, over exactly the range a push would send: it reads git's
stdin contract (`<local ref> <local sha> <remote ref> <remote sha>`) and diffs each local
sha against the remote sha the remote already has, so a long history costs nothing. For a
ref the remote does not have yet there is no boundary to diff against, so it excludes
everything reachable from a remote ref (`--not --remotes`) instead — which also keeps an
already-published value from blocking every future branch forever, since it cannot be
unpublished anyway. The scan itself is the same code path as the manual check
(`--check-commits`, shared with step 1), so the two can never drift apart, and it fails
**open**: an unreadable revision or a shallow clone must not turn into a blocked push on
an unrelated branch. Escape hatches are the same: `git push --no-verify` for one push,
`git config neterp.secretguard false` to switch it off.

A push that the guard refuses prints the matching `<sha>:<path>:<line>` and then
`REFUSING to continue: a commit above would publish a credential.` The recovery is to get
the value out of the unpushed commits — rewrite them, or reset to what the remote already
has and drop the value in a single new commit — **not** to reach for `--no-verify`.
`npm run github:setup -- --check-commits <revs>` runs the same scan by hand, e.g.
`--check-commits --all --not --remotes` to sweep every unpushed commit before a first push.

### 4.5 Deploy safety tests

```bash
npm run test:deploy          # = bash scripts/test-deploy-guards.sh
```

Runs in the workflow's `verify` job before anything is shipped, and needs no server
access. It exercises the **real** scripts against a scratch directory and fails the
build if:

- a sync that would delete a remote file does not abort (the guard protects `build.sh`,
  `.env`, `apps/api/.env`, `ecosystem.config.js` and `data/`)
- the guard fires on a clean sync, which would block every deploy
- an excluded host-only artifact is removed, or a changed file is not copied
- `deploy-host.sh` accepts a directory that is not the source tree
- `deploy-host.sh` exits 0 while the app it just restarted is never healthy. The host
  smoke test is driven with stub tools injected through `BASH_ENV` — the script overwrites
  `PATH`, so shell functions are what make it testable without a test-only seam — and a
  failing run must exit non-zero and must never print a success line
- the standalone web build is missing `.next/static` or `public`. Next.js does not copy
  them into the standalone output, so the app 404s its own assets until they are copied in
- the pool warning fires on a healthy `.env`, or fails a deploy that is otherwise fine.
  A missing `connection_limit` deserves a loud warning, not a blocked deploy
- a GNU-only `date` flag reappears (BSD/macOS `date` has no `-Is`)
- a command substitution is put back inline inside an `echo`, where `set -e` cannot
  abort on its failure — the defect that once let a broken deploy exit 0
- the credential scan stops matching. Each pattern is driven with a synthetic secret that
  must fire (pooled database password, GitHub token, AWS key, private-key header, Supabase
  pooler host) and a localhost URL that must not, because a pattern that silently stopped
  matching is a false all-clear — exactly how a real leak reaches a public repository
- the auto-push hook pushes before it is armed, stops pushing once armed, or fails a
  commit when the push fails
- the pre-commit guard lets a marked fixture hide an unmarked secret in the same file
- the pre-push guard misses a leak that exists only in history — the value committed once
  and deleted in the next commit, which the working tree no longer holds. The fixture
  builds that exact pair and asserts the push is refused, explains itself, and puts
  nothing on the remote, while the manual `--check-commits` scan and a new branch whose
  only leak is already published both stay allowed, an empty ref list is a no-op, an
  unreadable revision fails open, `--no-verify` overrides, and `neterp.secretguard false`
  disarms it

Each of these was checked by mutating the script under test and confirming the suite goes
red, so the assertions are known to fail on the defect rather than merely pass on the
current code.

`deploy-sync.sh` accepts the literal target `local` to sync into a directory on this
machine instead of over SSH. That is what makes the guard testable, and it doubles as a
way to rehearse a sync locally without touching the host:

```bash
SOURCE="$PWD" bash scripts/deploy-sync.sh local /tmp/neterp-rehearsal
```

## 5. Rollback

Backups are kept under `/root/` on the host. To roll back:

1. **Code** — restore the previous build root from its backup copy (or re-sync the prior
   revision and repeat §3.2–§3.6).
2. **Config** — `.env` files were backed up with a suffix before edits; restore the
   wanted one, then `pm2 restart … --update-env`.
3. **Reverse proxy** — restore the prior `vhost_ssl.conf` and re-run the
   `httpdmng --reconfigure-domain` + `httpd -t / nginx -t` pair.
4. Re-run the §3.7 smoke tests.

Because the database schema is managed by Prisma migrations, a rollback that spans a
migration requires a matching down-migration or a database restore — coordinate with the
database owner before reverting an application version that changed the schema.

## 6. Maintenance notes

- **Logs.** Log rotation is configured in `/etc/logrotate.d/neterp` (weekly, rotate 4,
  compress, `copytruncate`). pm2 uses `merge_logs`, so the process prefix is blank in these
  files; prefer `pm2 logs` / `pm2 flush` over grepping the rotated files directly.
- **Worker.** The BullMQ worker (`apps/worker`) is intentionally not deployed — it
  requires Redis. Any feature depending on it (scheduled jobs, outbox relay) is inert in
  production until Redis is provisioned.
- **DocumentRoot hygiene.** The DocumentRoot root must contain only `app/`. Do not leave
  setup scripts, credentials, or a stray `.git` there — they would be publicly served.
  Any leftovers belong in `/root/neterp-docroot-backup-*`.
- **Uploads.** With `OBJECT_STORAGE_DRIVER=local`, uploaded documents live under
  `<checkout>/data/documents`; that directory is excluded from the source sync and must
  be preserved.
