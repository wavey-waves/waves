// Mesh transport for the Tauri desktop build (docs/MESH.md P1.f). Talks to
// src-tauri/src/ipc.rs over invoke() plus a tauri::ipc::Channel event stream —
// never the Tauri event system (not built for chat throughput). DTO field
// names are the camelCase serde renames from ipc.rs.
import { invoke, Channel } from "@tauri-apps/api/core";

// ipc.rs rejects commands with this exact string while the mesh node is still
// spawning; retry with a short backoff instead of surfacing an error.
const NOT_READY = "mesh-starting";
const RETRY_DELAY_MS = 300;
const RETRY_ATTEMPTS = 20;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isNotReady = (error) =>
  error === NOT_READY || error?.message === NOT_READY;

/** Run `fn`, retrying the "mesh-starting" rejection with a fixed backoff. */
export async function withMeshRetry(fn) {
  let lastError;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isNotReady(error)) throw error;
      lastError = error;
      if (attempt < RETRY_ATTEMPTS - 1) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

/**
 * Map an ipc.rs MessageDto to the UI message shape Chat.jsx renders and
 * dedups on (docs/MESH.md P1.f contract): id→_id, originId→senderId._id,
 * createdAtMs→ISO createdAt; blob metadata carried through when present.
 */
export function dtoToUi(dto) {
  const message = {
    _id: dto.id,
    text: dto.text ?? "",
    senderId: {
      _id: dto.originId,
      userName: dto.authorName,
      color: dto.authorColor,
    },
    roomName: dto.room,
    createdAt: new Date(dto.createdAtMs).toISOString(),
    kind: dto.kind,
  };
  if (dto.blobHash != null) {
    message.blob = {
      hash: dto.blobHash,
      size: dto.blobSize,
      mime: dto.blobMime,
      thumbB64: dto.thumbB64,
    };
  }
  return message;
}

/**
 * Offline room mapping (docs/MESH.md): custom code → `mesh-<CODE>`
 * (uppercased, mirroring the web `custom-<CODE>` convention); global and
 * network collapse to the single local mesh room.
 */
export function resolveMeshRoom({ roomType, roomCode }) {
  if (roomType === "custom" && roomCode) {
    return {
      roomName: `mesh-${String(roomCode).toUpperCase()}`,
      code: roomCode,
    };
  }
  return { roomName: "mesh-global" };
}

/**
 * Serverless join for JoinRoom.jsx: publish the author identity to the mesh
 * node, then read back the device endpoint id that stands in for the web
 * user id ({ id: endpointId, username, color }).
 */
export async function meshJoin({ name, color }) {
  await withMeshRetry(() => invoke("mesh_set_author", { name, color }));
  const info = await withMeshRetry(async () => {
    const i = await invoke("mesh_info");
    // mesh_info never rejects while starting — it reports ready:false.
    if (!i?.ready || !i.endpointId) throw NOT_READY;
    return i;
  });
  return { endpointId: info.endpointId };
}

export function createTransport() {
  let channel = null;
  let connectedRoom = null;

  return {
    kind: "mesh",

    async resolveRoom({ roomType, roomCode }) {
      return resolveMeshRoom({ roomType, roomCode });
    },

    async fetchHistory(roomName) {
      const history = await withMeshRetry(() =>
        invoke("mesh_history", { room: roomName })
      );
      return (history ?? []).map(dtoToUi);
    },

    async connect({ roomName, handlers }) {
      connectedRoom = roomName;
      const ch = new Channel();
      ch.onmessage = (event) => {
        // Drop events once disconnected or re-connected elsewhere.
        if (channel !== ch || connectedRoom !== roomName) return;
        if (event.type === "message") {
          // The subscription is mesh-wide; filter to the connected room.
          if (event.message?.room !== roomName) return;
          // The authoritative stream — Chat upserts/dedups it exactly like
          // the web server echo (the sender's own send() result dedups here).
          handlers.onServerMessage(dtoToUi(event.message));
        } else if (event.type === "peerDown") {
          handlers.onUserLeft({ socketId: event.originId ?? event.origin_id });
        } else if (event.type === "blobReady") {
          // Blob transfers are mesh-wide (content-addressed), not room-scoped.
          handlers.onBlobReady?.(event.hash);
        } else if (event.type === "blobFailed") {
          handlers.onBlobFailed?.(event.hash, event.reason);
        }
        // peerUp feeds the peer list in a later phase; no chat handler yet.
      };
      channel = ch;
      await withMeshRetry(() => invoke("mesh_subscribe", { channel: ch }));
    },

    async send({ roomName, payload }) {
      const dto = await withMeshRetry(() =>
        invoke("mesh_send_text", { room: roomName, text: payload.text })
      );
      // The caller renders this returned message; the subscribe echo then
      // dedups on the canonical _id (docs/MESH.md L3 dedup invariant).
      return dtoToUi(dto);
    },

    // Send an image (docs/MESH.md P2.b). `bytes` (ArrayBuffer/Uint8Array)
    // travels as the raw invoke body — never JSON — with room/mime as
    // request headers; ipc.rs thumbnails it and returns the announcement.
    async sendImage({ roomName, bytes, mime }) {
      const dto = await withMeshRetry(() =>
        invoke("mesh_send_image", bytes, {
          headers: { room: roomName, mime },
        })
      );
      return dtoToUi(dto);
    },

    // Export a downloaded blob into the asset-protocol scope; resolves the
    // absolute file path (render via convertFileSrc). Rejects "blob-not-ready"
    // while the transfer is still in flight — that is not retried here, the
    // blobReady event tells the UI when to try again.
    async exportBlob({ hash, mime }) {
      return withMeshRetry(() => invoke("mesh_export_blob", { hash, mime }));
    },

    disconnect() {
      // No unsubscribe command: the Rust forwarder exits when its channel
      // send fails (page gone). Here we just stop delivering to handlers.
      connectedRoom = null;
      channel = null;
    },
  };
}
