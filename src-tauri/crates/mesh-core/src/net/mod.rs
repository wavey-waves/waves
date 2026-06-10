//! Network layer: adapts iroh QUIC connections onto the sans-IO engine.
//!
//! This is the ONLY module that touches iroh (docs/MESH.md risk #4 — the 1.0
//! migration stays contained here). Responsibilities:
//! - one offline-configured iroh endpoint (relays disabled, mDNS lookup on),
//! - peer discovery (mDNS subscribe stream + UDP beacon fallback),
//! - one reader + one writer task per neighbor link, framing `wire::Frame`s
//!   over a long-lived bidirectional QUIC stream,
//! - a sync timer (~30 s anti-entropy tick),
//! - dispatching engine [`Action`]s: `Send` → link writer, `Emit` → the
//!   application's broadcast channel.

mod beacon;
mod link;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use iroh::endpoint::presets;
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMode, SecretKey};
use iroh_mdns_address_lookup::{DiscoveryEvent, MdnsAddressLookup};
use tokio::sync::{broadcast, mpsc, Mutex};
use tokio_stream::StreamExt;

use crate::error::Result;
use crate::identity::DeviceIdentity;
use crate::proto::engine::{Action, LinkId, MeshEngine, MeshEvent, PeerInfo};
use crate::proto::message::{Author, Body, SignedMessage};
use crate::proto::wire::Frame;
use crate::store::Store;

/// ALPN for the mesh protocol (docs/MESH.md L3).
pub const MESH_ALPN: &[u8] = b"waves-mesh/0";

/// Anti-entropy period (docs/MESH.md L3.2).
pub const SYNC_INTERVAL: Duration = Duration::from_secs(30);

/// Outbound frame queue per link; backpressure kicks in beyond this.
const LINK_QUEUE: usize = 256;
/// UI event fanout buffer.
const EVENT_BUFFER: usize = 1024;

#[derive(Clone, Debug)]
pub struct NodeConfig {
    /// Directory for the device key and message database.
    pub data_dir: PathBuf,
    pub author: Author,
    /// Enable the UDP broadcast beacon fallback (in addition to mDNS).
    pub beacon: bool,
}

/// A running mesh node: endpoint + engine + discovery + per-link IO tasks.
pub struct MeshNode {
    inner: Arc<Shared>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}

struct Shared {
    endpoint: Endpoint,
    own_id: EndpointId,
    engine: Mutex<MeshEngine>,
    /// Live links: id → writer queue + peer identity.
    links: Mutex<HashMap<LinkId, link::LinkHandle>>,
    /// Peers with a dial currently in flight (mDNS and the beacon both fire
    /// repeatedly; this stops a thundering herd of dials to one peer).
    dialing: Mutex<HashSet<EndpointId>>,
    events: broadcast::Sender<MeshEvent>,
    next_link: AtomicU64,
}

impl MeshNode {
    pub async fn spawn(config: NodeConfig) -> Result<Self> {
        let identity = DeviceIdentity::load_or_create(&config.data_dir)?;
        let store = Store::open(&config.data_dir.join("mesh.db"))?;
        let engine = MeshEngine::new(identity.clone(), config.author.clone(), store)?;

        let secret = SecretKey::from_bytes(&identity.secret_bytes());
        let own_id = secret.public();
        let mdns = MdnsAddressLookup::builder()
            .build(own_id)
            .map_err(|e| crate::MeshError::InvalidMessage(format!("mdns setup: {e}")))?;

        let endpoint = Endpoint::builder(presets::Minimal)
            .secret_key(secret)
            .relay_mode(RelayMode::Disabled)
            .alpns(vec![MESH_ALPN.to_vec()])
            .address_lookup(mdns.clone())
            .bind()
            .await
            .map_err(|e| crate::MeshError::InvalidMessage(format!("endpoint bind: {e}")))?;

        let (events, _) = broadcast::channel(EVENT_BUFFER);
        let inner = Arc::new(Shared {
            endpoint,
            own_id,
            engine: Mutex::new(engine),
            links: Mutex::new(HashMap::new()),
            dialing: Mutex::new(HashSet::new()),
            events,
            next_link: AtomicU64::new(1),
        });

        let mut tasks = Vec::new();

        // Accept loop: inbound connections become links.
        {
            let shared = inner.clone();
            tasks.push(tokio::spawn(async move {
                while let Some(incoming) = shared.endpoint.accept().await {
                    match incoming.await {
                        Ok(conn) => {
                            Shared::adopt_connection(shared.clone(), conn, link::Role::Acceptor)
                                .await
                        }
                        Err(e) => tracing::debug!("inbound connection failed: {e}"),
                    }
                }
            }));
        }

        // mDNS discovery: dial every newly-seen peer we're not yet linked to.
        {
            let shared = inner.clone();
            tasks.push(tokio::spawn(async move {
                let mut stream = mdns.subscribe().await;
                while let Some(event) = stream.next().await {
                    if let DiscoveryEvent::Discovered { endpoint_info, .. } = event {
                        let addr = endpoint_info.into_endpoint_addr();
                        shared.clone().dial_if_new(addr).await;
                    }
                }
            }));
        }

        // UDP beacon fallback (SSB-style 1 Hz broadcast).
        if config.beacon {
            let shared = inner.clone();
            tasks.push(tokio::spawn(async move {
                if let Err(e) = beacon::run(shared).await {
                    tracing::warn!("udp beacon stopped: {e}");
                }
            }));
        }

        // Anti-entropy timer.
        {
            let shared = inner.clone();
            tasks.push(tokio::spawn(async move {
                let mut tick = tokio::time::interval(SYNC_INTERVAL);
                tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    tick.tick().await;
                    let actions = {
                        let mut engine = shared.engine.lock().await;
                        engine.sync_tick().unwrap_or_default()
                    };
                    shared.apply(actions).await;
                }
            }));
        }

