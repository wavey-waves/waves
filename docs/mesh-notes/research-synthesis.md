# Waves Offline P2P Mesh — Architecture Synthesis (June 2026)

## 0. Resolving the research contradictions

Two contradictions among the agents must be settled before the architecture holds together:

**Contradiction 1: iroh-gossip (rust-p2p-stacks) vs. custom TTL-flood + anti-entropy (mesh-protocol-design, mesh-prior-art).**
Resolved in favor of the **custom flood + anti-entropy protocol, running over iroh connections**. Reasoning: (a) The WiFi-Direct research establishes that forest-mode topology is a chain/star of *isolated* 192.168.137.x subnets — A and C have **no IP path**. iroh-gossip's HyParView membership assumes it can dial sampled peers; in a chain topology those dials fail structurally. A protocol that only ever talks to directly-connected neighbors is the correct shape. (b) Even on one flat LAN, gossipsub/iroh-gossip provide **no store-and-forward** (gossipsub seen-cache is ~2 min; Waku had to bolt Store/Sync on top) — late joiners and rejoining nodes are a hard requirement for a forest chat, so the anti-entropy layer must be built regardless. Once you've built anti-entropy + per-neighbor flooding, iroh-gossip adds nothing at 5–50 nodes. The "don't hand-roll, you'd reimplement PlumTree" objection dissolves: we are not reimplementing PlumTree, we're implementing ~500 lines of bitchat/Meshtastic-style flooding plus SSB-style version-vector sync — the pattern every *shipped* offline messenger converged on.

**Contradiction 2: iroh stack vs. hand-rolled mdns-sd + quinn.**
Resolved in favor of **iroh as the connection layer only** (Endpoint + discovery + iroh-blobs), with our own ALPN protocol on top, **rejecting iroh-gossip**. iroh gives us, per-link: QUIC transport, TLS encryption, stable Ed25519 EndpointId identity (solves the bitchat impersonation embarrassment for free), mDNS local discovery, and — decisively — **iroh-blobs 0.102.0** (BLAKE3 verified streaming, resumable, content-addressed), which is exactly the image-transfer layer we'd otherwise hand-write. Hand-rolling mdns-sd + quinn means reimplementing identity, encryption, and verified chunked transfer for a marginal binary-size win. libp2p is rejected: ~12-month release gap on the umbrella crate (0.56.0, 2025-06-27), documented Windows mDNS flakiness (#5524, #2676), and the Berty/qaul lesson that heavy-framework proximity mesh is a multi-year sinkhole. Version status check (2026-06-10): iroh 1.0 final has **not** shipped; [rc.1 (2026-05-27) is "the last release candidate before 1.0"](https://github.com/n0-computer/iroh/releases) — pin rc.1, budget one small migration at 1.0.

---

## 1. Recommended Architecture

### Layer 1 — Radio / IP substrate (Windows-specific)
- **Phase-1 substrate: any shared IP network** (existing AP, travel router, phone hotspot with no internet). Every shipped desktop offline system (SSB, Briar Desktop, qaul) is IP-on-LAN; this works today with zero radio code.
- **Forest mode: WiFi-Direct legacy-AP (autonomous GO)** via `WiFiDirectAdvertisementPublisher` + `LegacySettings` (SSID + WPA2 passphrase ≥ 8 chars), the Flying Carpet pattern. No pairing, no consent prompts, callable from a Win32/Tauri process with no UWP manifest. Joiners use Win32 `WlanConnect` with a temporary WPA2PSK profile, `<enableRandomization>false</enableRandomization>`. Vendor/fork `spieglt/wifidirect-legacy-ap` v0.4.0 and bump it from `windows` 0.58 to 0.62.x.
- **Multi-hop topology: GO+STA chaining.** Each node can host its own GO while its STA port joins one neighbor's GO. Each hop is an isolated ICS subnet (GO = 192.168.137.1) — **no IP routing across hops; all multi-hop propagation is app-layer relay** (which Layer 3 is designed for).
- **Explicitly rejected:** `NetworkOperatorTetheringManager` (cannot start offline; mutually exclusive with the GO and "takes precedence over all Wi-Fi Direct scenarios"); classic WFD pairing (`WiFiDirectDevice.FromIdAsync` — unresolved `DevicePairingResultStatus_Failed` reports); deprecated hosted-network APIs.
- **Bluetooth: not in v1.** No project has ever shipped BT/BLE mesh on Windows desktop; realistic Windows BLE is 9–50 KB/s (a 3 MB photo = 1–5 min/hop); btleplug is central-only so two btleplug nodes can't even discover each other. Revisit post-v1 as a discovery/credential side-channel only.

