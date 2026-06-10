# Backend Structure

Express + Socket.IO app, ES modules (`"type": "module"`). Conventional routes → controllers → models layout plus a Socket.IO layer.

## Directory map

```
backend/src/
├── index.js                      # entry point: listens + connectDB
├── app.js                        # configures the shared Express app (middleware, routes, prod static, error handler)
├── libs/
│   ├── socket.js                 # creates app/server/io; handles socket events + WebRTC signaling relay
│   ├── db.js                     # connectDB() — mongoose.connect(MONGODB_URI)
│   └── utils.js                  # generateToken() — signs JWT, sets httpOnly cookie
├── middleware/
│   └── auth.middleware.js        # protectedRoute — verifies jwt cookie, sets req.user
├── controllers/
│   ├── auth.controller.js        # signup, login, logout, checkAuth
│   ├── message.controller.js     # getMessages, sendMessage, reactToMessage, cleanupMessages
│   └── room.controller.js        # assignRoom, createRoom, joinRoom, leaveRoom
├── models/
│   ├── user.model.js             # Users
│   ├── room.model.js             # Rooms (+ generateUniqueCode static)
│   └── message.model.js          # Message
└── routes/
    ├── auth.routes.js            # /api/auth
    ├── message.routes.js         # /api/messages
    └── room.routes.js            # /api/rooms
```

## The three top-level modules and how they relate

The Express `app`, the HTTP `server`, and the Socket.IO `io` are all **created in `libs/socket.js`** and imported elsewhere. This avoids a circular setup and lets controllers emit socket events.

| File | Responsibility |
| --- | --- |
| `libs/socket.js` | Creates `app` (`express()`), `server` (`http.createServer(app)`), and `io` (`new SocketServer(server, ...)`). Registers all socket event handlers (`join`, `leave`, `disconnect`, the `webrtc-*` signaling relay). Exports `{ io, app, server }`. |
| `app.js` | Imports `app` from `socket.js` and **configures it**: `trust proxy`, JSON body parsing, `request-ip`, cookie parsing, CORS, mounts the three routers, prod static serving, and the global error handler. Has no `.listen()`. |
| `index.js` | Imports `server` from `socket.js`, imports `./app.js` purely for its side effect (wiring middleware + routes onto the shared app), then `server.listen(PORT)` and calls `connectDB()`. `PORT` defaults to `3000`. |

> **Import-order note:** `index.js` imports `./app.js` for its side effects. That is what attaches all middleware and routes to the shared `app` before the server starts listening.

## Request lifecycle

```
HTTP request
  → app.js middleware: express.json → request-ip → cookieParser → cors
  → router (/api/auth | /api/messages | /api/rooms)
  → [protectedRoute] (on protected routes) → sets req.user from jwt cookie
  → controller → model (Mongoose) → res.json(...)
  → (errors) → global 4-arg error handler in app.js
```

## `protectedRoute` middleware (`middleware/auth.middleware.js`)

Reads the `jwt` cookie, verifies it with `JWT_SECRET`, loads the user (`-password`), and sets:

```js
req.user = { _id, userName, color, isAuthenticated: true }
```

Failure responses (all include `isAuthenticated: false`):

- No cookie → `401 { message: "No token provided" }`
- Decode falsy → `401 { message: "Invalid token" }`
- User not found → `404 { message: "User not found" }`
- `jwt.verify` throws (expired/malformed/wrong-secret) → `401 { message: "Invalid token" }`
- Outer catch → `500 { message: "Internal Server Error" }`

## Routers → controllers

See [API.md](./API.md) for full endpoint detail. Summary:

| Router (mount) | Routes |
| --- | --- |
| `auth.routes.js` (`/api/auth`) | `POST /signup`, `POST /login`, `POST /logout`, `GET /check` (protected) |
| `message.routes.js` (`/api/messages`) | `GET /:roomName` (protected), `POST /send/:roomName` (protected), `POST /:id/react` (protected), `DELETE /cleanup` (protected) |
| `room.routes.js` (`/api/rooms`) | `GET /assign` (protected), `POST /create`, `POST /join`, `POST /leave/:roomName` (protected) |

> `POST /create` and `POST /join` are **not** protected — rooms can be created/looked up before a user authenticates.

## CORS origins (single source: `libs/allowedOrigins.js`)

The allowed-origins list lives in **one** module, `libs/allowedOrigins.js`, and is imported by both consumers:

- **`app.js`** — `cors({ origin: allowedOrigins, credentials: true })`
- **`libs/socket.js`** — the Socket.IO server `cors` option (Socket.IO also sets `transports: ["websocket", "polling"]` as a top-level option, not under `cors`).

```js
// libs/allowedOrigins.js
const DEFAULT_ORIGINS = [
  'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175',
  'http://localhost:5176', 'https://waves-c53a.onrender.com',
  '13.228.225.19', '18.142.128.26', '54.254.162.138',
];
// Optionally extended (and de-duped) via the CLIENT_ORIGINS env var:
//   CLIENT_ORIGINS="https://app.example.com,https://staging.example.com"
export const allowedOrigins = [...new Set([...DEFAULT_ORIGINS, ...envOrigins])];
```

To add a deployment origin, edit `DEFAULT_ORIGINS` or set `CLIENT_ORIGINS` — never reintroduce a second hardcoded copy. `libs/env.js` (imported first by `app.js`/`index.js`) ensures `.env` is loaded before this list is computed.

## Production static serving (`app.js`)

When `NODE_ENV === 'production'`:

```js
app.use(express.static(path.join(__dirname, "../frontend/dist")));
app.get('/:wildcard(.*)', (req, res) =>
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html')));
```

So the backend serves the built SPA and routes unknown paths to `index.html`.

## Environment variables

`PORT`, `MONGODB_URI`, `JWT_SECRET`, `NODE_ENV`. Loaded via `dotenv.config()` in `app.js`.
