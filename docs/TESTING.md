# Testing & Checks

Each package is checked independently. Run commands from inside the relevant package directory.

## Backend (`backend/`)

Tooling: **Vitest** (test runner) + **Supertest** (HTTP assertions) + **mongodb-memory-server** (in-memory MongoDB so tests need no real database). Type-checking is `tsc --noEmit` against the JS sources with `checkJs` + JSDoc annotations (config in `backend/tsconfig.json`).

```bash
cd backend
npm run lint        # eslint .
npm run typecheck   # tsc --noEmit  (checkJs over src/**/*.js via JSDoc)
npm test            # vitest run
```

Run all three at once:

```bash
cd backend
npm run check       # lint && typecheck && test
```

Other test scripts: `npm run test:watch` (`vitest`), `npm run test:coverage` (`vitest run --coverage`).

Vitest config: `backend/vitest.config.js`. `tsconfig.json` excludes `tests` and `**/*.test.js` from type-checking.

## Frontend (`frontend/`)

Tooling: **Vitest** + **React Testing Library**.

```bash
cd frontend
npm run lint        # eslint .
npm test            # vitest run
```

> The frontend has no `typecheck` step (no TypeScript) and no `npm run check` aggregate — lint and test are the gates.

## Notes

- Test files are maintained alongside the code; this doc describes the **tooling and commands**, not a file-by-file inventory.
- There is no aggregate test command at the repo root; run the backend and frontend checks separately.

## Continuous Integration

GitHub Actions runs these same checks on every push to `main`, every pull request, and on demand (`workflow_dispatch`). Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Node 22, dependencies installed with `npm ci` against each package's lockfile.

| Job | Working dir | Steps | Gate |
| --- | --- | --- | --- |
| **Backend** | `backend/` | `npm run lint` → `npm run typecheck` → `npm test` | blocking |
| **Frontend** | `frontend/` | `npm run lint` → `npm test` → `npm run build` | blocking |
| **Dependency audit** | `backend/` + `frontend/` (matrix) | `npm audit --audit-level=high` | blocking |

Both packages are currently clean (`npm audit` → 0 vulnerabilities), so the audit job is a **blocking gate**: a newly introduced high/critical advisory fails CI. Because advisories can be published against an already-installed dependency with no code change, this job can occasionally go red on its own — triage by running `npm audit fix` (or bumping the offending dep). If no upstream fix exists yet, temporarily relax `--audit-level` or re-add `continue-on-error: true` to the `security-audit` job until it's resolved.
