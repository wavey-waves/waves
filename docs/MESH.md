# Waves Mesh — Offline P2P Architecture & Protocol Spec

**Status: in active development on the `offline-mesh` branch.** This document is the
canonical spec *and* the continuation state for the effort: any session (human, local
agent, or cloud routine) picking up this branch starts by reading this file and the
checklist at the bottom. Keep both in sync with the code in the same commit.

## Goal

Every device running Waves Desktop discovers nearby devices and forms a multi-hop P2P
mesh with **zero internet and zero infrastructure** (group of laptops in a forest).
Text messages and high-quality images propagate across the whole mesh, including
between nodes that are never directly connected (A–B–C relay). Windows-only for v1,
shipped as a Tauri 2 app. The existing web app and server keep working unchanged.

Non-goals for v1: Bluetooth transports (Windows BLE is 9–50 KB/s, btleplug is
central-only — no shipped precedent), self-organizing topology repair, mobile,
end-to-end encryption beyond per-link TLS (hobby threat model: per-link encryption +
signed messages; E2E groups are future work).

## Decisions log (owner-approved 2026-06-10)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Connection layer | **iroh 1.0.0-rc.1** (pin exact; one migration budgeted at 1.0 final). libp2p rejected (stale umbrella crate, Windows mDNS issues #5524/#2676). iroh-gossip rejected (assumes dialable membership; forest topology is isolated subnets). |
| D2 | Forest-mode credentials | **Room-code-derived SSID/PSK** (matches `custom-<CODE>` model). BLE out-of-band exchange rejected for v1. |
| D3 | Topology | **Manual** Host / Join / Extend buttons. Self-organizing rejected (Berty sinkhole). |
| D4 | Server relationship | **Separate offline world, bridge-READY schema** — message IDs carry (origin_id, origin_seq, BLAKE3 id) so a future Phase-5 bridge can sync into MongoDB without migration. No bridge code in v1. |
| D5 | Installer | NSIS **perMachine + embedBootstrapper** + netsh firewall rules. Fully-offline installer (+127 MB) deferred. |

## Architecture (5 layers)

### L1 — Radio / IP substrate (Windows-specific, `src-tauri/src/radio/`)
- Phase-1 substrate: **any shared IP network** (AP, travel router, internet-less phone
  hotspot). Works with zero radio code.
- Forest mode: **WiFi-Direct legacy-AP autonomous GO** via WinRT
  `WiFiDirectAdvertisementPublisher` + `LegacySettings` (SSID + WPA2 PSK ≥ 8 chars) —
  the Flying Carpet pattern; no pairing prompts, no UWP manifest. Joiners: Win32
  `WlanConnect` with a temporary WPA2PSK profile, `<enableRandomization>false</…>`.
- Multi-hop: **GO+STA chaining** — a node hosts its own GO while its STA port joins a
  neighbor's GO. Each hop is an isolated ICS subnet (GO = 192.168.137.1), so there is
  **no IP routing across hops**: all multi-hop propagation is app-layer relay (L3).
