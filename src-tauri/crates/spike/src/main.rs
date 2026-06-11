//! Phase-0 hardware spike (docs/MESH.md P0.c): validates the riskiest
//! assumptions on real Windows hardware before the app depends on them.
//!
//! Run on two (or three) firewalled Windows 11 laptops on the same network
//! segment — an isolated AP, a phone hotspot with no internet, or (P3) a
//! WiFi-Direct legacy AP:
//!
//!   waves-spike auto --name laptop-A                # both machines
//!   waves-spike auto --name laptop-B --blob-mb 5    # one machine also sends a 5 MB blob
//!   waves-spike caps                                # report adapter capabilities
//!
//! PASS criteria printed at the end: discovery found a peer, a text message
//! arrived from the peer, and (receiver side) the announced blob downloaded
//! with a throughput figure.

use std::time::{Duration, Instant};

use mesh_core::net::{MeshNode, NodeConfig};
use mesh_core::proto::engine::MeshEvent;
use mesh_core::proto::message::{Author, Body};

fn usage() -> ! {
    eprintln!(
        "usage:\n  waves-spike auto [--name <id>] [--blob-mb <N>] [--seconds <S>]\n  waves-spike caps\n  waves-spike radio host <CODE> [auto flags]     (start WiFi-Direct AP, then run auto)\n  waves-spike radio join <CODE> [auto flags]     (join the AP, then run auto)\n  waves-spike radio extend <UP> <DOWN> [flags]   (join UP, host DOWN — chain bridge)"
    );
    std::process::exit(2);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match args.first().map(String::as_str) {
        Some("auto") => {
            let get = |flag: &str| {
                args.iter()
                    .position(|a| a == flag)
                    .and_then(|i| args.get(i + 1))
                    .cloned()
            };
            let name = get("--name").unwrap_or_else(|| format!("spike-{}", std::process::id()));
            let blob_mb: u64 = get("--blob-mb").and_then(|v| v.parse().ok()).unwrap_or(0);
            let seconds: u64 = get("--seconds").and_then(|v| v.parse().ok()).unwrap_or(90);
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("tokio runtime")
                .block_on(auto(name, blob_mb, seconds))
        }
        Some("caps") => caps(),
        Some("radio") => run_radio(&args),
        _ => usage(),
    };
    std::process::exit(code);
}

/// Radio modes: set up the WiFi-Direct layer, then run the same `auto`
/// pipeline over it. The mesh layer is radio-agnostic — once the OS-level
/// link exists, discovery and transfer behave exactly as on any LAN.
fn run_radio(args: &[String]) -> i32 {
    #[cfg(not(windows))]
    {
        let _ = args;
        eprintln!("radio modes require Windows (WiFi-Direct); see docs/mesh-notes/hardware-verification.md");
        2
    }
    #[cfg(windows)]
    {
        let get = |flag: &str| {
            args.iter()
                .position(|a| a == flag)
                .and_then(|i| args.get(i + 1))
                .cloned()
        };
        let name = get("--name").unwrap_or_else(|| format!("spike-{}", std::process::id()));
        let blob_mb: u64 = get("--blob-mb").and_then(|v| v.parse().ok()).unwrap_or(0);
        let seconds: u64 = get("--seconds").and_then(|v| v.parse().ok()).unwrap_or(180);

        let mode = args.get(1).map(String::as_str);
        let positional: Vec<&String> = args[2..].iter().take_while(|a| !a.starts_with("--")).collect();

        // Keep hosts alive for the whole run: the GO dies with the value.
        let mut hosts: Vec<radio_win::host::LegacyApHost> = Vec::new();
        let mut joined: Option<String> = None;

        let setup: Result<(), String> = (|| {
            match (mode, positional.as_slice()) {
                (Some("host"), [code]) => {
                    hosts.push(radio_host_blocking(code)?);
                    Ok(())
                }
                (Some("join"), [code]) => {
                    joined = Some(radio_join_blocking(code)?);
                    Ok(())
                }
                (Some("extend"), [up, down]) => {
                    joined = Some(radio_join_blocking(up)?);
                    hosts.push(radio_host_blocking(down)?);
                    Ok(())
                }
                _ => Err("bad radio arguments".into()),
            }
        })();
        if let Err(e) = setup {
            eprintln!("FAIL: radio setup: {e}");
            return 2;
        }

        let code = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("tokio runtime")
            .block_on(auto(name, blob_mb, seconds));

        if let Some(ssid) = joined {
            let _ = radio_win::join::leave(&ssid);
        }
        drop(hosts);
        code
    }
}

