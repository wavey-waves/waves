//! Phase-0 hardware spike (docs/MESH.md P0.c): validates the riskiest
//! assumptions on real Windows hardware before the app depends on them.
//!
//! Planned checks (implemented alongside the net layer):
//!   1. discovery  — two firewalled Win11 laptops find each other via mDNS
//!   2. blob       — 5 MB iroh-blobs transfer + throughput number
//!   3. radio      — WiFi-Direct legacy-AP GO up, second laptop joins,
//!      then checks 1+2 across the 192.168.137.x subnet
//!   4. caps       — adapter capability report

fn main() {
    let caps = radio_win::probe_capabilities();
    eprintln!("waves-spike: checks not yet implemented (P0.c — see docs/MESH.md)");
    eprintln!("adapter capabilities (stub): {caps:?}");
    std::process::exit(2);
}
