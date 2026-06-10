//! The canonical mesh message: content-addressed (BLAKE3) and origin-signed.
//!
//! Schema is bridge-ready per docs/MESH.md D4: `(origin_id, origin_seq)` keys
//! anti-entropy sync, `id` (BLAKE3 of canonical bytes) is what UIs dedup on,
//! and both survive unchanged if messages are later synced to the server.

use serde::{Deserialize, Serialize};

use crate::error::{MeshError, Result};
use crate::identity::{self, DeviceIdentity};

pub type OriginId = [u8; 32];
pub type MessageId = [u8; 32];

/// Reference to a content-addressed blob distributed out-of-band of the flood
/// (announce-then-pull, docs/MESH.md L4). The thumbnail rides the flood; the
/// full bytes never do.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlobRef {
    /// BLAKE3 root hash of the full blob (iroh-blobs content address).
    pub hash: [u8; 32],
    pub size: u64,
    pub mime: String,
    /// Inline thumbnail, ≤ ~10 KiB. Empty for non-image blobs.
    pub thumb: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Body {
    Text { text: String },
    Image { blob: BlobRef },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Author {
    pub name: String,
    pub color: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeshMessage {
    pub origin_id: OriginId,
    /// Monotonic per-origin counter; the anti-entropy sync key.
    pub origin_seq: u64,
    /// Mesh-wide Lamport clock; the primary UI ordering key.
    pub lamport: u64,
    /// Origin wall clock. Display only — never used for reconciliation
    /// (forest laptops have no NTP).
    pub created_at_ms: u64,
    pub room: String,
    pub author: Author,
    pub body: Body,
}

impl MeshMessage {
    /// Deterministic byte encoding — the input to both the BLAKE3 message ID
    /// and the Ed25519 signature. postcard encodes struct fields in
    /// declaration order with no map keys, so equal messages encode equally.
    pub fn canonical_bytes(&self) -> Result<Vec<u8>> {
        Ok(postcard::to_stdvec(self)?)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedMessage {
    pub msg: MeshMessage,
    /// BLAKE3 of `msg.canonical_bytes()`.
    pub id: MessageId,
    /// Ed25519 signature by `msg.origin_id` over the same canonical bytes.
    pub sig: Vec<u8>,
}

impl SignedMessage {
    pub fn create(msg: MeshMessage, identity: &DeviceIdentity) -> Result<Self> {
        if msg.origin_id != identity.public_bytes() {
            return Err(MeshError::InvalidMessage(
                "origin_id does not match signing identity".into(),
            ));
        }
        let canonical = msg.canonical_bytes()?;
        let id = *blake3::hash(&canonical).as_bytes();
        let sig = identity.sign(&canonical).to_vec();
        Ok(Self { msg, id, sig })
    }

    /// Recompute the content address and check the origin signature.
    /// Anything false here is dropped by the engine, never an error.
    pub fn verify(&self) -> bool {
        let Ok(canonical) = self.msg.canonical_bytes() else {
            return false;
        };
        if *blake3::hash(&canonical).as_bytes() != self.id {
            return false;
        }
        identity::verify(&self.msg.origin_id, &canonical, &self.sig)
    }

    pub fn id_hex(&self) -> String {
        identity::encode_hex(&self.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_identity() -> DeviceIdentity {
        let dir = tempfile::tempdir().unwrap();
        DeviceIdentity::load_or_create(dir.path()).unwrap()
    }

    fn text_msg(identity: &DeviceIdentity, seq: u64, text: &str) -> MeshMessage {
        MeshMessage {
            origin_id: identity.public_bytes(),
            origin_seq: seq,
            lamport: seq,
            created_at_ms: 1_700_000_000_000,
            room: "mesh-TEST01".into(),
            author: Author {
                name: "navi".into(),
                color: "#7c3aed".into(),
            },
            body: Body::Text { text: text.into() },
        }
    }

    #[test]
    fn id_is_stable_for_equal_messages() {
        let id = test_identity();
        let a = SignedMessage::create(text_msg(&id, 1, "hi"), &id).unwrap();
        let b = SignedMessage::create(text_msg(&id, 1, "hi"), &id).unwrap();
        assert_eq!(a.id, b.id);
    }

    #[test]
    fn id_changes_with_content() {
        let id = test_identity();
        let a = SignedMessage::create(text_msg(&id, 1, "hi"), &id).unwrap();
        let b = SignedMessage::create(text_msg(&id, 2, "hi"), &id).unwrap();
        let c = SignedMessage::create(text_msg(&id, 1, "hi!"), &id).unwrap();
        assert_ne!(a.id, b.id);
        assert_ne!(a.id, c.id);
    }

    #[test]
    fn verify_accepts_valid_and_rejects_tampered() {
        let id = test_identity();
        let mut m = SignedMessage::create(text_msg(&id, 1, "hi"), &id).unwrap();
        assert!(m.verify());

        // Tampered body: id no longer matches.
        m.msg.body = Body::Text { text: "evil".into() };
        assert!(!m.verify());
    }

    #[test]
    fn verify_rejects_forged_origin() {
        let id = test_identity();
        let other = test_identity();
        let mut m = SignedMessage::create(text_msg(&id, 1, "hi"), &id).unwrap();

        // Re-point the message at another origin and fix up the id so only
        // the signature check can catch the forgery.
        m.msg.origin_id = other.public_bytes();
        let canonical = m.msg.canonical_bytes().unwrap();
        m.id = *blake3::hash(&canonical).as_bytes();
        assert!(!m.verify());
    }

    #[test]
    fn create_refuses_mismatched_origin() {
        let id = test_identity();
        let other = test_identity();
        let mut msg = text_msg(&id, 1, "hi");
        msg.origin_id = other.public_bytes();
        assert!(SignedMessage::create(msg, &id).is_err());
    }
}
