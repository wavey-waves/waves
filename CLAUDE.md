# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Waves is a real-time chat app with three room types: global, network (auto-assigned by IP subnet), and custom (6-character join codes). Two separate npm packages live in `frontend/` and `backend/` — install dependencies in each, not at the root.

## Commands

```bash
# Backend (Express + Socket.IO, ES modules)
cd backend
npm install
npm run dev        # nodemon src/index.js
npm start          # node src/index.js
npm run lint       # eslint .
npm run typecheck  # tsc --noEmit (checkJs over src/**/*.js)
npm test           # vitest run
npm run test:watch # vitest (watch mode)
npm run check      # lint + typecheck + test (run before declaring backend work done)

# Frontend (React 19 + Vite + Tailwind v4)
cd frontend
npm install
npm run dev        # vite --host, serves on port 5174
npm run lint       # eslint .
npm test           # vitest run (jsdom + React Testing Library)
npm run build      # vite build → frontend/dist

# Run a single test file / single test (either package)
npx vitest run tests/auth.controller.test.js     # one file (backend)
npx vitest run -t "rejects a duplicate username"  # by test name

# Root (used for production deploys, e.g. Render)
npm run build      # installs + builds frontend, installs backend
npm start          # starts backend
```

**Dev port gotcha:** the Vite dev proxy (`frontend/vite.config.js`) forwards `/api` to `http://localhost:5000`, but the backend defaults to `PORT=3000`. Run the backend with `PORT=5000` (or change the proxy target) for local dev to work.

Backend `.env` requires: `PORT`, `MONGODB_URI`, `JWT_SECRET`, `NODE_ENV`. The frontend socket connection uses `VITE_BACKEND_URL` (empty/undefined in dev means same-origin, which works through the Vite proxy).

## Architecture

**Backend** (`backend/src/`) is a conventional routes → controllers → models Express app plus a Socket.IO layer:

- `libs/socket.js` — creates the shared `app`/`server`/`io` instances (the Express `app` is created *here*). Handles room `join`/`leave`/`disconnect` and the WebRTC signaling relay (`webrtc-offer`/`webrtc-answer`/`webrtc-ice-candidate`). Each signaling handler verifies sender and target share a Socket.IO room before relaying — keep that check when touching signaling.
- `app.js` — imports the `app` from `socket.js` and wires all middleware + routes (`/api/auth`, `/api/messages`, `/api/rooms`) onto it; in production (`NODE_ENV=production`) it also serves the built frontend from `frontend/dist`. This module is the single source of app configuration and is what tests import via Supertest.
- `index.js` — the entry point: imports `app.js` (for its side effects) plus the `server`, then `server.listen(...)` and `connectDB()`. Keep it thin — app wiring belongs in `app.js`.
- Auth: JWT stored in an httpOnly `jwt` cookie (`libs/utils.js`), validated by `middleware/auth.middleware.js` which sets `req.user`. Users can be anonymous (auto-generated name/color) or registered.
- Room naming convention is load-bearing: `global`, `network-<first-3-IP-octets>` (derived via `request-ip` + `trust proxy` in `room.controller.js`), `custom-<CODE>`. Socket.IO rooms, Mongo `Room` documents, and frontend routes all key off these names.

