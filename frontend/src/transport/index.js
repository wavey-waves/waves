// Transport seam (docs/MESH.md P1.f): one chat-IO interface with two
// implementations — the web socket.io/WebRTC/axios stack (web.js) and the
// Tauri mesh IPC bridge (tauri.js). Both expose:
//   { kind, resolveRoom, fetchHistory, connect({ roomName, handlers }),
//     send({ roomName, payload }), disconnect }
// The implementations are dynamic-imported so @tauri-apps/api never lands in
// the web bundle (and the web stack stays out of any future mesh-only path).

export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function createTransport({ user } = {}) {
  const mod = isTauri() ? await import("./tauri.js") : await import("./web.js");
  return mod.createTransport({ user });
}
