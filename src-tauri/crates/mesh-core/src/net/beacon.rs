//! UDP broadcast beacon — discovery fallback for networks where mDNS fails
//! (docs/MESH.md L2). SSB's proven pattern: broadcast a tiny presence packet
//! at 1 Hz, dial whoever you hear that you aren't linked to yet.
//!
//! Payload: `"WAVES1" || endpoint_id (32 bytes) || quic_port (u16 le)`.
//! The sender's IP comes from the UDP source address, so multi-interface
//! hosts advertise correctly on every subnet they broadcast into.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use iroh::{EndpointAddr, PublicKey};
use tokio::net::UdpSocket;

use super::Shared;

pub const BEACON_PORT: u16 = 47474;
const MAGIC: &[u8; 6] = b"WAVES1";
const PERIOD: Duration = Duration::from_secs(1);
const PAYLOAD_LEN: usize = 6 + 32 + 2;

pub(super) async fn run(shared: Arc<Shared>) -> std::io::Result<()> {
    // Prefer the well-known port (send + receive). If another instance on
    // this host owns it, fall back to an ephemeral port: we can still
    // announce ourselves, and the sibling instance still hears us.
    let socket = match UdpSocket::bind(("0.0.0.0", BEACON_PORT)).await {
        Ok(s) => s,
        Err(e) => {
            tracing::info!("beacon port busy ({e}); send-only beacon on ephemeral port");
            UdpSocket::bind(("0.0.0.0", 0)).await?
        }
    };
    socket.set_broadcast(true)?;

    let own_id = *shared.own_id.as_bytes();
    let mut tick = tokio::time::interval(PERIOD);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut buf = [0u8; 64];

    loop {
        tokio::select! {
            _ = tick.tick() => {
                if let Some(port) = quic_port(&shared) {
                    let mut payload = Vec::with_capacity(PAYLOAD_LEN);
                    payload.extend_from_slice(MAGIC);
                    payload.extend_from_slice(&own_id);
                    payload.extend_from_slice(&port.to_le_bytes());
                    let dest = SocketAddr::from(([255, 255, 255, 255], BEACON_PORT));
                    if let Err(e) = socket.send_to(&payload, dest).await {
                        tracing::debug!("beacon send failed: {e}");
                    }
                }
            }
            recv = socket.recv_from(&mut buf) => {
                let Ok((n, from)) = recv else { continue };
                if let Some(addr) = parse(&buf[..n], from, &own_id) {
                    shared.clone().dial_if_new(addr).await;
                }
            }
        }
    }
}

fn quic_port(shared: &Shared) -> Option<u16> {
    shared
        .endpoint
        .addr()
        .ip_addrs()
        .next()
        .map(|sock| sock.port())
}

fn parse(payload: &[u8], from: SocketAddr, own_id: &[u8; 32]) -> Option<EndpointAddr> {
    if payload.len() != PAYLOAD_LEN || &payload[..6] != MAGIC {
        return None;
    }
    let id: [u8; 32] = payload[6..38].try_into().ok()?;
    if &id == own_id {
        return None;
    }
    let port = u16::from_le_bytes(payload[38..40].try_into().ok()?);
    let key = PublicKey::from_bytes(&id).ok()?;
    Some(EndpointAddr::new(key).with_ip_addr(SocketAddr::new(from.ip(), port)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_accepts_valid_and_rejects_self_and_garbage() {
        let own = [7u8; 32];
        let other_key = iroh::SecretKey::from_bytes(&[9u8; 32]).public();
        let from: SocketAddr = "192.168.137.42:9999".parse().unwrap();

        let mut valid = Vec::new();
        valid.extend_from_slice(MAGIC);
        valid.extend_from_slice(other_key.as_bytes());
        valid.extend_from_slice(&4242u16.to_le_bytes());
        let addr = parse(&valid, from, &own).expect("valid beacon parses");
        assert_eq!(addr.id, other_key);
        let sock = addr.ip_addrs().next().unwrap();
        assert_eq!(sock.port(), 4242);
        assert_eq!(sock.ip(), from.ip());

        // Own beacon echoed back: ignored.
        let mut own_pkt = Vec::new();
        own_pkt.extend_from_slice(MAGIC);
        own_pkt.extend_from_slice(&own);
        own_pkt.extend_from_slice(&4242u16.to_le_bytes());
        assert!(parse(&own_pkt, from, &own).is_none());

        // Garbage: ignored.
        assert!(parse(b"not a beacon", from, &own).is_none());
        assert!(parse(&valid[..10], from, &own).is_none());
    }
}