- Rejected: `NetworkOperatorTetheringManager` (can't start offline; kills the GO),
  classic WFD pairing (`FromIdAsync` failure reports), hosted-network APIs (deprecated).

### L2 — Neighbor links + discovery (`src-tauri/crates/mesh-core/src/net/`)
- **iroh Endpoint**, strictly offline: `RelayMode::Disabled`, no DNS/pkarr discovery,
  **mDNS local discovery enabled explicitly** (off by default — a naive integration
  works in the office and fails in the forest).
- Identity = iroh Ed25519 `EndpointId`, persisted per device.
- Fallback discovery (feature-flagged): 1 Hz UDP broadcast beacon
  `{endpoint_id, quic_addr, display_name}` — SSB's proven pattern (~50 lines).
- **Firewall is part of the architecture**: installer adds program-scoped inbound
  allow rules (UDP 5353 + QUIC port, `profile=private,public`). Without them,
  discovery silently finds nobody — the documented #1 failure mode on Windows.

### L3 — Mesh propagation protocol (`mesh-core/src/proto/`), ALPN `waves-mesh/0`
Two planes, ~500 lines total, the pattern every shipped offline messenger
(bitchat, Meshtastic, SSB, Briar) converged on:

1. **Flood plane (real-time):**
   - Message ID = BLAKE3 over canonical bytes (origin_id, origin_seq, lamport,
     created_at_ms, body). Exact-match seen-ID LRU (~10k) — not a Bloom filter
     (false positives silently drop messages).
   - TTL = 8, decremented per hop; forward to all neighbor links except the arrival
     link, with 10–50 ms jitter + cancel-on-duplicate (Meshtastic suppression).
   - Every message Ed25519-signed by the origin device key; relays verify before
     forwarding.
2. **Anti-entropy plane (eventual delivery / store-and-forward):**
   - Each node numbers its own messages with a monotonic per-origin sequence,
     persisted in SQLite. On neighbor connect and every ~30 s: exchange version
     vectors `{origin_id → max_seq}`, batch-stream the gaps (SSB feed replication).
   - This one mechanism covers late joiners, rejoins, partition heals, and makes
     A–B–C delivery fall out for free (B stores the log).
   - Never reconcile by wall clock (no NTP in a forest). UI ordering:
     `(lamport, created_at_ms, origin_id)`.
3. **Dedup invariant (extends the existing web invariant):** the BLAKE3 message ID is
   the `_id` the UI dedups on; a message arriving via both flood and anti-entropy must
   render once. Same contract as the web app's tempId dedup in `Chat.jsx`.

### L4 — Images (`mesh-core/src/blobs/`): announce-then-pull, never flood bytes
- The chat message carries **blob metadata only**: BLAKE3 root hash, byte size, MIME,
  plus an inline thumbnail ≤ 10 KB (thumbnail rides the flood; full image does not —
  flooding 3 MB × TTL 8 would multiply into hundreds of MB).
- Receivers pull the blob via **iroh-blobs** (BLAKE3 verified streaming, resumable)
  from the neighbor that relayed the announcement.
- **Fetch-and-reseed at every relay** (ssb-blobs "sympathetic want"): relays
  auto-fetch announced blobs ≤ 10 MB and serve their neighbors — this is what moves an
  image across hops with no shared IP path, and makes relays seeders for late joiners.
  LRU cache eviction, but never evict blobs referenced inside the sync horizon.

### L5 — Tauri 2 integration (`src-tauri/`)
- Pins: tauri 2.x (current 2.11.x), @tauri-apps/api 2.11.x, tauri-cli 2.11.x.
- `src-tauri/` is a third package beside `frontend/` and `backend/`;
  `devUrl = http://localhost:5174` (Waves' non-default Vite port!),
  `frontendDist = ../frontend/dist`, Vite `strictPort: true`.
- **Transport seam in the frontend** (`frontend/src/transport/`), switched on
  `isTauri()`: web build keeps socket.io-client + axios `/api`; Tauri build uses
  `invoke` + long-lived `tauri::ipc::Channel` streams (messages, peer-list,
  blob-progress). The seam covers REST too — relative `/api` does not exist inside
  the packaged app. Never use the Tauri event system for the chat stream (officially
  not designed for high throughput).
- **Images never cross IPC as bytes on Windows** (~200 ms per 10 MB on WebView2):
  blobs land in the app-data dir; the UI renders via `convertFileSrc()` / asset
  protocol with scope + CSP entries.
- Rust side: mesh stack on `tauri::async_runtime` (spawned in `Builder::setup`),
  bridged via `tokio::mpsc` channels in `manage()`d state.

### Repo layout
```
waves/
  frontend/                  # unchanged React app + new src/transport/ seam
  backend/                   # unchanged Express/Socket.IO server (web mode)
  src-tauri/                 # Tauri 2 app crate (thin: IPC commands, channels, setup)
    crates/mesh-core/        # pure Rust mesh library — builds & tests on any OS
      src/identity.rs        #   device keypair persistence
      src/store/             #   SQLite message log + version vectors + blob index
      src/proto/             #   flood + anti-entropy wire protocol (ALPN waves-mesh/0)
      src/net/               #   iroh endpoint config, neighbor links, discovery
      src/blobs/             #   announce/pull/reseed policy over iroh-blobs
    crates/radio-win/        # Windows-only: WiFi-Direct GO, WlanConnect join (cfg(windows))
    crates/spike/            # Phase-0 hardware validation binary (run on 2 laptops)
  docs/MESH.md               # this file
```

## Message schema (bridge-ready, fixed by D4)

```jsonc
{
  "id": "<blake3-hex>",          // canonical — what the UI dedups on
  "origin_id": "<endpoint-id>",  // Ed25519 pubkey of the originating device
  "origin_seq": 42,              // monotonic per-origin counter (anti-entropy key)
  "lamport": 1337,               // mesh-wide logical clock (UI ordering)
  "created_at_ms": 0,            // origin wall clock, display only, never reconciliation
  "kind": "text" | "image",
  "body": { "text": "..." } | { "blob": { "hash", "size", "mime", "thumb_b64" } },
  "author": { "name": "...", "color": "#..." },
  "room": "mesh-<CODE>",         // mesh rooms namespace; maps to custom-<CODE> at bridge time
  "sig": "<ed25519-sig>"         // over canonical bytes
}
```

## Phase plan & status

Conventions for continuing sessions: work top-down, keep each phase shippable, run the
full gate set before checking a box (`cd src-tauri && cargo test && cargo clippy`,
plus frontend/backend gates per CLAUDE.md when touched), commit incrementally with
`WAVES_AGENT_COMMIT=1 git commit` (see `.claude/hooks/block-destructive-git.js`).
If the latest commit on this branch is < 30 min old, another session is likely active — stop.

- [x] P0.a Research + architecture synthesis (6-agent fan-out, 2026-06-10)
- [x] P0.b Branch, hook escape hatch, this spec
- [x] P0.c **Hardware spike binary** (`crates/spike`): `waves-spike auto` runs the
      whole pipeline (discovery → text → blob w/ throughput) with PASS/FAIL
      summary; `waves-spike caps` reports adapter capabilities. Verified on Linux
      loopback (2 MB blob @ 31 MB/s). Radio host/join wires in at P3.
      OWNER ACTION (still open): run `waves-spike auto` on 2 Windows 11 laptops
      (one with `--blob-mb 5`), firewalled, no internet — if discovery fails,
      that confirms the firewall-rule requirement (P1.g); also run
      `waves-spike caps` on each and report the output.
- [x] P1.a Rust workspace scaffold: `src-tauri` app crate + `mesh-core` + Tauri config
      pointing at `frontend/` (no duplicated UI — lesson of the dead `direct-p2p` branch)
- [x] P1.b `mesh-core`: identity + SQLite store + version vectors (unit-tested)
- [x] P1.c `mesh-core`: iroh endpoint (offline config) + neighbor link management +
      mDNS discovery + UDP beacon fallback; 3 loopback integration tests over real
      QUIC (bidirectional text, late-joiner sync, A–B–C bridge relay)
- [x] P1.d `mesh-core`: flood plane + anti-entropy plane — sans-IO engine, multi-node
      tests over in-memory links (A–B–C relay, diamond dedup, TTL+sync convergence,
      late joiner, partition heal, forgery rejection, restart persistence)
- [ ] P1.e Tauri IPC: commands (send, history, join-room) + Channel streams
      (messages, peers) + capability file.
      STATUS: code landed (`src-tauri/src/ipc.rs`, wired in `main.rs`) but has
      NEVER been compiled — Linux can't build the app crate (GTK missing, and
      MSVC cross-check dies in ring's build script needing lib.exe). The CI
      `mesh-windows` job added in `.github/workflows/ci.yml` is the gate: check
      this box only once that job is green on this code (fix what it reports).
- [x] P1.f Frontend transport seam: `src/transport/{index,web,tauri}.js`; Chat.jsx
      consumes the seam (797→~500 lines), JoinRoom gets the serverless tauri
      path (local name+color → mesh_set_author + mesh_info → user{id:
      endpointId}). Web behavior pinned by the untouched 63-test suite; 12 new
      tauri-transport tests (dtoToUi, room mapping, mesh-starting retry,
      subscribe filtering). @tauri-apps/api stays out of the web bundle via
      dynamic import (separate lazy chunks verified in the build).
- [x] P1.g NSIS installer config + firewall-rule hook (`installer-hooks.nsh`:
      program-scoped inbound allow on private+public profiles, idempotent,
      removed on uninstall). Config-only on this side — validated when the
      owner runs `cargo tauri build` on Windows and installs the `-setup.exe`.
- [x] P2.a Blob store + announce-then-pull + fetch-and-reseed in `mesh-core`
      (iroh-blobs; FetchBlob action w/ arrival-link provenance; 10 MiB
      auto-fetch cap; retries absorb relayers still mid-pull; real-QUIC tests
      incl. A–B–C reseed). IPC: mesh_send_image (raw body + Rust thumbnailing),
      mesh_export_blob (asset-protocol scope), blobReady/blobFailed events.
- [ ] P2.b Image send/render UI: picker → thumbnail gen → announce; asset-protocol
      rendering; transfer-progress Channel
- [ ] P3.a `radio-win`: legacy-AP GO host (vendored/modernized wifidirect-legacy-ap
      pattern, windows-rs 0.6x) + WlanConnect joiner + capability probe
- [ ] P3.b Host/Join UI: SSID/PSK derived from room code; first-class errors
      ("Mobile Hotspot is on", "WiFi is off"); GO liveness watchdog
- [ ] P4.a GO+STA chaining ("Extend mesh"): bridge nodes hold iroh links on both
      subnets; flood/anti-entropy/reseed relays across (no new protocol work)
- [ ] P4.b Multi-hop verification guide for owner (3-laptop A–B–C demo script)
- [ ] Docs sync: FRONTEND_STRUCTURE.md (seam), ARCHITECTURE.md (desktop mode),
      TESTING.md (cargo gates), README

## Riskiest assumptions (validate in this order)

1. iroh mDNS discovery on firewalled Win11 → P0.c; fallback = UDP beacon (1-day risk).
2. GO+STA concurrency on commodity adapters (Intel AX2xx / Realtek / MediaTek) — the
   least-evidenced claim in the research. If it fails: P4 degrades to star topology.
3. mDNS multicast + QUIC across the ICS 192.168.137.x subnet on the Public profile.
4. iroh rc.1 API churn before 1.0 — pin exact versions; iroh isolated behind
   `mesh-core::net` so the migration is one module.
5. wifidirect-legacy-ap modernizes from windows-rs 0.58 to 0.6x — else rewrite its
   ~300 lines against current windows-rs.

## Dev environment notes

- Agent develops on WSL2/Linux: `mesh-core` fully buildable/testable there.
  The app crate and `radio-win` CANNOT be verified from Linux (GTK missing for
  a native check; `--target x86_64-pc-windows-msvc` dies in ring's build script
  wanting MSVC `lib.exe`). The CI `mesh-windows` job (windows-latest, full
  `cargo check --workspace --all-targets` + `cargo test`) is the authoritative
  gate for Windows-only code — push and watch it.
- Owner builds/runs the real app on Windows: `cd src-tauri && cargo tauri dev`
  (frontend dev server on 5174 must be running) or `cargo tauri build` for the installer.
