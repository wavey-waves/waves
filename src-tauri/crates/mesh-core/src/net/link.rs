//! Per-link IO: one long-lived bidirectional QUIC stream carrying
//! length-prefixed `wire::Frame`s (u32-le || postcard), one reader task and
//! one writer task per link.

use std::sync::Arc;

use iroh::endpoint::{Connection, RecvStream, SendStream};
use iroh::{EndpointAddr, EndpointId};
use tokio::sync::mpsc;

use crate::proto::engine::LinkId;
use crate::proto::wire::{Frame, MAX_FRAME_BYTES};

use super::Shared;

pub(super) struct LinkHandle {
    pub peer: EndpointId,
    /// The address we dialed (None on accepted links) — reused for blob
    /// pulls so they work even without an address-lookup service.
    pub addr: Option<EndpointAddr>,
    pub sender: mpsc::Sender<Frame>,
}

/// Which side of the connection we are. The dialer opens the link's single
/// bidirectional stream; the acceptor awaits it. Explicit roles (known at
/// adoption time) make stream setup deterministic — racing open/accept from
/// both sides can strand each side on a stream the other never reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Role {
    Dialer,
    Acceptor,
}

/// Start the reader + writer tasks for an adopted connection.
pub(super) fn run(
    shared: Arc<Shared>,
    conn: Connection,
    link_id: LinkId,
    peer: EndpointId,
    role: Role,
    outbound: mpsc::Receiver<Frame>,
) {
    tokio::spawn(async move {
        let streams = match role {
            Role::Dialer => conn.open_bi().await.map_err(|e| e.to_string()),
            Role::Acceptor => conn.accept_bi().await.map_err(|e| e.to_string()),
        };
        let (send, recv) = match streams {
            Ok(pair) => pair,
            Err(e) => {
                tracing::debug!(link_id, ?role, "stream setup failed: {e}");
                shared.drop_link(link_id).await;
                return;
            }
        };

        let writer = tokio::spawn(write_loop(send, outbound));
        read_loop(shared.clone(), recv, link_id, peer).await;

        // Reader ended (peer gone or protocol error): tear everything down.
        writer.abort();
        conn.close(0u32.into(), b"link closed");
        shared.drop_link(link_id).await;
    });
}

async fn write_loop(mut send: SendStream, mut outbound: mpsc::Receiver<Frame>) {
    while let Some(frame) = outbound.recv().await {
        let bytes = match frame.encode() {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!("unencodable frame skipped: {e}");
                continue;
            }
        };
        if send.write_all(&bytes).await.is_err() {
            return; // connection gone; reader will notice too
        }
    }
}

async fn read_loop(shared: Arc<Shared>, mut recv: RecvStream, link_id: LinkId, peer: EndpointId) {
    let peer_origin = *peer.as_bytes();
    loop {
        let mut len_buf = [0u8; 4];
        if recv.read_exact(&mut len_buf).await.is_err() {
            return;
        }
        let len = u32::from_le_bytes(len_buf) as usize;
        if len > MAX_FRAME_BYTES {
            tracing::warn!(link_id, len, "oversized frame; closing link");
            return;
        }
        let mut buf = vec![0u8; len];
        if recv.read_exact(&mut buf).await.is_err() {
            return;
        }
        let frame = match Frame::decode(&buf) {
            Ok(f) => f,
            Err(e) => {
                tracing::warn!(link_id, "undecodable frame; closing link: {e}");
                return;
            }
        };

        let actions = {
            let mut engine = shared.engine.lock().await;
            match engine.handle_frame(link_id, frame, peer_origin) {
                Ok(a) => a,
                Err(e) => {
                    tracing::warn!(link_id, "engine rejected frame: {e}");
                    continue;
                }
            }
        };
        shared.apply(actions).await;
    }
}
