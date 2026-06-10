//! Multi-node protocol tests over an in-memory network of sans-IO engines.
//! These are the tests that must stay green on Linux CI: they prove the
//! multi-hop properties (A–B–C relay, dedup, TTL, anti-entropy) without any
//! real networking.

use std::collections::{HashMap, VecDeque};

use mesh_core::identity::DeviceIdentity;
use mesh_core::proto::engine::{Action, LinkId, MeshEngine, MeshEvent};
use mesh_core::proto::message::{Author, Body, OriginId, SignedMessage};
use mesh_core::proto::wire::Frame;
use mesh_core::store::Store;

/// An in-memory mesh: engines plus a link table. Actions returned by one
/// engine are routed (breadth-first) to the linked engine until quiescent —
/// the deterministic equivalent of the net layer's QUIC plumbing.
struct TestNet {
    engines: Vec<MeshEngine>,
    origins: Vec<OriginId>,
    /// (node, link_id_on_that_node) -> (peer_node, link_id_on_peer)
    routes: HashMap<(usize, LinkId), (usize, LinkId)>,
    next_link: LinkId,
    /// Events emitted per node, in order.
    events: Vec<Vec<MeshEvent>>,
    _dirs: Vec<tempfile::TempDir>,
}

impl TestNet {
    fn new(n: usize) -> Self {
        let mut engines = Vec::new();
        let mut origins = Vec::new();
        let mut dirs = Vec::new();
        for i in 0..n {
            let dir = tempfile::tempdir().unwrap();
            let identity = DeviceIdentity::load_or_create(dir.path()).unwrap();
            origins.push(identity.public_bytes());
            engines.push(
                MeshEngine::new(
                    identity,
                    Author {
                        name: format!("node{i}"),
                        color: "#7c3aed".into(),
                    },
                    Store::open_in_memory().unwrap(),
                )
                .unwrap(),
            );
            dirs.push(dir);
        }
        Self {
            engines,
            origins,
            routes: HashMap::new(),
            next_link: 1,
            events: vec![Vec::new(); n],
            _dirs: dirs,
        }
    }

    /// Connect two nodes and run the resulting handshake to quiescence.
    fn connect(&mut self, a: usize, b: usize) {
        let la = self.next_link;
        let lb = self.next_link + 1;
        self.next_link += 2;
        self.routes.insert((a, la), (b, lb));
        self.routes.insert((b, lb), (a, la));

        let actions_a = self.engines[a].link_up(la).unwrap();
        self.run(a, actions_a);
        let actions_b = self.engines[b].link_up(lb).unwrap();
        self.run(b, actions_b);
    }

    /// Route a batch of actions from `node` until no frames remain in flight.
    fn run(&mut self, node: usize, actions: Vec<Action>) {
        let mut queue: VecDeque<(usize, Action)> =
            actions.into_iter().map(|a| (node, a)).collect();
        while let Some((from, action)) = queue.pop_front() {
            match action {
                Action::Emit(ev) => self.events[from].push(ev),
                Action::Send(link, frame) => {
                    let Some(&(to, to_link)) = self.routes.get(&(from, link)) else {
                        continue; // link torn down mid-flight
                    };
                    let sender_origin = self.origins[from];
                    let next = self.engines[to]
                        .handle_frame(to_link, frame, sender_origin)
                        .unwrap();
                    queue.extend(next.into_iter().map(|a| (to, a)));
                }
            }
        }
    }

    fn send_text(&mut self, node: usize, room: &str, text: &str) -> SignedMessage {
        let (msg, actions) = self.engines[node]
            .compose(room, Body::Text { text: text.into() }, 1_700_000_000_000)
            .unwrap();
        self.run(node, actions);
        msg
    }

    fn sync_all(&mut self) {
        for node in 0..self.engines.len() {
            let actions = self.engines[node].sync_tick().unwrap();
            self.run(node, actions);
        }
    }

    fn texts_seen(&self, node: usize) -> Vec<String> {
        self.events[node]
            .iter()
            .filter_map(|e| match e {
                MeshEvent::Message(m) => match &m.msg.body {
                    Body::Text { text } => Some(text.clone()),
                    _ => None,
                },
                _ => None,
            })
            .collect()
    }

    fn history_len(&self, node: usize, room: &str) -> usize {
        self.engines[node].history(room, 1000).unwrap().len()
    }
}

#[test]
fn flood_relays_across_a_chain_a_b_c() {
    // A - B - C: A and C are never directly connected.
    let mut net = TestNet::new(3);
    net.connect(0, 1);
    net.connect(1, 2);

    net.send_text(0, "mesh-X", "hello forest");

    for node in 0..3 {
        assert_eq!(
            net.texts_seen(node),
            vec!["hello forest"],
            "node {node} should see the message exactly once"
        );
        assert_eq!(net.history_len(node, "mesh-X"), 1);
    }
}

#[test]
fn diamond_topology_delivers_exactly_once() {
    // A - B, A - C, B - D, C - D: two paths from A to D.
    let mut net = TestNet::new(4);
    net.connect(0, 1);
    net.connect(0, 2);
    net.connect(1, 3);
    net.connect(2, 3);

    net.send_text(0, "mesh-X", "no doubles");

    for node in 0..4 {
        assert_eq!(
            net.texts_seen(node).len(),
            1,
            "node {node} must emit exactly one message event despite multiple paths"
        );
    }
}

