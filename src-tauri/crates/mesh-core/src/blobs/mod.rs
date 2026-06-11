//! Blob storage + transfer policy (docs/MESH.md L4).
//!
//! Wraps iroh-blobs: BLAKE3-content-addressed storage with verified
//! streaming transfer. The chat flood only ever carries blob *metadata*
//! (hash, size, mime, thumbnail); actual bytes move through per-hop pulls
//! over the blobs ALPN, and every node that completes a pull automatically
//! serves the blob onward (the store is the seeder — no extra code).

use std::path::Path;

use iroh_blobs::store::fs::FsStore;
use iroh_blobs::store::mem::MemStore;
use iroh_blobs::{api::Store, BlobsProtocol, Hash};

use crate::error::{MeshError, Result};

/// Blobs at or under this size are pulled automatically on announcement;
/// larger ones stay thumbnail-only until a user asks (docs/MESH.md L4 caps
/// auto-fetch so one huge file can't saturate a forest mesh).
pub const MAX_AUTOFETCH_BYTES: u64 = 10 * 1024 * 1024;

/// The ALPN the blob transfer protocol runs on (iroh-blobs').
pub use iroh_blobs::ALPN as BLOBS_ALPN;

#[derive(Clone)]
pub struct BlobService {
    store: Store,
}

impl BlobService {
    /// Persistent store under `dir` (the app's data dir).
    pub async fn open_fs(dir: &Path) -> Result<Self> {
        let store = FsStore::load(dir)
            .await
            .map_err(|e| MeshError::InvalidMessage(format!("blob store: {e}")))?;
        Ok(Self {
            store: store.into(),
        })
    }

    /// In-memory store for tests.
    pub fn open_mem() -> Self {
        let store = MemStore::new();
        Self {
            store: (*store).clone(),
        }
    }

    /// The protocol handler to serve blobs to neighbors (accept side).
    pub fn protocol_handler(&self) -> BlobsProtocol {
        BlobsProtocol::new(&self.store, None)
    }

    /// Add bytes, returning the BLAKE3 hash. Awaiting the add persists a tag
    /// that protects the blob (GC is off by default in iroh-blobs 0.102, so
    /// this is belt-and-braces).
    pub async fn add_bytes(&self, bytes: Vec<u8>) -> Result<[u8; 32]> {
        let tag = self
            .store
            .add_bytes(bytes)
            .await
            .map_err(|e| MeshError::InvalidMessage(format!("blob add: {e}")))?;
        Ok(*tag.hash.as_bytes())
    }

    pub async fn has(&self, hash: &[u8; 32]) -> bool {
        self.store
            .has(Hash::from_bytes(*hash))
            .await
            .unwrap_or(false)
    }

    /// Whole blob into memory (UI-sized images only — exports go to disk).
    pub async fn bytes(&self, hash: &[u8; 32]) -> Result<Vec<u8>> {
        let bytes = self
            .store
            .get_bytes(Hash::from_bytes(*hash))
            .await
            .map_err(|e| MeshError::InvalidMessage(format!("blob read: {e}")))?;
        Ok(bytes.to_vec())
    }

    /// Export a blob to an absolute path (asset-protocol rendering reads
    /// from disk; bytes never cross the Tauri IPC on Windows).
    pub async fn export(&self, hash: &[u8; 32], target: &Path) -> Result<u64> {
        let size = self
            .store
            .export(Hash::from_bytes(*hash), target)
            .await
            .map_err(|e| MeshError::InvalidMessage(format!("blob export: {e}")))?;
        Ok(size)
    }

    /// Pull a blob over an established blobs-ALPN connection (verified
    /// streaming; resumable on retry). The connection's peer is the seeder.
    pub async fn fetch(
        &self,
        conn: iroh::endpoint::Connection,
        hash: &[u8; 32],
    ) -> Result<()> {
        self.store
            .remote()
            .fetch(conn, Hash::from_bytes(*hash))
            .await
            .map_err(|e| MeshError::InvalidMessage(format!("blob fetch: {e}")))?;
        Ok(())
    }
}