#[cfg(windows)]
fn radio_host_blocking(code: &str) -> Result<radio_win::host::LegacyApHost, String> {
    let (ssid, passphrase) = radio_win::creds::derive_credentials(code);
    println!("starting WiFi-Direct AP: SSID={ssid}");
    let (tx, rx) = std::sync::mpsc::channel();
    let host =
        radio_win::host::LegacyApHost::start(&ssid, &passphrase, tx).map_err(|e| e.to_string())?;
    match rx.recv_timeout(std::time::Duration::from_secs(15)) {
        Ok(radio_win::RadioEvent::ApStarted) => {
            println!("AP up: {ssid} (clients lease 192.168.137.x via ICS)");
            Ok(host)
        }
        Ok(radio_win::RadioEvent::ApAborted(detail)) => {
            Err(format!("AP aborted: {detail} (Mobile Hotspot on? radio off?)"))
        }
        Ok(other) => Err(format!("unexpected radio event: {other:?}")),
        Err(_) => Err("timed out waiting for AP start".into()),
    }
}

#[cfg(windows)]
fn radio_join_blocking(code: &str) -> Result<String, String> {
    let (ssid, passphrase) = radio_win::creds::derive_credentials(code);
    println!("joining {ssid} (scan + connect, up to ~25s)...");
    radio_win::join::join(&ssid, &passphrase, std::time::Duration::from_secs(25))
        .map_err(|e| e.to_string())?;
    println!("connected to {ssid}");
    Ok(ssid)
}