### Layer 2 — Neighbor links and discovery
- **iroh Endpoint, pinned to 1.0.0-rc.1**, configured strictly offline: `RelayMode::Disabled`, no DNS/pkarr discovery, `discovery-local-network` (MdnsDiscovery / `iroh-mdns-address-lookup`) **enabled** (it is off by default — a naive integration works in the office and fails in the forest).
- mDNS scope matches the topology: it only finds same-subnet peers, which is exactly right — A discovers B on hop 1's subnet, B discovers C on hop 2's. A bridge node holds iroh connections on both subnets.
- **Fallback discovery** (if the spike shows swarm-discovery flakiness on Windows): SSB-style 1 Hz UDP broadcast beacon `{endpoint_id, quic_addr, display_name}` — ~50 lines of Rust, proven pattern.
- **Firewall is part of the architecture:** NSIS perMachine installer adds program-scoped inbound allow rules (`netsh advfirewall ... profile=private,public`) for UDP 5353 + the QUIC port. The built-in Windows mDNS rule covers only svchost/dnscache; without our rule, discovery silently finds nobody (the documented #1 failure mode).

### Layer 3 — Mesh propagation protocol (custom, ~500 lines, two planes)
Custom ALPN (e.g. `waves-mesh/0`) on iroh connections:
1. **Flood plane (real-time):** message ID = BLAKE3 over canonical bytes (origin_id, origin_seq, lamport, timestamp, body); exact-match seen-ID LRU (~10k entries — *not* a Bloom filter; false positives silently drop messages and exact IDs are free at this scale); TTL = 8, decrement per hop; forward to all neighbor links except arrival link with 10–50 ms jitter + cancel-on-duplicate (Meshtastic's suppression, adapted). Every message Ed25519-signed by a persisted per-device key.
2. **Anti-entropy plane (eventual delivery):** each node numbers its own messages with a monotonic per-origin sequence, persisted in SQLite. On neighbor connect and every ~30 s, exchange version vectors `{origin_id → max_seq}` and batch-stream the gaps (SSB feed replication / Briar BSP batch mode). This one mechanism handles late joiners, rejoins, partition heals, and makes A–B–C delivery fall out for free (B stores the log). Never reconcile by wall-clock — forest laptops have no NTP. UI ordering: (lamport, timestamp, origin_id).
3. **Critical integration point:** the mesh's canonical message ID must flow end-to-end into the existing React dedup (the tempId-upsert pattern in `Chat.jsx`), or users see doubled messages when a message arrives via both flood and anti-entropy.

### Layer 4 — Images (announce-then-pull; never flood bytes)
- Chat message carries only **blob metadata**: BLAKE3 root hash, size, MIME, plus an inline ~10 KB thumbnail (thumbnail rides the flood; full image does not).
- Receivers pull the blob via **iroh-blobs per-hop** from the neighbor that relayed the announcement; BLAKE3 verified streaming validates chunks mid-transfer.
- **Fetch-and-reseed at every relay** (ssb-blobs "sympathetic want"): intermediate nodes auto-fetch announced blobs and serve their own neighbors — this is what moves a 5 MB image across A–B–C where A and C share no IP path, and makes every relay a seeder for late joiners. Auto-fetch cap ~10 MB; LRU blob-cache eviction, but never evict blobs referenced inside the sync horizon.
- Flooding a 3 MB photo with TTL 8 would multiply into hundreds of MB of redundant traffic; gossipsub's 64 KiB `max_transmit_size` exists for a reason.

### Layer 5 — Tauri 2 integration
- **Stack pins:** tauri 2.11.2, @tauri-apps/api 2.11.0, tauri-cli 2.11.2 (current as of 2026-05-16).
- `src-tauri/` as a **third package** beside `frontend/` and `backend/`; `tauri.conf.json`: `devUrl = http://localhost:5174` (Waves' non-default Vite port — copy-pasted examples point at 5173), `frontendDist = ../frontend/dist`, Vite `strictPort: true`.
- **Transport seam in the frontend**, switched on `isTauri()` from `@tauri-apps/api/core`: web build keeps socket.io-client + axios `/api`; Tauri build sends via `invoke` and receives via long-lived **`tauri::ipc::Channel`** streams (one per concern: messages, peer-list, blob-progress). The seam must cover REST too — relative `/api` paths do not exist inside the packaged app (origin is `http://tauri.localhost`). Never use the event system for the chat stream (officially "not designed for high throughput", JSON-only, no ArrayBuffer).
- **Image rendering: never bytes over IPC on Windows** (~200 ms per 10 MB on WebView2 vs ~5 ms on macOS). Write received blobs to app-data dir; render via `convertFileSrc()` / asset protocol (`http://asset.localhost`), with assetProtocol scope + CSP entries.
- Rust side: mesh stack on Tauri's default tokio runtime (`tauri::async_runtime::spawn` in `Builder::setup`), bridged by `tokio::mpsc` channels in `manage()`d state behind `tokio::sync::Mutex`. Capability file must grant `core:default` + one permission per command or every invoke fails.
- **Installer:** NSIS perMachine `-setup.exe`, `webviewInstallMode: embedBootstrapper` minimum (`offlineInstaller`, +127 MB, if truly internet-free first install matters — see Decision 5), plus the netsh firewall-rule hook.

### Repo layout
```
waves/
  frontend/            # unchanged React app + new src/transport/ seam (web impl + tauri impl)
  backend/             # unchanged Express/Socket.IO server (web mode)
  src-tauri/           # Tauri 2 crate
    src/mesh/          # flood + anti-entropy protocol, SQLite store
    src/blobs/         # iroh-blobs integration, cache policy
    src/radio/         # wifidirect-legacy-ap fork, WlanConnect join, capability probing
    src/discovery/     # iroh mDNS config + UDP-beacon fallback
  docs/                # add MESH.md (protocol spec); update FRONTEND_STRUCTURE.md for the seam
```

---

## 2. Phased Implementation Plan (each phase independently shippable)

**Phase 0 — Risk spike (2–3 days, not shippable, gates everything).** Two firewalled Windows 11 laptops, isolated AP, no internet: (a) iroh rc.1 with RelayMode::Disabled + MdnsDiscovery — do they find and connect to each other? (b) iroh-blobs 5 MB transfer + throughput number. (c) `wifidirect-legacy-ap` GO up on laptop 1, `WlanConnect` join from laptop 2, then repeat (a)+(b) across the 192.168.137.x subnet on Public firewall profile. (d) `netsh wlan show wirelesscapabilities` on every adapter you can find. Output: go/no-go on iroh mDNS (else UDP beacon), and the adapter-capability reality.

**Phase 1 — Waves Desktop: serverless LAN chat (the demonstrably useful core).** Tauri scaffold, transport seam, iroh endpoint + mDNS discovery, flood + anti-entropy + SQLite, signed messages, text only, NSIS installer with firewall hook. Ship: "open Waves on any laptops on the same WiFi — chat works with no internet and no server." Already useful (LAN parties, planes, offices), and the protocol is multi-hop-correct from day one even though one LAN is 1 hop.

**Phase 2 — Images.** Blob announce + thumbnail in flood; iroh-blobs pull; fetch-and-reseed; disk cache; asset-protocol rendering; transfer-progress Channel. Ship: offline LAN chat with high-quality images.

**Phase 3 — Forest mode, one hop.** "Host mesh" button = legacy-AP GO with SSID/PSK derived from a Waves room code; "Join" = WlanConnect with the same derivation; first-class errors for "Mobile Hotspot is on" / "WiFi is off"; GO liveness watchdog (Win11 can fail to transition Status to Aborted). Ship: a group of laptops in a field with one host — true zero infrastructure.

**Phase 4 — Multi-hop chaining.** GO+STA concurrency: a joined node also hosts its own GO; bridge nodes hold iroh links on both subnets and the existing flood/anti-entropy/blob-reseed relays across them (no new protocol work — that's the payoff of Layer 3's design). Manual chain assembly first ("extend mesh" button). Ship: the A–B–C demo.

**Phase 5 — Optional bridging.** Desktop node with internet syncs mesh history up to the existing MongoDB/Socket.IO server (see Decision 4); possible BLE presence beacon for credential bootstrap.

---

## 3. Genuine Architectural Decision Points (owner must choose)

**D1 — Connection layer: iroh rc.1 (recommended) vs. hand-rolled mdns-sd + quinn.**
iroh: identity + encryption + verified blob transfer for free; monthly releases; but pre-1.0 (one breaking migration guaranteed) and its swarm-discovery mDNS is less Windows-proven than mdns-sd 0.20.0 (the best-maintained Windows mDNS crate). Hand-rolled: maximum control, smallest binary, best mDNS — but you write identity, link encryption, and chunked verified transfer yourself (~2–4 extra weeks, more crypto surface to get wrong). If Phase 0(a) fails on Windows, the answer flips partially: keep iroh QUIC + blobs, swap discovery to mdns-sd or the UDP beacon.

**D2 — Forest-mode credentials: room-code-derived SSID/PSK (recommended) vs. BLE out-of-band exchange.**
Derived: zero exchange ceremony, no BLE hardware matrix, matches Waves' existing `custom-<CODE>` join-code model; tradeoff — anyone who learns the code can join the radio network, and the code must encode enough entropy for a WPA2 passphrase. BLE exchange (Flying Carpet's pattern): random per-session credentials, doubles as proximity discovery; tradeoff — adds the entire BLE failure chain (IsPeripheralRoleSupported variance, adapter matrix) to v1's critical path.

**D3 — Multi-hop topology: manual (recommended for v1) vs. self-organizing.**
Manual: user taps "Host" / "Join" / "Extend"; humans in a forest can see each other; ships in Phase 3/4. Self-organizing: GO election, automatic chain repair when a bridge node leaves, RSSI-based parent selection — genuinely hard distributed-systems work (this is where Berty spent years). A middle node's STA port is consumed by its uplink, so topology mistakes strand subtrees; automation multiplies that risk.

**D4 — Relationship to the existing Waves server: separate world vs. bridged.**
Separate (simpler): desktop mesh rooms are their own namespace; no MongoDB sync; mesh identity = device keypair, unrelated to JWT accounts. Bridged (more "Waves"): mesh messages flow into the server's `custom-<CODE>` rooms when any node has internet; requires unifying the Mongo message schema with the mesh's (origin_id, origin_seq, BLAKE3 id) addressing and mapping device keys to user accounts — decide *before* Phase 1, because it fixes the canonical message-ID schema.

**D5 — Installer footprint: perMachine + embedBootstrapper (recommended) vs. fully-offline maximalist vs. no-admin.**
perMachine + embedBootstrapper: ~2 MB overhead, UAC once, firewall rules installed, but first install on a WebView2-less machine needs internet. offlineInstaller: +~127 MB, installs anywhere ever offline. currentUser/no-admin: frictionless install but cannot add firewall rules — discovery silently breaks and users must click through (or miss) the Security Alert; not really viable given Layer 2, which is why this is a decision about how much install friction you'll accept, not whether firewall rules matter.

---

## 4. Riskiest Assumptions — validate in this order

1. **iroh mDNS discovery works on firewalled Windows 11** (swarm-discovery has no confirmed Windows showstoppers in public issues, but also little Windows-specific evidence — [iroh local-discovery docs](https://docs.iroh.computer/connecting/local-discovery), [swarm-discovery](https://github.com/rkuhn/swarm-discovery)). Phase 0(a). Fallback exists (UDP beacon), so this is a one-day risk, not a project risk.
2. **GO+STA concurrency and the legacy-AP GO work on commodity adapters** — `IsPeripheralRoleSupported`-style variance applies to WiFi too; Flying Carpet proves host+internet concurrency on some hardware, but "GO while STA-joined to *another GO*" (the chain link) is the single least-evidenced claim in all the research. Phase 0(c)/(d) + a small hardware matrix (Intel AX2xx, Realtek, MediaTek). If chaining fails on common adapters, Phase 4 degrades to star-only topology — still useful, but cap the promise now.
3. **mDNS multicast and QUIC actually traverse the ICS 192.168.137.x GO subnet on the "Public" firewall profile** — three interacting Windows behaviors (ICS DHCP, profile classification, multicast on the virtual adapter) that no research agent tested end-to-end. Phase 0(c).
4. **iroh rc.1 API stability through your build window** — 1.0 final had not shipped as of 2026-06-10 ([releases](https://github.com/n0-computer/iroh/releases), [rc.0 announcement](https://www.iroh.computer/blog/iroh-1-0-0-rc-0)); rc-cycle churn already moved mDNS into `iroh-mdns-address-lookup`. Pin exact versions; isolate iroh behind a thin trait in `src/mesh/` so the 1.0 migration is one module.
5. **The wifidirect-legacy-ap fork modernizes cleanly** from `windows` 0.58 to 0.62.x (Flying Carpet's own TODOs say error handling is blocked on this). Half-day check during Phase 0; if painful, the crate is ~11 commits — rewrite its ~300 lines against current windows-rs.
6. **Asset-protocol image rendering + Channel-based message streaming perform acceptably on WebView2** — lowest risk (documented patterns), verify as part of Phase 2 rather than up front.

Sources for the synthesis-level checks: [iroh releases](https://github.com/n0-computer/iroh/releases), [iroh 1.0.0-rc.0 blog](https://www.iroh.computer/blog/iroh-1-0-0-rc-0), [iroh roadmap](https://www.iroh.computer/roadmap), [iroh local discovery docs](https://docs.iroh.computer/connecting/local-discovery), [iroh 0.92.0 mDNS improvements](https://www.iroh.computer/blog/iroh-0-92-0-mdns-improvements), [swarm-discovery](https://github.com/rkuhn/swarm-discovery), [iroh issue #2505 (flaky local discovery test)](https://github.com/n0-computer/iroh/issues/2505). All other facts are from the six research agents' cited sources.