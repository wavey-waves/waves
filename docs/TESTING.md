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
