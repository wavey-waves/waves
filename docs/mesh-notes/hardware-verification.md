# Hardware verification guide (OWNER ACTION — P0.c / P3 / P4.b)

Everything below runs the `waves-spike` binary; no app install needed. Each
phase prints a `SPIKE SUMMARY` with PASS/FAIL lines — please report those plus
the `caps` output per laptop.

## Build the spike (once per laptop)

```powershell
# needs Rust (rustup.rs) — no Node/Tauri required for the spike
git clone https://github.com/wavey-waves/waves -b offline-mesh
cd waves/src-tauri
cargo build --release -p waves-spike
# binary: target\release\waves-spike.exe
```

**Firewall:** the spike has no installer, so the NSIS firewall rule (P1.g)
doesn't exist for it. Either click **Allow** on the Windows Security prompt at
first run (check BOTH private and public networks), or pre-add the rule as
admin:

```powershell
netsh advfirewall firewall add rule name="waves-spike" dir=in action=allow program="<full path>\waves-spike.exe" enable=yes profile=private,public
```

## Phase A — same network, no internet (validates discovery + transfer)

Both laptops on the same WiFi (an isolated AP or a phone hotspot with mobile
data OFF). Internet must be unavailable to make the point.

```powershell
# laptop 1
waves-spike auto --name laptop1
# laptop 2 (also pushes a 5 MB blob through the mesh)
waves-spike auto --name laptop2 --blob-mb 5
```

Expect on both: `PEER UP` within ~5 s, `TEXT from …`, and on laptop 1 a
`BLOB READY … MB/s` line. Report the throughput number.

## Phase B — WiFi-Direct, zero infrastructure (validates the radio layer)

No AP, no hotspot, WiFi *on* but not connected. Pick any 6-char code.

```powershell
# laptop 1 (host)
waves-spike radio host AB12CD --name host --blob-mb 5
# laptop 2 (joiner)
waves-spike radio join AB12CD --name joiner
```

Expect: laptop 1 prints `AP up: WAVES-AB12CD`; laptop 2 connects in ≤25 s,
then the same PEER UP/TEXT/BLOB sequence as Phase A. Known failure modes worth
reporting verbatim: `AP aborted … ResourceInUse` (Mobile Hotspot was on),
join timeout (check laptop 2 can see `WAVES-AB12CD` in its WiFi list — on
Win11 24H2 the scan needs Location services ON).

## Phase C — three-laptop chain (validates multi-hop, needs GO+STA concurrency)

First check `waves-spike caps` on the middle laptop: it needs
`Simultaneous station and GO : Supported` (or the probe line
`go_sta_concurrency: true`). If unsupported, the chain degrades to
star-topology — still report that, it caps decision D3's promise.

```powershell
# laptop A (far end, hosts chain link 1)
waves-spike radio host CODE11 --name alpha --blob-mb 5
# laptop B (bridge: joins A's network, hosts link 2)
waves-spike radio extend CODE11 CODE22 --name bridge
# laptop C (far end, joins B's network)
waves-spike radio join CODE22 --name carol
```

Expect on laptop C: `TEXT from alpha` and `BLOB READY` — a message and a 5 MB
image that crossed two radio hops with no shared network between A and C.
That's the project's core claim; the protocol part already passes in CI over
in-process links, this proves it over real radios.

## What to send back

1. `waves-spike caps` output from every laptop (full netsh dump).
2. The `SPIKE SUMMARY` blocks from each phase.
3. Any error lines verbatim (especially radio aborts/timeouts).
4. WiFi adapter models (Device Manager → Network adapters) — for the
   compatibility matrix in docs/MESH.md risk #2.
