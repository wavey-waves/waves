# Real-time: Socket.IO + WebRTC

Two cooperating layers: a Socket.IO server (`backend/src/libs/socket.js`) that handles room membership and relays WebRTC signaling, and per-peer WebRTC data channels established in `frontend/src/components/Chat.jsx`. Messaging is P2P-first with a server fallback + persistence (see [ARCHITECTURE.md](./ARCHITECTURE.md)).

## Socket.IO events

### Client → Server

| Event | Payload | Server handling |
| --- | --- | --- |
| `join` | `roomName` (string) | `socket.join(roomName)`. Emits `existing-room-users` back to the joiner with the other socket IDs in the room, then broadcasts `userJoined` to the whole room. |
| `leave` | `roomName` (string) | `socket.leave(roomName)`; broadcasts `userLeft` to the room. |
| `webrtc-offer` | `{ offer, to }` | Relays to target socket (see security check below). |
| `webrtc-answer` | `{ answer, to }` | Relays to target socket. |
| `webrtc-ice-candidate` | `{ candidate, to }` | Relays to target socket. |
| `disconnect` | — (built-in) | For each room the socket was in (excluding its own id-room), broadcasts `userLeft` with `message: "A user has disconnected"`. |

### Server → Client

| Event | Payload | Emitted when |
| --- | --- | --- |
| `existing-room-users` | `{ users: string[] }` | Sent only to the joining socket on `join`; lists other socket IDs already in the room. |
| `userJoined` | `{ socketId, message }` | Broadcast to room on `join`. *(Not handled in `Chat.jsx`.)* |
| `userLeft` | `{ socketId, message }` | Broadcast on `leave` and on `disconnect`. `Chat.jsx` handles it to toast and close the peer connection. |
| `chatMessage` | populated message doc **+ `tempId`** | Broadcast to `io.to(roomName)` from the `sendMessage` controller after persisting. |
| `message-reacted` | updated populated message doc | Broadcast to the message's room from the `reactToMessage` controller. |
| `webrtc-offer` | `{ offer, from }` | Relayed from another peer. |
| `webrtc-answer` | `{ answer, from }` | Relayed from another peer. |
| `webrtc-ice-candidate` | `{ candidate, from }` | Relayed from another peer. |

> **Peer cleanup:** `Chat.jsx` subscribes to `userLeft` (matching the server's emit) to toast and close the departing peer's connection. As a backstop, peer cleanup also happens via `pc.onconnectionstatechange` when the underlying connection drops. The client does **not** subscribe to `userJoined` — new peers are discovered via the `existing-room-users` list on join.

## WebRTC signaling relay + security check

The three `webrtc-*` handlers all follow the same pattern in `socket.js`:

```js
socket.on("webrtc-offer", ({ offer, to }) => {
  const target = io.sockets.sockets.get(to);
  if (!target || !offer) return;
  // ignore the socket's own id-room; both must share a real room
  const shareRoom = [...socket.rooms].some(r => r !== socket.id && target.rooms.has(r));
  if (!shareRoom) return;                       // security check
  socket.to(to).emit("webrtc-offer", { offer, from: socket.id });
});
```

The **shared-room check** prevents a client from initiating WebRTC signaling with a peer it doesn't share a room with (you can't relay an offer/answer/candidate to an arbitrary socket id). **Preserve this check whenever editing the signaling relay.**

## WebRTC peer flow (Chat.jsx)

ICE: public Google STUN only (`stun.l.google.com:19302`, `stun1...`), no TURN.

### Establishing connections

1. After fetching message history, `Chat.jsx` connects the socket (`io(VITE_BACKEND_URL, { withCredentials: true })`) and emits `join` with the resolved room name.
2. The server replies with `existing-room-users`. For each existing peer, the client calls `createPeerConnection(peerSocketId, isInitiator = true)`:
   - Creates an `RTCPeerConnection`, stores it in `peerConnectionsRef` (a `Map` keyed by socket id).
   - As initiator: creates the `"chat"` data channel (stored in `dataChannelsRef`), wires `onmessage`/`onopen`, then `createOffer → setLocalDescription → emit "webrtc-offer"`.
3. On receiving `webrtc-offer`, the client calls `createPeerConnection(from, isInitiator = false)`:
   - As non-initiator: waits for `pc.ondatachannel` to receive the channel, then wires `onmessage`/`onopen`.
   - `setRemoteDescription(offer) → createAnswer → setLocalDescription → emit "webrtc-answer"`.
   - Starts a **10-second timeout**: if the connection is not `connected` after 10s, it's assumed failed and `closePeerConnection(from)` runs.
4. `webrtc-answer` → `setRemoteDescription(answer)`. `webrtc-ice-candidate` → `addIceCandidate`. Each side emits its own ICE candidates via `pc.onicecandidate → emit "webrtc-ice-candidate"`.
5. `pc.onconnectionstatechange`: on `failed`/`disconnected`/`closed`, `closePeerConnection` removes the `RTCPeerConnection` and data channel from the maps.

`closePeerConnection(socketId)` closes the `RTCPeerConnection` and deletes it from both `peerConnectionsRef` and `dataChannelsRef`.

### Send path (P2P-first + server)

In `handleSendMessage`:

1. Validate: non-empty, ≤ `CHARACTER_LIMIT` (1000), and rate-limited to one message per `THROTTLE_DELAY` (1000 ms).
2. Build an optimistic payload with a client `_id`:
   ```js
   { _id: crypto.randomUUID(), text, senderId: { _id, userName, color }, roomName, createdAt }
   ```
   This `_id` is the **tempId**.
3. `addMessage(payload)` — render it locally immediately.
4. Send over **every open data channel** (`channel.readyState === "open"` → `channel.send(JSON.stringify(payload))`).
5. **Always** `POST /api/messages/send/:roomName` with `{ text, tempId: payload._id }` — persistence + fallback for peers without a channel.

### Receive + dedup path

`processedMessageIds` is an in-memory `Set` of seen IDs. On mount, the IDs of fetched history are pre-loaded (and only the last 50 are kept in state).

- **`addMessage(message)`** (used for P2P messages and other users' server messages): ignores anything whose `_id` or `tempId` is already in the set; otherwise adds **both** IDs to the set and appends to state. This is what stops a message arriving via both P2P and the server from rendering twice.
- **`upsertMessage(message)`** (the `chatMessage` socket handler): if the broadcast is the sender's **own** message (`message.tempId && message.senderId._id === user.id`), it replaces the optimistic temp copy in place — `messages.map(m => m._id === message.tempId ? message : m)` — and records the new permanent `_id`. Otherwise it falls through to `addMessage` (dedup applies).

So the lifecycle of a tempId: created on send → carried over P2P → echoed by the server alongside the persisted `_id` → the sender swaps temp for persisted; receivers dedup on whichever copy arrives first.

> **Invariant:** any change to the message send/receive flow must preserve this dedup (both IDs tracked, temp→persisted upsert), or users will see doubled messages.

### Cleanup

On unmount (or deps change: `user`, `actualRoomType`, `roomCode`), the effect emits `leave`, closes all peer connections, disconnects the socket, and clears the connection/channel/processed-id maps.
