import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";

// Forest-mode radio panel (docs/MESH.md P3.b; decisions D2/D3): manual
// Host / Join / Extend controls over the radio_* IPC commands, rendered by
// Chat.jsx only for custom rooms on the mesh transport. The radio is a
// separate subsystem from the mesh node (no "mesh-starting" retry), and its
// rejection strings are already descriptive ("…is Mobile Hotspot on?",
// timeouts), so they surface verbatim as toasts. All state is component-local
// and torn down best-effort on unmount.

const REQUIRES_WINDOWS = "radio-requires-windows";

// Tauri command rejections are plain strings; normalize Errors too and
// translate the non-Windows dev marker into a friendly message.
const errorText = (error) => {
  const message =
    typeof error === "string" ? error : error?.message || String(error);
  return message === REQUIRES_WINDOWS
    ? "WiFi-Direct requires Windows"
    : message;
};

function RadioPanel({ roomCode, colors }) {
  const [open, setOpen] = useState(false);
  const [caps, setCaps] = useState(null); // null until radio_caps resolves
  const [hostSsid, setHostSsid] = useState(null);
  const [hostBusy, setHostBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);

  // The radio API is dynamic-imported so @tauri-apps/api stays out of the web
  // bundle (P1.f seam rule); the ref hands it to handlers and the cleanup.
  const radioRef = useRef(null);
  // What the unmount cleanup must undo (state would be stale in the closure).
  const liveRef = useRef({ hosting: false, joined: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { radio } = await import("../transport/tauri.js");
        radioRef.current = radio;
        const result = await radio.radioCaps();
        if (!cancelled) setCaps(result);
      } catch (error) {
        // A failed probe means no usable radio — same UI as unsupported.
        console.error("radio_caps error:", error);
        if (!cancelled) setCaps({ supported: false });
      }
    })();
    const live = liveRef.current;
    return () => {
      cancelled = true;
      // Leaving the room: best-effort, fire-and-forget radio teardown.
      const radio = radioRef.current;
      if (radio && live.hosting) radio.radioStopHost().catch(() => {});
      if (radio && live.joined) radio.radioLeave().catch(() => {});
    };
  }, []);

  // "Extend mesh" is the same GO start while already joined (multi-hop chain
  // link, P4.a) — both buttons funnel here.
  const handleHost = async () => {
    const radio = radioRef.current;
    if (!radio || hostBusy) return;
    setHostBusy(true);
    try {
      const ssid = await radio.radioHost(roomCode);
      liveRef.current.hosting = true;
      setHostSsid(ssid);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setHostBusy(false);
    }
  };

  const handleStopHost = async () => {
    const radio = radioRef.current;
    if (!radio) return;
    liveRef.current.hosting = false;
    setHostSsid(null);
    try {
      await radio.radioStopHost();
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const handleJoin = async () => {
    const radio = radioRef.current;
    if (!radio || joinBusy) return;
    setJoinBusy(true);
    try {
      await radio.radioJoin(roomCode);
      liveRef.current.joined = true;
      setJoined(true);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setJoinBusy(false);
    }
  };

  const handleLeave = async () => {
    const radio = radioRef.current;
    if (!radio) return;
    liveRef.current.joined = false;
    setJoined(false);
    try {
      await radio.radioLeave();
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  // Same SSID the Rust side derives from the code (radio-win creds, D2).
  const ssidLabel = `WAVES-${String(roomCode).toUpperCase()}`;
  const pill = `text-xs font-medium bg-gradient-to-r ${colors.accent} bg-clip-text text-transparent px-2 py-0.5 rounded-full border ${colors.border} backdrop-blur-sm`;
  const actionButton = `text-xs font-medium text-white px-2.5 py-0.5 rounded-full bg-gradient-to-r ${colors.button} hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed`;

  if (caps && !caps.supported) {
    return (
      <div className="flex-shrink-0 px-3 py-1.5 sm:px-4 border-b border-white/10">
        <p className="text-xs text-white/40">
          WiFi-Direct radio requires Windows
        </p>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 px-3 py-1.5 sm:px-4 border-b border-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-medium text-white/70 hover:text-white transition-colors"
      >
        <svg
          className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        Forest radio
        {hostSsid && <span className={pill}>hosting</span>}
        {joined && <span className={pill}>connected</span>}
      </button>

      {open &&
        (caps === null ? (
          <p className="mt-1.5 text-xs text-white/40">checking radio…</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {hostSsid ? (
              <>
                <span className={pill}>hosting {hostSsid}</span>
                <button
                  type="button"
                  onClick={handleStopHost}
                  className={actionButton}
                >
                  Stop hosting
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleHost}
                disabled={hostBusy}
                title={`Start a WiFi-Direct access point (${ssidLabel}) others can join`}
                className={actionButton}
              >
                {hostBusy ? "Starting…" : "Host network"}
              </button>
            )}

            {joined ? (
              <>
                <span className={pill}>connected to {ssidLabel}</span>
                <button
                  type="button"
                  onClick={handleLeave}
                  className={actionButton}
                >
                  Leave
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleJoin}
                disabled={joinBusy}
                title={`Scan for and connect to ${ssidLabel}`}
                className={actionButton}
              >
                {joinBusy ? (
                  <span className="flex items-center gap-1.5">
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Joining… (can take ~25 s)
                  </span>
                ) : (
                  "Join network"
                )}
              </button>
            )}

            {!hostSsid && (
              <button
                type="button"
                onClick={handleHost}
                disabled={hostBusy || !caps.goStaConcurrency}
                title={
                  caps.goStaConcurrency
                    ? "Host this mesh onward while connected (multi-hop)"
                    : "adapter can't host while connected"
                }
                className={actionButton}
              >
                Extend mesh
              </button>
            )}
            {!caps.goStaConcurrency && (
              <span className="text-[10px] text-white/40">
                adapter can&apos;t host while connected
              </span>
            )}
          </div>
        ))}
    </div>
  );
}

export default RadioPanel;