async fn auto(name: String, blob_mb: u64, seconds: u64) -> i32 {
    let data_dir = std::env::temp_dir().join(format!("waves-spike-{}", std::process::id()));
    let node = match MeshNode::spawn(NodeConfig {
        data_dir: data_dir.clone(),
        author: Author {
            name: name.clone(),
            color: "#10b981".into(),
        },
        beacon: true,
    })
    .await
    {
        Ok(n) => n,
        Err(e) => {
            eprintln!("FAIL: node failed to start: {e}");
            return 2;
        }
    };

    println!("node up: {} ({name})", node.endpoint_id());
    for _ in 0..40 {
        let addrs: Vec<_> = node.local_addr().ip_addrs().cloned().collect();
        if !addrs.is_empty() {
            println!("listening on: {addrs:?}");
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    println!("waiting up to {seconds}s for peers (mDNS + UDP beacon active)...");

    let own = *node.endpoint_id().as_bytes();
    let mut events = node.subscribe();
    let started = Instant::now();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);

    let mut peer_found = false;
    let mut sent_payloads = false;
    let mut text_from_peer = false;
    let mut blob_announced_at: Option<(Instant, u64)> = None;
    let mut blob_result: Option<String> = None;

    loop {
        let event = tokio::select! {
            ev = events.recv() => match ev { Ok(ev) => ev, Err(_) => break },
            _ = tokio::time::sleep_until(deadline) => break,
        };
        match event {
            MeshEvent::PeerUp(p) => {
                println!("[{:>5.1}s] PEER UP: {} ({})", started.elapsed().as_secs_f32(), p.name, hexid(&p.origin_id));
                peer_found = true;
                if !sent_payloads {
                    sent_payloads = true;
                    let _ = node
                        .send_text("mesh-spike", format!("hello from {name}"))
                        .await;
                    println!("        sent hello text");
                    if blob_mb > 0 {
                        let bytes: Vec<u8> =
                            (0..blob_mb * 1024 * 1024).map(|i| (i % 251) as u8).collect();
                        match node
                            .send_image("mesh-spike", bytes, "application/octet-stream".into(), vec![1, 2, 3])
                            .await
                        {
                            Ok(_) => println!("        announced {blob_mb} MB blob"),
                            Err(e) => println!("        blob announce FAILED: {e}"),
                        }
                    }
                }
            }
            MeshEvent::PeerDown(origin) => {
                println!("[{:>5.1}s] peer down: {}", started.elapsed().as_secs_f32(), hexid(&origin));
            }
            MeshEvent::Message(m) if m.msg.origin_id != own => {
                match &m.msg.body {
                    Body::Text { text } => {
                        println!("[{:>5.1}s] TEXT from {}: {text}", started.elapsed().as_secs_f32(), m.msg.author.name);
                        text_from_peer = true;
                    }
                    Body::Image { blob } => {
                        println!("[{:>5.1}s] blob announced by {}: {} bytes", started.elapsed().as_secs_f32(), m.msg.author.name, blob.size);
                        blob_announced_at = Some((Instant::now(), blob.size));
                    }
                }
            }
            MeshEvent::BlobReady { hash } => {
                let detail = match blob_announced_at {
                    Some((t0, size)) => {
                        let secs = t0.elapsed().as_secs_f64();
                        format!("{:.1} MB in {secs:.1}s = {:.2} MB/s", size as f64 / 1e6, size as f64 / 1e6 / secs)
                    }
                    None => "(own blob)".into(),
                };
                println!("[{:>5.1}s] BLOB READY {}: {detail}", started.elapsed().as_secs_f32(), &hexid(&hash));
                if blob_announced_at.is_some() {
                    blob_result = Some(detail);
                }
            }
            MeshEvent::BlobFailed { hash, reason } => {
                println!("[{:>5.1}s] BLOB FAILED {}: {reason}", started.elapsed().as_secs_f32(), &hexid(&hash));
            }
            _ => {}
        }
    }

    println!("\n===== SPIKE SUMMARY ({name}) =====");
    let check = |label: &str, ok: bool| {
        println!("  {} {label}", if ok { "PASS" } else { "FAIL" });
        ok
    };
    let mut all = check("discovery: found at least one peer", peer_found);
    all &= check("text: received a message from a peer", text_from_peer);
    if let Some(detail) = &blob_result {
        check(&format!("blob: received announced blob ({detail})"), true);
    } else if blob_announced_at.is_some() {
        all = false;
        check("blob: announced blob arrived", false);
    } else {
        println!("  ---- blob: nothing announced to this node (run the other side with --blob-mb 5)");
    }
    let _ = std::fs::remove_dir_all(&data_dir);
    node.shutdown().await;
    if all {
        0
    } else {
        2
    }
}

fn caps() -> i32 {
    #[cfg(windows)]
    {
        for args in [
            ["wlan", "show", "wirelesscapabilities"],
            ["wlan", "show", "drivers"],
        ] {
            println!("===== netsh {} =====", args.join(" "));
            match std::process::Command::new("netsh").args(args).output() {
                Ok(out) => println!("{}", String::from_utf8_lossy(&out.stdout)),
                Err(e) => println!("failed to run netsh: {e}"),
            }
        }
        println!("probe: {:?}", radio_win::probe_capabilities());
        0
    }
    #[cfg(not(windows))]
    {
        eprintln!("caps is Windows-only (WiFi-Direct adapter probing); the mesh itself runs anywhere");
        2
    }
}

fn hexid(bytes: &[u8; 32]) -> String {
    mesh_core::identity::encode_hex(&bytes[..6])
}
