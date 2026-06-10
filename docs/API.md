# HTTP API

All endpoints are mounted under `/api`. Auth is via the httpOnly `jwt` cookie; endpoints marked **protected** run `protectedRoute` middleware (see [BACKEND_STRUCTURE.md](./BACKEND_STRUCTURE.md)). Shapes below are taken directly from the controllers.

Shared `protectedRoute` failures (any protected endpoint): `401` (no token, or an invalid/expired/wrong-secret token), `404` (user not found), or `500` (unexpected internal error) — all with `{ isAuthenticated: false, message }`.

---

## Auth (`/api/auth`)

### `POST /api/auth/signup`

Create a user (anonymous or registered) and set the `jwt` cookie. Not protected.

Body:

| Field | Type | Required |
| --- | --- | --- |
| `userName` | string | yes (trimmed; rejected if empty) |
| `color` | string | yes |
| `password` | string | required only when `isAnonymous` is falsy; must be ≥ 6 chars |
| `isAnonymous` | boolean | optional (default `false`) |

Responses:

- `201` → `{ _id, userName, color, isAnonymous }` (and sets `jwt` cookie)
- `400` → `{ message: "Username is required" }` / `"Color is required"` / `"Username already exists"` / `"Password must be at least 6 characters long"` / `"Invalid User data"`
- `500` → `{ message: "Internal Server Error" }`

### `POST /api/auth/login`

Log in and set the `jwt` cookie. Not protected. Anonymous users (`isAnonymous: true`) skip the password check.

Body:

| Field | Type | Required |
| --- | --- | --- |
| `userName` | string | yes |
| `password` | string | required for registered users (compared with bcrypt) |

Responses:

- `200` → `{ _id, userName, color, isAnonymous }` (and sets `jwt` cookie) — consistent with `signup` / `check`
- `400` → `{ message: "Username is required" }` or `{ message: "Invalid credentials" }` (user missing or bad password)
- `500` → `{ message: "Internal Server Error" }`

### `POST /api/auth/logout`

Clear the `jwt` cookie. Not protected.

- `200` → `{ message: "Logged out Successfully" }`
- `500` → `{ message: "Internal Server Error" }`

### `GET /api/auth/check`  *(protected)*

Return the current user (used by the frontend to detect an existing session).

- `200` → `req.user` = `{ _id, userName, color, isAuthenticated: true }`
- otherwise the `protectedRoute` failure shapes above.

---

## Rooms (`/api/rooms`)

### `GET /api/rooms/assign`  *(protected)*

Find-or-create the caller's network room from their IP subnet (first 3 octets → `network-<subnet>`) and add them to `members`.

- `200` → `{ roomId, roomName, memberCount, members }` where `members` is populated with `userName color isAnonymous`
- `400` → `{ message: "Could not determine IP address" }`
- `500` → `{ message: "Failed to assign room" }`

### `POST /api/rooms/create`  *(NOT protected)*

Create a custom room with a unique 6-char code. Body: none.

- `200` → `{ roomId, roomName, code, memberCount: 0, members: [] }` (`roomName` = `custom-<code>`)
- `500` → `{ message: "Failed to create room" }`

### `POST /api/rooms/join`  *(NOT protected)*

Look up a custom room by code (case-insensitive — uppercased server-side). Does not add the caller to members (they aren't authenticated yet).

Body: `{ code: string }` (required)

- `200` → `{ roomId, roomName, code, memberCount, members: [] }` (member details intentionally omitted for privacy)
- `400` → `{ message: "Room code is required" }`
- `404` → `{ message: "Room not found" }`
- `500` → `{ message: "Failed to join room" }`

### `POST /api/rooms/leave/:roomName`  *(protected)*

Remove the caller from a room's `members`.

- `200` → `{ message: "Left room successfully" }`
- `404` → `{ message: "Room not found" }`
- `500` → `{ message: "Failed to leave room" }`

---

## Messages (`/api/messages`)

### `GET /api/messages/:roomName`  *(protected)*

Fetch all messages for a room, sorted oldest→newest, sender and reaction users populated.

- `200` → array of message docs (`.lean()`), each populated with `senderId` (`userName color isAnonymous`) and `reactions.userId` (`userName`)
- `500` → `{ error: "Internal server error" }`

### `POST /api/messages/send/:roomName`  *(protected)*

Persist a message and broadcast it to the room over Socket.IO.

Body:

| Field | Type | Notes |
| --- | --- | --- |
| `text` | string | required (rejected if empty/whitespace, trimmed before save) |
| `tempId` | string | optional; echoed back in the socket broadcast for client dedup |

Behavior: saves the `Message`, re-fetches it populated, broadcasts `chatMessage` (the populated doc **plus** `tempId`) to `io.to(roomName)`, then responds.

- `201` → the populated message doc (without `tempId` in the HTTP body; `tempId` is only on the socket payload)
- `400` → `{ error: "Message text is required" }`
- `500` → `{ error: "Internal server error" }`

### `POST /api/messages/:id/react`  *(protected)*

Toggle a reaction on a message (one reaction per user — see [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)). Same emoji again removes it; a different emoji replaces the user's existing reaction. Broadcasts `message-reacted` with the updated doc to the message's room.

Body: `{ emoji: string }` (required)

- `200` → the updated populated message doc
- `400` → `{ error: "Emoji is required" }`
- `404` → `{ error: "Message not found" }`
- `500` → `{ error: "Internal server error" }`

### `DELETE /api/messages/cleanup`  *(protected)*

For every distinct room, keep only the latest 1000 messages (`NO_OF_MESSAGES = 1000`) and delete the rest.

- `200` → `{ message: "Cleanup completed successfully" }`
- `500` → `{ error: "Internal server error" }`
