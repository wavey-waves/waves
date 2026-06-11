//! The sans-IO protocol engine.
//!
//! The engine never touches the network: callers feed it events (a frame
//! arrived, a link came up, the user hit send, a sync timer fired) and it
//! returns [`Action`]s (send this frame on that link, emit this event to the
//! UI). That keeps the whole protocol — flood, dedup, TTL, anti-entropy —
//! unit-testable on any OS with in-memory links, and isolates iroh behind
//! the `net` adapter (docs/MESH.md risk #4).

use std::collections::HashMap;
use std::num::NonZeroUsize;

use lru::LruCache;

use crate::error::Result;
use crate::identity::DeviceIdentity;
use crate::proto::message::{Author, Body, MeshMessage, MessageId, OriginId, SignedMessage};
use crate::proto::wire::{Frame, SYNC_BATCH_MESSAGES};
use crate::store::Store;

/// Opaque handle for one neighbor link; the net layer maps these to QUIC
/// connections (one per directly-reachable peer).
pub type LinkId = u64;

/// Initial TTL on freshly-composed messages (docs/MESH.md L3.1).
pub const FLOOD_TTL: u8 = 8;

const SEEN_CACHE: usize = 10_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PeerInfo {
    pub origin_id: OriginId,
    pub name: String,
    pub color: String,
}

