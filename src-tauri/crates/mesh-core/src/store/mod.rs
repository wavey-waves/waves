//! SQLite-backed message log — the substrate for store-and-forward.
//!
//! Every node persists every message it has seen (its own and relayed ones),
//! keyed by `(origin_id, origin_seq)`. The per-origin max sequence numbers
//! form the node's version vector, which the anti-entropy plane exchanges
//! with neighbors to stream exactly the missing gap (docs/MESH.md L3.2).

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::Result;
use crate::proto::message::{MessageId, OriginId, SignedMessage};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS messages (
    id          BLOB PRIMARY KEY,
    origin_id   BLOB NOT NULL,
    origin_seq  INTEGER NOT NULL,
    lamport     INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    room        TEXT NOT NULL,
    payload     BLOB NOT NULL,           -- postcard-encoded SignedMessage
    UNIQUE (origin_id, origin_seq)
);
CREATE INDEX IF NOT EXISTS idx_messages_room_order
    ON messages (room, lamport, created_at);
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);
";

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    /// Insert a message if unseen. Returns `true` when the message is new.
    /// Duplicate ids and duplicate `(origin, seq)` pairs are both no-ops, so
    /// flood and sync can race without double-inserting.
    pub fn insert(&self, msg: &SignedMessage) -> Result<bool> {
        let payload = postcard::to_stdvec(msg)?;
        let n = self.conn.execute(
            "INSERT OR IGNORE INTO messages
               (id, origin_id, origin_seq, lamport, created_at, room, payload)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                msg.id.as_slice(),
                msg.msg.origin_id.as_slice(),
                // SQLite integers are i64; sequence/clock values never
                // realistically exceed i64::MAX, so the casts are lossless.
                msg.msg.origin_seq as i64,
                msg.msg.lamport as i64,
                msg.msg.created_at_ms as i64,
                msg.msg.room,
                payload,
            ],
        )?;
        Ok(n > 0)
    }

    pub fn contains(&self, id: &MessageId) -> Result<bool> {
        let found: Option<i64> = self
            .conn
            .query_row(
                "SELECT 1 FROM messages WHERE id = ?1",
                params![id.as_slice()],
                |r| r.get(0),
            )
            .optional()?;
        Ok(found.is_some())
    }

    /// `{origin → max_seq}` over everything this node has stored.
    pub fn version_vector(&self) -> Result<HashMap<OriginId, u64>> {
        let mut stmt = self
            .conn
            .prepare("SELECT origin_id, MAX(origin_seq) FROM messages GROUP BY origin_id")?;
        let rows = stmt.query_map([], |r| {
            let origin: Vec<u8> = r.get(0)?;
            let seq: i64 = r.get(1)?;
            Ok((origin, seq as u64))
        })?;
        let mut vv = HashMap::new();
        for row in rows {
            let (origin, seq) = row?;
            if let Ok(origin) = <[u8; 32]>::try_from(origin.as_slice()) {
                vv.insert(origin, seq);
            }
        }
        Ok(vv)
    }

    /// Messages from `origin` with `origin_seq > after`, oldest first —
    /// the gap a syncing peer is missing.
    pub fn messages_after(
        &self,
        origin: &OriginId,
        after: u64,
        limit: usize,
    ) -> Result<Vec<SignedMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT payload FROM messages
             WHERE origin_id = ?1 AND origin_seq > ?2
             ORDER BY origin_seq ASC LIMIT ?3",
        )?;
        // Clamp before the i64 cast: usize::MAX would wrap to -1 (which
        // SQLite happens to treat as "no limit", but only by accident).
        let limit = limit.min(i64::MAX as usize) as i64;
        let rows = stmt.query_map(params![origin.as_slice(), after as i64, limit], |r| {
            r.get::<_, Vec<u8>>(0)
        })?;
        let mut out = Vec::new();
        for payload in rows {
            out.push(postcard::from_bytes(&payload?)?);
        }
        Ok(out)
    }

    /// Most recent messages in a room in UI order `(lamport, created_at, origin)`.
    pub fn recent(&self, room: &str, limit: usize) -> Result<Vec<SignedMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT payload FROM (
                 SELECT payload, lamport, created_at, origin_id FROM messages
                 WHERE room = ?1
                 ORDER BY lamport DESC, created_at DESC, origin_id DESC
                 LIMIT ?2
             ) ORDER BY lamport ASC, created_at ASC, origin_id ASC",
        )?;
        let rows = stmt.query_map(params![room, limit as i64], |r| r.get::<_, Vec<u8>>(0))?;
        let mut out = Vec::new();
        for payload in rows {
            out.push(postcard::from_bytes(&payload?)?);
        }
        Ok(out)
    }

    /// Highest sequence this origin has ever used (0 if none) — used to
    /// resume the own-message counter across restarts.
    pub fn max_seq(&self, origin: &OriginId) -> Result<u64> {
        let max: Option<i64> = self.conn.query_row(
            "SELECT MAX(origin_seq) FROM messages WHERE origin_id = ?1",
            params![origin.as_slice()],
            |r| r.get(0),
        )?;
        Ok(max.unwrap_or(0) as u64)
    }

    /// Persisted Lamport clock (survives restarts so local time never moves
    /// backwards relative to messages we already emitted).
    pub fn lamport(&self) -> Result<u64> {
        let v: Option<i64> = self
            .conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'lamport'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        Ok(v.unwrap_or(0) as u64)
    }

    pub fn set_lamport(&self, value: u64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO meta (key, value) VALUES ('lamport', ?1)
             ON CONFLICT(key) DO UPDATE SET value = ?1",
            params![value as i64],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::DeviceIdentity;
    use crate::proto::message::{Author, Body, MeshMessage};

    fn identity() -> DeviceIdentity {
        let dir = tempfile::tempdir().unwrap();
        DeviceIdentity::load_or_create(dir.path()).unwrap()
    }

    fn signed(id: &DeviceIdentity, seq: u64, room: &str, text: &str) -> SignedMessage {
        SignedMessage::create(
            MeshMessage {
                origin_id: id.public_bytes(),
                origin_seq: seq,
                lamport: seq * 10,
                created_at_ms: 1_700_000_000_000 + seq,
                room: room.into(),
                author: Author {
                    name: "n".into(),
                    color: "#fff".into(),
                },
                body: Body::Text { text: text.into() },
            },
            id,
        )
        .unwrap()
    }

    #[test]
    fn insert_is_idempotent() {
        let store = Store::open_in_memory().unwrap();
        let id = identity();
        let m = signed(&id, 1, "mesh-X", "a");
        assert!(store.insert(&m).unwrap());
        assert!(!store.insert(&m).unwrap());
        assert!(store.contains(&m.id).unwrap());
    }

    #[test]
    fn version_vector_tracks_max_per_origin() {
        let store = Store::open_in_memory().unwrap();
        let a = identity();
        let b = identity();
        for seq in 1..=3 {
            store.insert(&signed(&a, seq, "mesh-X", "a")).unwrap();
        }
        store.insert(&signed(&b, 7, "mesh-X", "b")).unwrap();

        let vv = store.version_vector().unwrap();
        assert_eq!(vv[&a.public_bytes()], 3);
        assert_eq!(vv[&b.public_bytes()], 7);
    }

    #[test]
    fn messages_after_returns_gap_in_order() {
        let store = Store::open_in_memory().unwrap();
        let a = identity();
        for seq in 1..=5 {
            store
                .insert(&signed(&a, seq, "mesh-X", &format!("m{seq}")))
                .unwrap();
        }
        let gap = store.messages_after(&a.public_bytes(), 2, 10).unwrap();
        let seqs: Vec<u64> = gap.iter().map(|m| m.msg.origin_seq).collect();
        assert_eq!(seqs, vec![3, 4, 5]);

        let limited = store.messages_after(&a.public_bytes(), 0, 2).unwrap();
        assert_eq!(limited.len(), 2);
    }

    #[test]
    fn recent_orders_by_lamport_and_respects_room() {
        let store = Store::open_in_memory().unwrap();
        let a = identity();
        store.insert(&signed(&a, 2, "mesh-X", "second")).unwrap();
        store.insert(&signed(&a, 1, "mesh-X", "first")).unwrap();
        store.insert(&signed(&a, 3, "mesh-OTHER", "elsewhere")).unwrap();

        let recent = store.recent("mesh-X", 50).unwrap();
        assert_eq!(recent.len(), 2);
        assert!(recent[0].msg.lamport < recent[1].msg.lamport);
    }

    #[test]
    fn lamport_persists() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.lamport().unwrap(), 0);
        store.set_lamport(42).unwrap();
        assert_eq!(store.lamport().unwrap(), 42);
    }

    #[test]
    fn max_seq_resumes_counter() {
        let store = Store::open_in_memory().unwrap();
        let a = identity();
        assert_eq!(store.max_seq(&a.public_bytes()).unwrap(), 0);
        store.insert(&signed(&a, 9, "mesh-X", "m")).unwrap();
        assert_eq!(store.max_seq(&a.public_bytes()).unwrap(), 9);
    }

    #[test]
    fn payload_roundtrips_through_store() {
        let store = Store::open_in_memory().unwrap();
        let a = identity();
        let m = signed(&a, 1, "mesh-X", "round trip ✓ unicode");
        store.insert(&m).unwrap();
        let back = store.recent("mesh-X", 1).unwrap();
        assert_eq!(back[0], m);
        assert!(back[0].verify());
    }
}
