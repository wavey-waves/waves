//! Integration tests for the net layer: real iroh endpoints over loopback,
//! no mDNS dependence (CI containers regularly block multicast), explicit
//! dialing via `connect_to`. These prove the QUIC adapter delivers what the
//! engine tests already prove in memory.

use std::net::SocketAddr;
use std::time::Duration;

use iroh::EndpointAddr;
use mesh_core::net::{MeshNode, NodeConfig};
use mesh_core::proto::engine::MeshEvent;
use mesh_core::proto::message::{Author, Body};
use tokio::sync::broadcast;
use tokio::time::timeout;

const WAIT: Duration = Duration::from_secs(20);

fn config(dir: &tempfile::TempDir, name: &str) -> NodeConfig {
    NodeConfig {
        data_dir: dir.path().to_path_buf(),
        author: Author {
            name: name.into(),
            color: "#10b981".into(),
        },
        // Beacon off: tests dial explicitly for determinism.
        beacon: false,
    }
}

/// A dialable loopback address for a node: its real QUIC port on 127.0.0.1.
async fn loopback_addr(node: &MeshNode) -> EndpointAddr {
    let id = node.endpoint_id();
    for _ in 0..100 {
        if let Some(port) = node.local_addr().ip_addrs().next().map(|a| a.port()) {
            let sock: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
            return EndpointAddr::new(id).with_ip_addr(sock);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("endpoint never reported a bound address");
}

async fn wait_for_blob_ready(rx: &mut broadcast::Receiver<MeshEvent>, want: &[u8; 32]) {
    timeout(WAIT, async {
        loop {
            match rx.recv().await.expect("event stream open") {
                MeshEvent::BlobReady { hash } if hash == *want => return,
                MeshEvent::BlobFailed { hash, reason } if hash == *want => {
                    panic!("blob fetch failed: {reason}")
                }
                _ => {}
            }
        }
    })
    .await
    .expect("timed out waiting for BlobReady");
}

/// Deterministic pseudo-image payload.
fn test_bytes(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i % 251) as u8).collect()
}

