# Frontend Structure

React 19 SPA built with Vite + Tailwind v4. Entry is `src/main.jsx` → `src/App.jsx`.

The same SPA serves two runtimes: the **web app** (REST + Socket.IO + WebRTC
against the Express backend) and **Waves Desktop** (the Tauri app, where all
chat IO goes to the local Rust mesh node instead — see [MESH.md](./MESH.md)).
All IO is abstracted behind the **transport seam** in `src/transport/`.

## Transport seam (`src/transport/`)

| File | Responsibility |
| --- | --- |
| `index.js` | `isTauri()` detection + `createTransport({user})`, which dynamic-imports exactly one implementation (keeps `@tauri-apps/api` out of the web bundle — the build emits separate lazy chunks). |
| `web.js` | The web transport: all the Socket.IO / WebRTC / axios logic that used to live inline in `Chat.jsx` (see [REALTIME.md](./REALTIME.md) — the tempId dedup invariant is unchanged). |
| `tauri.js` | The mesh transport: maps Tauri IPC DTOs to the UI message shape, retries the `mesh-starting` rejection, streams events over a `tauri::ipc::Channel`, sends images as raw invoke bodies, and exposes the `radio` API (`radioCaps/radioHost/radioStopHost/radioJoin/radioLeave`) for forest mode. Mesh rooms: `custom` code → `mesh-<CODE>`, global/network → `mesh-global`. |

Both implement `{kind, resolveRoom, fetchHistory, connect({roomName, handlers}), send({roomName, payload}), disconnect}` (+ `sendImage`/`exportBlob` on the mesh side).

## Components

| Component | File | Responsibility |
| --- | --- | --- |
| `App` (+ `Home`, `ChatRoute`) | `src/App.jsx` | Router setup, the landing/room-selection screen (`Home`), and the auth-gating route wrapper (`ChatRoute`). |
| `Chat` | `src/components/Chat.jsx` | The chat screen: state, message dedup/upsert, throttle, rendering (incl. image messages: flooded thumbnail first, full-res swap when the blob arrives), and the send flows — optimistic + server echo on web, direct mesh compose on desktop. IO lives in the transport seam. |
| `RadioPanel` | `src/components/RadioPanel.jsx` | Desktop-only forest-mode panel (custom rooms): Host network / Join network / Extend mesh via the `radio` IPC, gated on adapter capabilities; shows hosting/joined state. |
| `JoinRoom` | `src/components/JoinRoom.jsx` | The join modal. Web: anonymous vs custom-account auth (`/api/auth/*`), anonymous identity persisted in `localStorage` (`anonymousUser`, 7-day expiry). Desktop: serverless join — display name + palette color → `mesh_set_author`, user id = the device's mesh endpoint id; registered login hidden. Holds `ROOM_THEMES`. |
| `CustomRoom` | `src/components/CustomRoom.jsx` | Modal to create/join a custom room by 6-char code. Web: `POST /api/rooms/create|join`. Desktop: codes generated/validated locally (no server). |
| `Documentation` | `src/components/Documentation.jsx` | Static informational modal explaining P2P/WebRTC behavior. Pure presentation, no data. |

(`App.jsx` defines `Home` and `ChatRoute` as local components, not separate files.)

## Routes (React Router v7)

Defined in `App.jsx`:

| Path | Element | Notes |
| --- | --- | --- |
| `/` | `<Home />` | Room selection (Global / Network / Custom cards) + Docs button. `Home` navigates on its own (`useNavigate`) on join success — it takes no props. |
| `/chat/:roomType` | `<ChatRoute />` | `:roomType` is `global` or `network`. |
| `/chat/custom/:roomCode` | `<ChatRoute />` | Custom room; `roomCode` is the 6-char code. `ChatRoute` resolves `roomType = roomCode ? 'custom' : urlRoomType`. |

`ChatRoute` flow:

1. `GET /api/auth/check` to detect an existing session.
2. If authenticated → render `<Chat />`.
3. If not → for `global`/`network`, show `<JoinRoom />`; for `custom`, first `POST /api/rooms/join` to verify the room exists (404 → toast + redirect home), then show `<JoinRoom />`. Unknown room type → redirect to `/`.

## Router location state

State is passed between routes via React Router's `location.state` rather than a global store:

- `Home` reads `location.state?.showJoinRoom` / `roomType` to reopen the join modal after a redirect, then clears it with `window.history.replaceState`.
- On successful join, `Home` navigates to `/chat/<type>` (or `/chat/custom/<code>`) with `state: { fromHome: true, roomData }`.
- `ChatRoute` passes `roomData={location.state?.roomData || roomData}` into `<Chat />`.

## Axios usage

- `axios.defaults.withCredentials = true` is set in `App.jsx`, `JoinRoom.jsx`, and `Chat.jsx` so the `jwt` cookie is sent with every request.
- All REST calls use **relative `/api/...` paths** (e.g. `/api/auth/check`, `/api/rooms/assign`, `/api/messages/send/${roomName}`). These are proxied in dev and same-origin in production.

## Socket connection (`VITE_BACKEND_URL`)

Distinct from the REST paths: `Chat.jsx` opens the Socket.IO connection against `import.meta.env.VITE_BACKEND_URL`:

```js
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
socketRef.current = io(BACKEND_URL, { withCredentials: true });
```

If `VITE_BACKEND_URL` is empty/undefined (typical in dev), `io()` connects same-origin, which works through the Vite proxy. In production it should point at the deployed backend origin.

## STUN / WebRTC config

`Chat.jsx` uses public Google STUN servers for NAT traversal (no TURN server configured):

```js
iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
]
```

## Dev proxy (`vite.config.js`)

```js
server: {
  port: 5174,
  proxy: {
    '/api': { target: 'http://localhost:5000', changeOrigin: true, secure: false, ws: true }
  }
}
```

- Dev server runs on **port 5174**.
- `/api` (and websocket upgrades, `ws: true`) proxy to `http://localhost:5000`.

> **Dev port gotcha:** the proxy targets `:5000` but the backend defaults to `PORT=3000`. Run the backend with `PORT=5000` (or change the proxy target) for local dev.

## Build

- `npm run dev` → `vite --host` (port 5174)
- `npm run build` → `vite build` → `frontend/dist`
- `npm run lint` → `eslint .`
- `npm run preview` → preview the production build