#[test]
fn ttl_exhaustion_is_healed_by_anti_entropy() {
    // Chain of 12: flood TTL (8) reaches hop 9 and dies; the far nodes get
    // the message via sync ticks instead (one hop of catch-up per tick).
    const N: usize = 12;
    let mut net = TestNet::new(N);
    for i in 0..N - 1 {
        net.connect(i, i + 1);
    }

    net.send_text(0, "mesh-X", "far away");

    let reached: Vec<usize> = (0..N).filter(|&n| net.texts_seen(n).len() == 1).collect();
    assert!(
        reached.len() < N,
        "TTL should stop the pure flood before the end of a 12-chain"
    );

    // Each sync round advances the frontier at least one hop.
    for _ in 0..N {
        net.sync_all();
    }
    for node in 0..N {
        assert_eq!(
            net.texts_seen(node).len(),
            1,
            "node {node} must converge via anti-entropy"
        );
    }
}

#[test]
fn late_joiner_receives_history_on_connect() {
    let mut net = TestNet::new(3);
    net.connect(0, 1);
    net.send_text(0, "mesh-X", "one");
    net.send_text(1, "mesh-X", "two");

    // C arrives after the conversation happened, linked only to B.
    net.connect(1, 2);

    let mut seen = net.texts_seen(2);
    seen.sort();
    assert_eq!(seen, vec!["one", "two"]);
    assert_eq!(net.history_len(2, "mesh-X"), 2);
}

#[test]
fn partitioned_nodes_converge_after_reconnect() {
    let mut net = TestNet::new(2);
    // No link yet: both sides write concurrently while partitioned.
    net.send_text(0, "mesh-X", "from A");
    net.send_text(1, "mesh-X", "from B");

    net.connect(0, 1);

    for node in 0..2 {
        assert_eq!(net.history_len(node, "mesh-X"), 2, "node {node}");
    }
}

#[test]
fn tampered_message_is_dropped_and_not_relayed() {
    let mut net = TestNet::new(3);
    net.connect(0, 1);
    net.connect(1, 2);

    // Craft a legitimate message, then tamper with the body.
    let (mut msg, _) = net.engines[0]
        .compose("mesh-X", Body::Text { text: "real".into() }, 1)
        .unwrap();
    msg.msg.body = Body::Text {
        text: "forged".into(),
    };

    // Inject it at B as if it arrived from A.
    let origin = net.origins[0];
    let actions = net.engines[1]
        .handle_frame(1, Frame::Flood { ttl: 8, msg }, origin)
        .unwrap();
    net.run(1, actions);

    assert!(net.texts_seen(1).is_empty(), "B must not emit the forgery");
    assert!(net.texts_seen(2).is_empty(), "C must not receive a relay");
}

#[test]
fn peers_are_announced_and_removed() {
    let mut net = TestNet::new(2);
    net.connect(0, 1);

    let ups: Vec<_> = net.events[0]
        .iter()
        .filter(|e| matches!(e, MeshEvent::PeerUp(_)))
        .collect();
    assert_eq!(ups.len(), 1, "A sees B exactly once");
    assert_eq!(net.engines[0].peers().len(), 1);

    let actions = net.engines[0].link_down(1);
    net.run(0, actions);
    assert!(net.engines[0].peers().is_empty());
    assert!(net.events[0]
        .iter()
        .any(|e| matches!(e, MeshEvent::PeerDown(_))));
}

#[test]
fn sequence_and_lamport_survive_restart() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("mesh.db");
    let author = Author {
        name: "n".into(),
        color: "#fff".into(),
    };

    let first_run = {
        let identity = DeviceIdentity::load_or_create(dir.path()).unwrap();
        let mut engine =
            MeshEngine::new(identity, author.clone(), Store::open(&db).unwrap()).unwrap();
        let (m1, _) = engine
            .compose("mesh-X", Body::Text { text: "a".into() }, 1)
            .unwrap();
        let (m2, _) = engine
            .compose("mesh-X", Body::Text { text: "b".into() }, 2)
            .unwrap();
        assert_eq!(m1.msg.origin_seq, 1);
        assert_eq!(m2.msg.origin_seq, 2);
        m2
    };

    // "Restart": same key dir, same db file.
    let identity = DeviceIdentity::load_or_create(dir.path()).unwrap();
    let mut engine = MeshEngine::new(identity, author, Store::open(&db).unwrap()).unwrap();
    let (m3, _) = engine
        .compose("mesh-X", Body::Text { text: "c".into() }, 3)
        .unwrap();

    assert_eq!(
        m3.msg.origin_seq, 3,
        "per-origin sequence must continue, not restart (duplicate (origin,seq) would poison sync)"
    );
    assert!(
        m3.msg.lamport > first_run.msg.lamport,
        "lamport must never move backwards across restarts"
    );
    assert_eq!(engine.history("mesh-X", 10).unwrap().len(), 3);
}
