//! Waves mesh core — the platform-independent heart of Waves Desktop.
//!
//! Implements the protocol specified in `docs/MESH.md`:
//! - [`identity`]: one Ed25519 keypair per device, persisted to disk. The same
//!   key signs messages and (in the `net` layer) backs the iroh endpoint, so a
//!   message's `origin_id` *is* the peer's network identity.
//! - [`store`]: SQLite message log with per-origin sequence numbers — the
//!   substrate for store-and-forward anti-entropy sync.
//! - [`proto`]: the two-plane propagation protocol. A TTL-bounded flood plane
//!   for real-time delivery and a version-vector anti-entropy plane for
//!   eventual delivery (late joiners, partition heals, multi-hop relay).
//!
//! The engine in [`proto::engine`] is deliberately sans-IO: it consumes frames
//! and returns actions, so the whole protocol is unit-testable on any OS with
//! in-memory links. Network IO (iroh) adapts to it in the `net` module.

pub mod error;
pub mod identity;
pub mod net;
pub mod proto;
pub mod store;

pub use error::{MeshError, Result};
