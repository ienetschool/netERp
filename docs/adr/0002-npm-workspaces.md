# ADR-0002: npm workspaces (no pnpm, no Turborepo)

**Status:** Accepted

## Context
The development environment provides Node 24 + npm 11 only (no pnpm, no Docker-based
tooling). npm 11 blocks package lifecycle scripts unless explicitly approved.

## Decision
Use native npm workspaces for the monorepo, with a root `allowScripts` allow-list
approved via `npm install-scripts approve`. Keep task running simple
(`npm run <gate> --workspaces --if-present`); do not add Turborepo or Nx yet.

## Consequences
- Zero extra toolchain; works in the target environment as-is.
- Workspace builds are sequential; acceptable at current size, revisit if CI time grows.
- Lifecycle-script approval is explicit and auditable in root `package.json`.
