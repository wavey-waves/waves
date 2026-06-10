//! Device identity: a single Ed25519 keypair persisted to disk.
//!
//! The same 32 secret bytes back both message signing and the iroh endpoint
//! identity (`net` layer), so a message's `origin_id` equals the originating
//! device's network EndpointId — one identity, no mapping table.

use std::fs;
use std::path::{Path, PathBuf};

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::RngCore;

use crate::error::{MeshError, Result};

const KEY_FILE: &str = "device.key";

#[derive(Clone)]
pub struct DeviceIdentity {
    signing: SigningKey,
}

impl DeviceIdentity {
    /// Load the device key from `dir`, creating (and persisting) a fresh one
    /// on first run.
    pub fn load_or_create(dir: &Path) -> Result<Self> {
        let path = dir.join(KEY_FILE);
        if path.exists() {
            return Self::load(&path);
        }
        fs::create_dir_all(dir)?;
        let mut secret = [0u8; 32];
        rand::rng().fill_bytes(&mut secret);
        let identity = Self {
            signing: SigningKey::from_bytes(&secret),
        };
        write_key_file(&path, &secret)?;
        Ok(identity)
    }

    fn load(path: &PathBuf) -> Result<Self> {
        let hex = fs::read_to_string(path)?;
        let bytes = decode_hex32(hex.trim()).ok_or_else(|| {
            MeshError::InvalidMessage(format!("corrupt device key file: {}", path.display()))
        })?;
        Ok(Self {
            signing: SigningKey::from_bytes(&bytes),
        })
    }

    /// Public key bytes — the device's `origin_id` and network EndpointId.
    pub fn public_bytes(&self) -> [u8; 32] {
        self.signing.verifying_key().to_bytes()
    }

    /// Secret bytes, for deriving the iroh endpoint secret in the net layer.
    pub fn secret_bytes(&self) -> [u8; 32] {
        self.signing.to_bytes()
    }

    pub fn sign(&self, bytes: &[u8]) -> [u8; 64] {
        self.signing.sign(bytes).to_bytes()
    }
}

/// Verify `sig` over `bytes` against an origin's public key. Returns false on
/// any malformed input — callers drop the message rather than erroring.
pub fn verify(origin_id: &[u8; 32], bytes: &[u8], sig: &[u8]) -> bool {
    let Ok(vk) = VerifyingKey::from_bytes(origin_id) else {
        return false;
    };
    let Ok(sig) = Signature::from_slice(sig) else {
        return false;
    };
    vk.verify(bytes, &sig).is_ok()
}

fn write_key_file(path: &Path, secret: &[u8; 32]) -> Result<()> {
    let hex = encode_hex(secret);
    fs::write(path, hex)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

pub fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn decode_hex32(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64 || !s.is_ascii() {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, chunk) in s.as_bytes().chunks(2).enumerate() {
        let hi = (chunk[0] as char).to_digit(16)?;
        let lo = (chunk[1] as char).to_digit(16)?;
        out[i] = ((hi << 4) | lo) as u8;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_then_reloads_same_key() {
        let dir = tempfile::tempdir().unwrap();
        let a = DeviceIdentity::load_or_create(dir.path()).unwrap();
        let b = DeviceIdentity::load_or_create(dir.path()).unwrap();
        assert_eq!(a.public_bytes(), b.public_bytes());
    }

    #[test]
    fn sign_verify_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let id = DeviceIdentity::load_or_create(dir.path()).unwrap();
        let sig = id.sign(b"hello mesh");
        assert!(verify(&id.public_bytes(), b"hello mesh", &sig));
        assert!(!verify(&id.public_bytes(), b"tampered", &sig));
    }

    #[test]
    fn rejects_corrupt_key_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(KEY_FILE), "not-hex").unwrap();
        assert!(DeviceIdentity::load_or_create(dir.path()).is_err());
    }
}