        Ok(Self { inner, tasks })
    }

    /// This node's stable identity (the Ed25519 public key).
    pub fn endpoint_id(&self) -> EndpointId {
        self.inner.own_id
    }

    /// Direct dial by explicit address — used by tests, the beacon, and
    /// (later) manual "connect to host" UX. mDNS makes this unnecessary on
    /// working LANs.
    pub async fn connect_to(&self, addr: EndpointAddr) {
        self.inner.clone().dial_if_new(addr).await;
    }

    /// The endpoint's current local addresses (for tests/diagnostics).
    pub fn local_addr(&self) -> EndpointAddr {
        self.inner.endpoint.addr()
    }

    /// Subscribe to mesh events (messages, peer up/down). Each subscriber
    /// gets every event from subscription time onward.
    pub fn subscribe(&self) -> broadcast::Receiver<MeshEvent> {
        self.inner.events.subscribe()
    }

    pub async fn send_text(&self, room: &str, text: String) -> Result<SignedMessage> {
        self.compose(room, Body::Text { text }).await
    }

    pub async fn compose(&self, room: &str, body: Body) -> Result<SignedMessage> {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let (msg, actions) = {
            let mut engine = self.inner.engine.lock().await;
            engine.compose(room, body, now_ms)?
        };
        self.inner.apply(actions).await;
        Ok(msg)
    }

    pub async fn history(&self, room: &str, limit: usize) -> Result<Vec<SignedMessage>> {
        self.inner.engine.lock().await.history(room, limit)
    }

    pub async fn peers(&self) -> Vec<PeerInfo> {
        self.inner.engine.lock().await.peers()
    }

    pub async fn set_author(&self, author: Author) {
        self.inner.engine.lock().await.set_author(author);
    }

    pub async fn shutdown(self) {
        for task in &self.tasks {
            task.abort();
        }
        self.inner.endpoint.close().await;
    }
}

impl Shared {
    /// Register a connection (either direction) as a mesh link and start its
    /// IO tasks. Duplicate links to the same peer are tolerated: flood dedup
    /// and idempotent sync make them harmless, and tolerating them beats
    /// dial-ordering rules that can deadlock asymmetric discovery.
    async fn adopt_connection(
        self: Arc<Self>,
        conn: iroh::endpoint::Connection,
        role: link::Role,
    ) {
        let link_id = self.next_link.fetch_add(1, Ordering::Relaxed);
        let peer = conn.remote_id();
        tracing::info!(link_id, peer = %peer, ?role, "mesh link up");

        let (tx, rx) = mpsc::channel::<Frame>(LINK_QUEUE);
        self.links.lock().await.insert(
            link_id,
            link::LinkHandle {
                peer,
                sender: tx,
            },
        );

        let actions = {
            let mut engine = self.engine.lock().await;
            engine.link_up(link_id).unwrap_or_default()
        };
        self.apply(actions).await;

        link::run(self, conn, link_id, peer, role, rx);
    }

    async fn dial_if_new(self: Arc<Self>, addr: EndpointAddr) {
        let peer = addr.id;
        if peer == self.own_id || self.linked_to(&peer).await {
            return;
        }
        if !self.dialing.lock().await.insert(peer) {
            return; // dial already in flight
        }
        let result = self.endpoint.connect(addr, MESH_ALPN).await;
        self.dialing.lock().await.remove(&peer);
        match result {
            Ok(conn) => self.adopt_connection(conn, link::Role::Dialer).await,
            Err(e) => tracing::debug!(peer = %peer, "dial failed: {e}"),
        }
    }

    async fn linked_to(&self, peer: &EndpointId) -> bool {
        self.links
            .lock()
            .await
            .values()
            .any(|l| l.peer == *peer)
    }

    /// Dispatch engine actions. Engine lock must NOT be held by the caller:
    /// queue sends can await on backpressure.
    async fn apply(&self, actions: Vec<Action>) {
        for action in actions {
            match action {
                Action::Emit(event) => {
                    // Send fails only when there are no subscribers — fine.
                    let _ = self.events.send(event);
                }
                Action::Send(link_id, frame) => {
                    let sender = {
                        let links = self.links.lock().await;
                        links.get(&link_id).map(|l| l.sender.clone())
                    };
                    if let Some(sender) = sender {
                        if sender.send(frame).await.is_err() {
                            tracing::debug!(link_id, "link writer gone; dropping frame");
                        }
                    }
                }
            }
        }
    }

    /// Tear down a link after its reader or writer stopped.
    async fn drop_link(self: &Arc<Self>, link_id: LinkId) {
        if self.links.lock().await.remove(&link_id).is_none() {
            return; // already removed by the twin task
        }
        let actions = {
            let mut engine = self.engine.lock().await;
            engine.link_down(link_id)
        };
        self.apply(actions).await;
        tracing::info!(link_id, "mesh link down");
    }
}
