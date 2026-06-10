# Waves Documentation

Current-state reference for the Waves real-time chat app. These docs describe how the code behaves today; project *conventions* live in the root `CLAUDE.md`.

## Index

- [ARCHITECTURE.md](./ARCHITECTURE.md) — monorepo layout, the three room types, the dual (P2P + server) messaging model, end-to-end message flow, and the Render deploy model.
- [BACKEND_STRUCTURE.md](./BACKEND_STRUCTURE.md) — `backend/src` directory map, routes→controllers→models, the roles of `app.js` / `index.js` / `libs/socket.js`, and the shared CORS allow-list (`libs/allowedOrigins.js`).
- [FRONTEND_STRUCTURE.md](./FRONTEND_STRUCTURE.md) — the four components, React Router routes, location-state passing, axios usage, the `VITE_BACKEND_URL` socket connection, and the dev proxy.
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) — the Users / Rooms / Message models, fields, TTL/expiry behavior, `generateUniqueCode`, and the reactions sub-schema.
- [API.md](./API.md) — every HTTP endpoint with method, path, auth, request/response shapes.
- [REALTIME.md](./REALTIME.md) — the Socket.IO event protocol and the WebRTC peer/data-channel flow + dedup.
- [TESTING.md](./TESTING.md) — how to run lint / typecheck / tests for each package.

## Doc ownership map

When you change X, update the matching doc:

| You change... | Update |
| --- | --- |
| A model field, index, default, or TTL/expiry behavior | [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) |
| Add / modify / remove an HTTP endpoint, its auth, body, or response shape | [API.md](./API.md) |
| Add / rename / move a backend module, or change `app.js`/`index.js`/`socket.js` wiring or the CORS lists | [BACKEND_STRUCTURE.md](./BACKEND_STRUCTURE.md) |
| Add / rename a frontend component or route, or change axios / socket connection config | [FRONTEND_STRUCTURE.md](./FRONTEND_STRUCTURE.md) |
| Add / rename / change a Socket.IO event, the WebRTC peer flow, or the message dedup | [REALTIME.md](./REALTIME.md) |
| The overall architecture, room-type model, messaging model, or the deploy setup | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Test/lint/typecheck tooling or commands | [TESTING.md](./TESTING.md) |
