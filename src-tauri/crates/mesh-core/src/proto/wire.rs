//! Wire frames exchanged between directly-connected neighbors, and the
//! length-prefixed encoding used on QUIC streams (ALPN `waves-mesh/0`).

use serde::{Deserialize, Serialize};

use crate::error::{MeshError, Result};
use crate::proto::message::{OriginId, SignedMessage};

/// Hard cap on an encoded frame. Sync batches are chunked to stay under it;
/// a frame above the cap on the read side means a corrupt or hostile peer.
pub const MAX_FRAME_BYTES: usize = 256 * 1024;

/// How many messages ride in one `SyncBatch` frame.
pub const SYNC_BATCH_MESSAGES: usize = 64;

// Variant sizes intentionally differ: Flood/SyncBatch carry whole messages
// while Hello is tiny. Frames are heap-built once and immediately encoded,
// so boxing the large variants would only add indirection.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Frame {
    /// Presence/metadata, first frame on every link in both directions.
    Hello { name: String, color: String },
    /// Flood plane: a fresh message being pushed through the mesh.
    Flood { ttl: u8, msg: SignedMessage },
    /// Anti-entropy: "here is everything I have — stream me what I'm missing."
    SyncRequest { vv: Vec<(OriginId, u64)> },
    /// Anti-entropy response. `done` marks the final batch for one request.
    SyncBatch { msgs: Vec<SignedMessage>, done: bool },
}

impl Frame {
    /// Encode as `u32-le length || postcard bytes`.
    pub fn encode(&self) -> Result<Vec<u8>> {
        let body = postcard::to_stdvec(self)?;
        if body.len() > MAX_FRAME_BYTES {
            return Err(MeshError::InvalidMessage(format!(
                "frame exceeds {} bytes",
                MAX_FRAME_BYTES
            )));
        }
        let mut out = Vec::with_capacity(4 + body.len());
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend_from_slice(&body);
        Ok(out)
    }

    /// Decode one frame body (length prefix already consumed by the reader).
    pub fn decode(body: &[u8]) -> Result<Self> {
        Ok(postcard::from_bytes(body)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_roundtrip() {
        let f = Frame::Hello {
            name: "navi".into(),
            color: "#7c3aed".into(),
        };
        let bytes = f.encode().unwrap();
        let len = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
        assert_eq!(len, bytes.len() - 4);
        assert_eq!(Frame::decode(&bytes[4..]).unwrap(), f);
    }

    #[test]
    fn oversized_frame_rejected() {
        let f = Frame::SyncBatch {
            msgs: vec![],
            done: false,
        };
        // Sanity: a frame is rejected only via encode-side size check, so
        // craft an oversized one by hand.
        let mut huge = f.clone();
        if let Frame::SyncBatch { msgs: _, done: _ } = &mut huge {}
        let big_name = "x".repeat(MAX_FRAME_BYTES + 1);
        let too_big = Frame::Hello {
            name: big_name,
            color: String::new(),
        };
        assert!(too_big.encode().is_err());
        assert!(f.encode().is_ok());
    }
}