/// What the engine asks its caller to do.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    /// Write this frame to one neighbor link.
    Send(LinkId, Frame),
    /// Surface this to the application (UI layer).
    Emit(MeshEvent),
    /// An image message arrived over `via` announcing a blob we may not
    /// have: pull it from that neighbor (announce-then-pull, docs/MESH.md
    /// L4 — the relayer either has the blob or is fetching it itself, so
    /// per-hop pulls compose into multi-hop distribution).
    FetchBlob {
        via: LinkId,
        hash: [u8; 32],
        size: u64,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MeshEvent {
    /// A message this node hasn't seen before (own sends included).
    Message(SignedMessage),
    PeerUp(PeerInfo),
    PeerDown(OriginId),
    /// A previously-announced blob finished downloading into the local store.
    BlobReady { hash: [u8; 32] },
    /// A blob pull failed (or was skipped by policy); the thumbnail remains.
    BlobFailed { hash: [u8; 32], reason: String },
}

pub struct MeshEngine {
    identity: DeviceIdentity,
    author: Author,
    store: Store,
    seen: LruCache<MessageId, ()>,
    neighbors: HashMap<LinkId, Option<PeerInfo>>,
    next_seq: u64,
    lamport: u64,
}

impl MeshEngine {
    pub fn new(identity: DeviceIdentity, author: Author, store: Store) -> Result<Self> {
        let next_seq = store.max_seq(&identity.public_bytes())? + 1;
        let lamport = store.lamport()?;
        Ok(Self {
            identity,
            author,
            store,
            seen: LruCache::new(NonZeroUsize::new(SEEN_CACHE).expect("nonzero")),
            neighbors: HashMap::new(),
            next_seq,
            lamport,
        })
    }

    pub fn origin_id(&self) -> OriginId {
        self.identity.public_bytes()
    }

    pub fn set_author(&mut self, author: Author) {
        self.author = author;
    }

    pub fn peers(&self) -> Vec<PeerInfo> {
        self.neighbors.values().flatten().cloned().collect()
    }

    /// Room history for the UI, oldest first.
    pub fn history(&self, room: &str, limit: usize) -> Result<Vec<SignedMessage>> {
        self.store.recent(room, limit)
    }

    /// The user pressed send. Persists, emits locally, floods to neighbors.
    pub fn compose(
        &mut self,
        room: &str,
        body: Body,
        created_at_ms: u64,
    ) -> Result<(SignedMessage, Vec<Action>)> {
        self.lamport += 1;
        self.store.set_lamport(self.lamport)?;
        let msg = MeshMessage {
            origin_id: self.origin_id(),
            origin_seq: self.next_seq,
            lamport: self.lamport,
            created_at_ms,
            room: room.to_string(),
            author: self.author.clone(),
            body,
        };
        let signed = SignedMessage::create(msg, &self.identity)?;
        self.next_seq += 1;
        self.store.insert(&signed)?;
        self.seen.put(signed.id, ());

        let mut actions = vec![Action::Emit(MeshEvent::Message(signed.clone()))];
        actions.extend(self.flood_to_neighbors(&signed, FLOOD_TTL, None));
        Ok((signed, actions))
    }

    /// A neighbor link opened (the net layer already knows the peer's
    /// network identity). Sends our Hello and immediately requests sync —
    /// connect-time anti-entropy is what catches late joiners up.
    pub fn link_up(&mut self, link: LinkId) -> Result<Vec<Action>> {
        self.neighbors.insert(link, None);
        Ok(vec![
            Action::Send(
                link,
                Frame::Hello {
                    name: self.author.name.clone(),
                    color: self.author.color.clone(),
                },
            ),
            Action::Send(link, self.sync_request()?),
        ])
    }

    pub fn link_down(&mut self, link: LinkId) -> Vec<Action> {
        match self.neighbors.remove(&link).flatten() {
            Some(peer) => vec![Action::Emit(MeshEvent::PeerDown(peer.origin_id))],
            None => vec![],
        }
    }

    /// Periodic anti-entropy tick (~30 s): re-request sync from every
    /// neighbor. Cheap when in sync (one small frame each way).
    pub fn sync_tick(&mut self) -> Result<Vec<Action>> {
        let req = self.sync_request()?;
        Ok(self
            .neighbors
            .keys()
            .map(|&link| Action::Send(link, req.clone()))
            .collect())
    }

    /// One frame arrived from a neighbor.
    pub fn handle_frame(
        &mut self,
        from: LinkId,
        frame: Frame,
        peer_origin: OriginId,
    ) -> Result<Vec<Action>> {
        match frame {
            Frame::Hello { name, color } => {
                let info = PeerInfo {
                    origin_id: peer_origin,
                    name,
                    color,
                };
                let known = self.neighbors.insert(from, Some(info.clone()));
                // Only announce a peer once per link.
                if matches!(known, Some(None) | None) {
                    Ok(vec![Action::Emit(MeshEvent::PeerUp(info))])
                } else {
                    Ok(vec![])
                }
            }

            Frame::Flood { ttl, msg } => self.accept_message(msg, from, Some(ttl)),

            Frame::SyncRequest { vv } => {
                let their: HashMap<OriginId, u64> = vv.into_iter().collect();
                let mut missing = Vec::new();
                for (origin, my_max) in self.store.version_vector()? {
                    let after = their.get(&origin).copied().unwrap_or(0);
                    if my_max > after {
                        missing.extend(self.store.messages_after(&origin, after, usize::MAX)?);
                    }
                }
                // Chunk into batches; always end with done=true (even when
                // empty) so the peer can treat a request as completed.
                let mut actions = Vec::new();
                let mut chunks = missing.chunks(SYNC_BATCH_MESSAGES).peekable();
                if chunks.peek().is_none() {
                    actions.push(Action::Send(
                        from,
                        Frame::SyncBatch {
                            msgs: vec![],
                            done: true,
                        },
                    ));
                }
                while let Some(chunk) = chunks.next() {
                    actions.push(Action::Send(
                        from,
                        Frame::SyncBatch {
                            msgs: chunk.to_vec(),
                            done: chunks.peek().is_none(),
                        },
                    ));
                }
                Ok(actions)
            }

            Frame::SyncBatch { msgs, done: _ } => {
                let mut actions = Vec::new();
                for msg in msgs {
                    // Synced messages are NOT re-flooded: anti-entropy spreads
                    // pairwise (every node syncs all its neighbors), which
                    // converges without flood amplification.
                    actions.extend(self.accept_message(msg, from, None)?);
                }
                Ok(actions)
            }
        }
    }

    /// Common acceptance path for flood + sync: verify, dedup, persist, emit,
    /// queue a blob pull for image messages, and (flood only) relay onward
    /// with decremented TTL.
    fn accept_message(
        &mut self,
        msg: SignedMessage,
        arrival: LinkId,
        flood_ttl: Option<u8>,
    ) -> Result<Vec<Action>> {
        if self.seen.contains(&msg.id) {
            return Ok(vec![]);
        }
        if !msg.verify() {
            tracing::warn!(id = %msg.id_hex(), "dropping message with bad signature");
            return Ok(vec![]);
        }
        // Lamport receive rule: local clock jumps past anything observed.
        if msg.msg.lamport > self.lamport {
            self.lamport = msg.msg.lamport;
            self.store.set_lamport(self.lamport)?;
        }

        let is_new = self.store.insert(&msg)?;
        self.seen.put(msg.id, ());
        if !is_new {
            // Already persisted in an earlier run; nothing to do.
            return Ok(vec![]);
        }

        let mut actions = vec![Action::Emit(MeshEvent::Message(msg.clone()))];
        if let Body::Image { blob } = &msg.msg.body {
            // Pull from whoever delivered the announcement — fetch-and-reseed
            // makes every relay a seeder, which is what carries a blob across
            // hops that share no IP path.
            actions.push(Action::FetchBlob {
                via: arrival,
                hash: blob.hash,
                size: blob.size,
            });
        }
        if let Some(ttl) = flood_ttl {
            if ttl > 0 {
                actions.extend(self.flood_to_neighbors(&msg, ttl - 1, Some(arrival)));
            }
        }
        Ok(actions)
    }

    fn flood_to_neighbors(
        &self,
        msg: &SignedMessage,
        ttl: u8,
        except: Option<LinkId>,
    ) -> Vec<Action> {
        self.neighbors
            .keys()
            .filter(|&&link| Some(link) != except)
            .map(|&link| {
                Action::Send(
                    link,
                    Frame::Flood {
                        ttl,
                        msg: msg.clone(),
                    },
                )
            })
            .collect()
    }

    fn sync_request(&self) -> Result<Frame> {
        Ok(Frame::SyncRequest {
            vv: self.store.version_vector()?.into_iter().collect(),
        })
    }
}
