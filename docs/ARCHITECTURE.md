# Architecture

Big-picture view of how Waves is laid out and how a message gets from one user to another.

## Monorepo layout

Two independent npm packages live side by side. There is no workspace/root package linking them for dependencies — each is installed separately.

```
waves/
├── frontend/        # React 19 + Vite + Tailwind v4 (separate npm package)
├── backend/         # Express + Socket.IO, ES modules (separate npm package)
├── docs/            # this documentation
├── package.json     # root: production deploy orchestration only (build/start)
├── README.md
└── CLAUDE.md        # conventions for working in this repo
```

The root `package.json` exists only for production deploys (Render). It is `commonjs`-typed and has just two scripts:

- `build` → `npm install --prefix frontend && npm run build --prefix frontend && npm install --prefix backend`
- `start` → `npm run start --prefix backend`

So a single backend process serves everything in production.

## Backend / frontend split

- **Backend** (`backend/src/`) is a conventional Express app: routes → controllers → models, plus a Socket.IO layer. See [BACKEND_STRUCTURE.md](./BACKEND_STRUCTURE.md).
- **Frontend** (`frontend/src/`) is a four-component React SPA; nearly all chat logic lives in `components/Chat.jsx`. See [FRONTEND_STRUCTURE.md](./FRONTEND_STRUCTURE.md).

## The three room types

Room naming is load-bearing: Socket.IO rooms, Mongo `Rooms` documents, and the values passed to the message endpoints all key off the same string.

| Type | Room name | How it's derived |
| --- | --- | --- |
| Global | `global-room` | Constant. No `Rooms` document is created on assignment; everyone joins the same room. |
| Network | `network-<subnet>` | `GET /api/rooms/assign` reads the client IP (`request-ip` + `trust proxy`), takes the first three octets, e.g. `network-203.0.113`. |
| Custom | `custom-<CODE>` | `POST /api/rooms/create` generates a unique 6-char code; users join with `custom-<CODE>`. |

The frontend route segment (`global` / `network` / `custom`) maps to these names inside `Chat.jsx` and the room controllers.

## Dual messaging model (P2P-first with server fallback)

Every chat message takes **two paths simultaneously**:

1. **WebRTC P2P (first):** `Chat.jsx` opens a WebRTC data channel (`"chat"`) to every other peer in the same room, established via the Socket.IO signaling relay. On send, the message is pushed over every open data channel.
2. **Socket.IO server (always):** the same message is *also* POSTed to `POST /api/messages/send/:roomName`. The server persists it to MongoDB and broadcasts it to the room over Socket.IO (`chatMessage`). This is both the persistence layer and the fallback for peers that have no working data channel.

Because a message can arrive twice (once over P2P, once echoed by the server), the receiver **deduplicates**. The P2P copy carries a client-generated `tempId` (a `crypto.randomUUID()`); the server-persisted copy carries the real Mongo `_id` plus the same `tempId`. The client tracks both IDs in an in-memory `Set` and upserts the temporary copy in place when the server confirmation arrives. Full detail in [REALTIME.md](./REALTIME.md).

### Message flow diagram

```
   Sender (Chat.jsx)                                  Receiver (Chat.jsx)
   ─────────────────                                  ───────────────────
   handleSendMessage
        │
        │ build payload { _id: tempId, text, senderId, ... }
        │ addMessage(payload)  ── optimistic local render
        │
        ├───────────── WebRTC data channel ("chat") ──────────► addMessage()
        │              (per open peer channel)                   dedup by _id/tempId
        │
        └── POST /api/messages/send/:roomName ─┐
                                               ▼
                                        ┌──────────────┐
                                        │   Backend    │
                                        │  Express +   │
                                        │  Socket.IO   │
                                        └──────────────┘
                                          │        │
                            save to Mongo │        │ io.to(room).emit("chatMessage", payload+tempId)
                                          ▼        ▼
                                     [ Message ]   broadcast to ALL room members
                                                   (incl. sender + receiver)
                                                          │
                                                          ▼
                                              upsertMessage() on receiver
                                              - own tempId → replace temp w/ persisted
                                              - others' _id → addMessage() (dedup)
```

If P2P never connects (different networks, NAT/firewall), the receiver still gets the message via the server broadcast — the data channel is simply an optimization, never a requirement for delivery.

## Production deploy model (Render)

- Deployed on Render as a single web service.
- Build: root `npm run build` installs + builds the frontend (`frontend/dist`) and installs the backend.
- Start: root `npm start` launches the backend.
- When `NODE_ENV=production`, `backend/src/app.js` serves the static `frontend/dist` and falls back to `index.html` for any non-`/api` route (SPA routing). So one origin (`https://waves-c53a.onrender.com`) hosts both the API and the UI.
- The CORS allow-list is shared from `libs/allowedOrigins.js` (used by both `app.js` and `libs/socket.js`) and is extensible via the `CLIENT_ORIGINS` env var — see [BACKEND_STRUCTURE.md](./BACKEND_STRUCTURE.md).

## Auth model

JWT in an httpOnly `jwt` cookie (7-day expiry), issued by `libs/utils.js` and validated by `middleware/auth.middleware.js`. Users are either **anonymous** (auto-generated name/color, no password) or **registered** (username + bcrypt-hashed password). See [API.md](./API.md) and [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md).
