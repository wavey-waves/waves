//! The waves-mesh propagation protocol (ALPN `waves-mesh/0`).
//!
//! Two planes, per `docs/MESH.md` L3:
//! - **Flood** ([`wire::Frame::Flood`]): real-time delivery. TTL-bounded,
//!   deduplicated by exact message ID, forwarded to every neighbor except the
//!   arrival link.
//! - **Anti-entropy** ([`wire::Frame::SyncRequest`]/[`wire::Frame::SyncBatch`]):
//!   eventual delivery. Peers exchange version vectors `{origin → max_seq}`
//!   on connect and periodically, then stream each other the gaps.

pub mod engine;
pub mod message;
pub mod wire;