async fn wait_for_text(rx: &mut broadcast::Receiver<MeshEvent>, want: &str) {
    timeout(WAIT, async {
        loop {
            if let MeshEvent::Message(m) = rx.recv().await.expect("event stream open") {
                if let Body::Text { text } = &m.msg.body {
                    if text == want {
                        assert!(m.verify(), "delivered message must verify");
                        return;
                    }
                }
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {want:?}"));
}

#[tokio::test]
async fn text_flows_both_ways_over_real_quic() {
    let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let a = MeshNode::spawn(config(&dir_a, "alice")).await.unwrap();
    let b = MeshNode::spawn(config(&dir_b, "bob")).await.unwrap();

    let mut a_events = a.subscribe();
    let mut b_events = b.subscribe();

    b.connect_to(loopback_addr(&a).await).await;

    a.send_text("mesh-NET", "ping from a".into()).await.unwrap();
    wait_for_text(&mut b_events, "ping from a").await;

    b.send_text("mesh-NET", "pong from b".into()).await.unwrap();
    wait_for_text(&mut a_events, "pong from b").await;

    // Peer metadata flowed through the Hello exchange.
    let peers = a.peers().await;
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].name, "bob");
    assert_eq!(peers[0].origin_id, *b.endpoint_id().as_bytes());

    a.shutdown().await;
    b.shutdown().await;
}

#[tokio::test]
async fn late_joiner_syncs_history_over_real_quic() {
    let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let a = MeshNode::spawn(config(&dir_a, "alice")).await.unwrap();

    // Alice talks to herself before bob exists.
    a.send_text("mesh-NET", "early one".into()).await.unwrap();
    a.send_text("mesh-NET", "early two".into()).await.unwrap();

    let b = MeshNode::spawn(config(&dir_b, "bob")).await.unwrap();
    let mut b_events = b.subscribe();
    b.connect_to(loopback_addr(&a).await).await;

    // Connect-time anti-entropy must deliver the back-history.
    wait_for_text(&mut b_events, "early one").await;
    wait_for_text(&mut b_events, "early two").await;

    let history = b.history("mesh-NET", 50).await.unwrap();
    assert_eq!(history.len(), 2);

    a.shutdown().await;
    b.shutdown().await;
}

#[tokio::test]
async fn image_blob_is_pulled_by_the_receiver() {
    let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let a = MeshNode::spawn(config(&dir_a, "alice")).await.unwrap();
    let b = MeshNode::spawn(config(&dir_b, "bob")).await.unwrap();
    let mut b_events = b.subscribe();

    b.connect_to(loopback_addr(&a).await).await;

    let payload = test_bytes(256 * 1024);
    let msg = a
        .send_image(
            "mesh-NET",
            payload.clone(),
            "image/jpeg".into(),
            vec![0xFF, 0xD8],
        )
        .await
        .unwrap();
    let hash = match &msg.msg.body {
        mesh_core::proto::message::Body::Image { blob } => blob.hash,
        other => panic!("expected image body, got {other:?}"),
    };

    wait_for_blob_ready(&mut b_events, &hash).await;
    assert_eq!(b.blob_bytes(&hash).await.unwrap(), payload);

    a.shutdown().await;
    b.shutdown().await;
}

#[tokio::test]
async fn image_blob_crosses_the_bridge_via_reseed() {
    // A — B — C: C never connects to A, so C's only source is B's reseed.
    let dirs: Vec<_> = (0..3).map(|_| tempfile::tempdir().unwrap()).collect();
    let a = MeshNode::spawn(config(&dirs[0], "alice")).await.unwrap();
    let b = MeshNode::spawn(config(&dirs[1], "bob")).await.unwrap();
    let c = MeshNode::spawn(config(&dirs[2], "carol")).await.unwrap();
    let mut c_events = c.subscribe();

    b.connect_to(loopback_addr(&a).await).await;
    c.connect_to(loopback_addr(&b).await).await;

    let payload = test_bytes(512 * 1024);
    let msg = a
        .send_image("mesh-NET", payload.clone(), "image/png".into(), vec![1])
        .await
        .unwrap();
    let hash = match &msg.msg.body {
        mesh_core::proto::message::Body::Image { blob } => blob.hash,
        other => panic!("expected image body, got {other:?}"),
    };

    // C's fetch may race B's own pull; the retry loop must absorb that.
    wait_for_blob_ready(&mut c_events, &hash).await;
    assert_eq!(c.blob_bytes(&hash).await.unwrap(), payload);

    a.shutdown().await;
    b.shutdown().await;
    c.shutdown().await;
}

#[tokio::test]
async fn three_nodes_relay_across_the_bridge_over_real_quic() {
    // A — B — C over real sockets: A and C never connect directly.
    let dirs: Vec<_> = (0..3).map(|_| tempfile::tempdir().unwrap()).collect();
    let a = MeshNode::spawn(config(&dirs[0], "alice")).await.unwrap();
    let b = MeshNode::spawn(config(&dirs[1], "bob")).await.unwrap();
    let c = MeshNode::spawn(config(&dirs[2], "carol")).await.unwrap();

    let mut c_events = c.subscribe();
    let mut a_events = a.subscribe();

    b.connect_to(loopback_addr(&a).await).await;
    c.connect_to(loopback_addr(&b).await).await;

    a.send_text("mesh-NET", "across the bridge".into())
        .await
        .unwrap();
    wait_for_text(&mut c_events, "across the bridge").await;

    c.send_text("mesh-NET", "and back again".into())
        .await
        .unwrap();
    wait_for_text(&mut a_events, "and back again").await;

    a.shutdown().await;
    b.shutdown().await;
    c.shutdown().await;
}