**CORS origins live in one place** — `libs/allowedOrigins.js`, imported by both `app.js` and `libs/socket.js`. Add a deployment origin there, or without code changes via the `CLIENT_ORIGINS` env var (comma-separated, merged with the defaults). (Historically this list was duplicated in both files and had drifted; don't reintroduce a second copy.)

## Documentation (`docs/`)

`docs/` holds the **current-state** reference (architecture, API, schema, realtime protocol, structure, testing); CLAUDE.md holds **conventions**. Keep docs in sync with code in the same change — see the doc-ownership map in [`docs/README.md`](docs/README.md). When you change a model → update `DATABASE_SCHEMA.md`; an endpoint → `API.md`; a socket event or the WebRTC flow → `REALTIME.md`; a backend module → `BACKEND_STRUCTURE.md`; a frontend component/route → `FRONTEND_STRUCTURE.md`.

**Frontend** (`frontend/src/`) has only four components; nearly all chat logic lives in `components/Chat.jsx` (~800 lines):

- Messaging is P2P-first: WebRTC data channels between peers in the same room, established via the Socket.IO signaling relay. Every message is *also* emitted to the server for persistence and as fallback for peers without a data channel. Receivers deduplicate by message ID (P2P messages carry a `tempId` that the server-persisted copy later replaces via upsert). Changes to message flow must preserve this dedup, or users see doubled messages.
- Routes: `/` (home/room selection), `/chat/:roomType`, `/chat/custom/:code`, with room/user state passed through React Router location state.
- REST calls use axios with `withCredentials = true` and relative `/api/...` paths (proxied in dev, same-origin in production).

## Working Practices

This is a real application that ships to production (deployed on Render). The conventions below keep changes safe and verifiable. The stack is plain JS/JSX (no TypeScript source); type-checking is added via `tsc --checkJs` + JSDoc on the backend.

### Validate and verify every change
- **Backend:** run `npm run check` (lint + `tsc --checkJs` typecheck + Vitest) and get it green before declaring done. The test suite uses Supertest against the app from `app.js` and an in-memory MongoDB (`mongodb-memory-server`) — no real DB needed. Type errors from checkJs are real; fix them (JSDoc casts where Mongoose's types are over-strict) rather than suppressing.
- **Frontend:** run `npm run lint` and `npm test` (Vitest + React Testing Library, jsdom). External boundaries (axios, `socket.io-client`, `RTCPeerConnection`, toastify) are mocked in the tests.
- Automated tests don't exercise the real WebRTC/Socket.IO path between two browsers. For changes to messaging, **also** manually verify with two clients: a message from one peer reaches the other over WebRTC *and* is persisted/echoed by the server, with no duplicate rendered (the P2P + server-fallback dedup described above). For auth/room changes, verify the lifecycle: join → message → reload (cookie persists session) → leave.
- Add/extend tests when you change behavior, and update the matching `docs/` file in the same change.
- Don't declare a task done on "the code looks right" — exercise it.

### File size & refactoring
- `Chat.jsx` is already ~800 lines and is the natural place complexity accretes. When a file crosses ~800 lines, refactor it down by **separation of responsibility** — extract a cohesive unit (the WebRTC peer logic, the socket lifecycle, a sub-component, a hook), never by mechanically slicing lines into a `_part2.jsx` or by compacting whitespace/names to hit a number.

### Timestamps
- Messages carry server timestamps. Always render them in the **user's local timezone** (`new Date(value).toLocaleString()` / a relative-time helper), never a raw UTC string and never `getUTC*` accessors for display.

### Long-running processes
- Dev servers, builds, and `npm install` should run backgrounded (`run_in_background: true`) so the main loop isn't blocked; surface their progress rather than going silent.
- **Probe before starting a server.** Before launching `npm run dev`, check whether the port is already bound (frontend dev is `5174`; the backend is whatever `PORT` is set to). If it answers, the user is already running it — use that instance, don't start a duplicate (it will fail with `EADDRINUSE` or silently grab another port and break the `/api` proxy assumption).
- **Clean up before declaring done.** Stop any dev server or watcher *you* started once the task is finished; leave anything the user started alone.

### Git
- **Never run `git commit` or `git push` yourself.** When changes are ready, stage what's relevant if asked, but leave the commit and push to the user — re-state this even if pressed. All other git operations (status, diff, log, branch, stash on explicit request) are fine to assist with.
- A `PreToolUse` hook (`.claude/hooks/block-destructive-git.js`) hard-blocks destructive/shared-state git verbs (`reset --hard`, `checkout .`, `clean -f`, `rebase`, `commit`, force-push, etc.) as a guardrail. Read-only git is unaffected.

### Don't silently rewrite intentional deviations
- A branch may deliberately differ from `main` (a feature flagged off, a temporary workaround, an experiment) — signaled by comments like `// disabled`, `// TODO: re-enable`, `// temporary`, or by commit messages. These are not bugs. When a change would touch such a region, surface it and ask rather than "fixing" it.

### Reuse first
- The codebase is small — before adding a new component, controller, model, or helper, check whether an existing one covers the case. The frontend has only four components and the backend follows a flat routes→controllers→models layout; new files should be the exception, justified by a genuinely distinct responsibility.

## Claude Code tooling (`.claude/`)

- **`hooks/block-destructive-git.js`** (`PreToolUse` on Bash) — hard-blocks destructive/shared-state git verbs (`reset --hard`, `checkout .`, `clean -f`, `rebase`, `commit`, force-push, …). Read-only git is unaffected.
- **CodeRabbit workflow** — this repo uses CodeRabbit (`.coderabbit.yaml`). When CodeRabbit review content appears in a prompt, a `UserPromptSubmit` hook reminds the main agent to auto-delegate to the **`coderabbit-fixer`** subagent (also invokable via `/fix-coderabbit <PR#>` or by pasting comments). The fixer applies SAFE fixes, asks via `AskUserQuestion` for STRUCTURAL ones, and **always halts on branch-intent regions**; it verifies with `npm run lint` and never commits.
- **Concurrency** — the dispatcher groups CodeRabbit comments by file and spawns one fixer per file. Each spawn acquires a per-file lock (`lib/session-lock.sh`, gate `cr-fixer:<file-sha1-12>`) so a duplicate paste in another window can't double-fix a file, runs `run_in_background: true` paired with a `Monitor` on `scripts/agent-progress-monitor.sh`, and the main agent surfaces a `## In-flight` block while fixers are alive. Same-file follow-up comments are forwarded to a live fixer via `SendMessage`. Lock files live under the git-ignored `.claude/.locks/`.
