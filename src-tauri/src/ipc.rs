//! Tauri IPC surface: commands the webview invokes plus the Channel-based
//! event stream (docs/MESH.md L5). Events use `tauri::ipc::Channel`, never
//! the event system — the chat stream needs throughput the event bus isn't
//! built for.

use std::sync::Arc;

use mesh_core::net::{MeshNode, NodeConfig};
use mesh_core::proto::engine::{MeshEvent, PeerInfo};
use mesh_core::proto::message::{Author, Body, SignedMessage};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

/// Managed state. The node spawns asynchronously at app start; commands that
/// arrive before it's ready get a retryable error string.
#[derive(Default)]
pub struct Mesh {
    node: Arc<tokio::sync::OnceCell<MeshNode>>,
}

fn hex(bytes: &[u8]) -> String {
    mesh_core::identity::encode_hex(bytes)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MessageDto {
    /// BLAKE3 message id (hex) — the `_id` the UI dedups on.
    pub id: String,
    /// Origin device key (hex) — maps to `senderId._id` in the UI.
    pub origin_id: String,
    pub origin_seq: u64,
    pub lamport: u64,
    pub created_at_ms: u64,
    pub room: String,
    pub author_name: String,
    pub author_color: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob_mime: Option<String>,
    /// Inline thumbnail as base64 (rides the flood, ≤ ~10 KiB).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb_b64: Option<String>,
}

impl From<&SignedMessage> for MessageDto {
    fn from(m: &SignedMessage) -> Self {
        let msg = &m.msg;
        let mut dto = Self {
            id: hex(&m.id),
            origin_id: hex(&msg.origin_id),
            origin_seq: msg.origin_seq,
            lamport: msg.lamport,
            created_at_ms: msg.created_at_ms,
            room: msg.room.clone(),
            author_name: msg.author.name.clone(),
            author_color: msg.author.color.clone(),
            kind: "text".into(),
            text: None,
            blob_hash: None,
            blob_size: None,
            blob_mime: None,
            thumb_b64: None,
        };
        match &msg.body {
            Body::Text { text } => dto.text = Some(text.clone()),
            Body::Image { blob } => {
                use base64::Engine as _;
                dto.kind = "image".into();
                dto.blob_hash = Some(hex(&blob.hash));
                dto.blob_size = Some(blob.size);
                dto.blob_mime = Some(blob.mime.clone());
                dto.thumb_b64 =
                    Some(base64::engine::general_purpose::STANDARD.encode(&blob.thumb));
            }
        }
        dto
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerDto {
    pub origin_id: String,
    pub name: String,
    pub color: String,
}

impl From<&PeerInfo> for PeerDto {
    fn from(p: &PeerInfo) -> Self {
        Self {
            origin_id: hex(&p.origin_id),
            name: p.name.clone(),
            color: p.color.clone(),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum MeshEventDto {
    Message { message: MessageDto },
    PeerUp { peer: PeerDto },
    PeerDown { origin_id: String },
}

impl From<&MeshEvent> for MeshEventDto {
    fn from(ev: &MeshEvent) -> Self {
        match ev {
            MeshEvent::Message(m) => Self::Message { message: m.into() },
            MeshEvent::PeerUp(p) => Self::PeerUp { peer: p.into() },
            MeshEvent::PeerDown(origin) => Self::PeerDown {
                origin_id: hex(origin),
            },
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InfoDto {
    pub ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint_id: Option<String>,
}

/// Spawn the mesh node into managed state. Called once from `setup`.
pub fn start(app: AppHandle) {
    let state: State<'_, Mesh> = app.state();
    let cell = state.node.clone();
    tauri::async_runtime::spawn(async move {
        let data_dir = match app.path().app_data_dir() {
            Ok(dir) => dir,
            Err(e) => {
                tracing::error!("no app data dir: {e}");
                return;
            }
        };
        let config = NodeConfig {
            data_dir,
            author: Author {
                // Placeholder until the UI joins with a real identity.
                name: "anonymous".into(),
                color: "#7c3aed".into(),
            },
            beacon: true,
        };
        match MeshNode::spawn(config).await {
            Ok(node) => {
                if cell.set(node).is_err() {
                    tracing::error!("mesh node initialized twice");
                }
            }
            Err(e) => tracing::error!("mesh node failed to start: {e}"),
        }
    });
}

const NOT_READY: &str = "mesh-starting";

fn node<'a>(state: &'a State<'_, Mesh>) -> Result<&'a MeshNode, String> {
    state.node.get().ok_or_else(|| NOT_READY.to_string())
}

#[tauri::command]
pub async fn mesh_info(state: State<'_, Mesh>) -> Result<InfoDto, String> {
    Ok(match state.node.get() {
        Some(n) => InfoDto {
            ready: true,
            endpoint_id: Some(hex(n.endpoint_id().as_bytes())),
        },
        None => InfoDto {
            ready: false,
            endpoint_id: None,
        },
    })
}

#[tauri::command]
pub async fn mesh_set_author(
    state: State<'_, Mesh>,
    name: String,
    color: String,
) -> Result<(), String> {
    node(&state)?.set_author(Author { name, color }).await;
    Ok(())
}

#[tauri::command]
pub async fn mesh_send_text(
    state: State<'_, Mesh>,
    room: String,
    text: String,
) -> Result<MessageDto, String> {
    let msg = node(&state)?
        .send_text(&room, text)
        .await
        .map_err(|e| e.to_string())?;
    Ok(MessageDto::from(&msg))
}

#[tauri::command]
pub async fn mesh_history(
    state: State<'_, Mesh>,
    room: String,
    limit: Option<usize>,
) -> Result<Vec<MessageDto>, String> {
    let history = node(&state)?
        .history(&room, limit.unwrap_or(200))
        .await
        .map_err(|e| e.to_string())?;
    Ok(history.iter().map(MessageDto::from).collect())
}

#[tauri::command]
pub async fn mesh_peers(state: State<'_, Mesh>) -> Result<Vec<PeerDto>, String> {
    Ok(node(&state)?
        .peers()
        .await
        .iter()
        .map(PeerDto::from)
        .collect())
}

/// Stream mesh events into the webview. The channel dies when the page
/// reloads; the forwarder task notices the send failure and exits, and the
/// reloaded page simply subscribes again.
#[tauri::command]
pub async fn mesh_subscribe(
    state: State<'_, Mesh>,
    channel: Channel<MeshEventDto>,
) -> Result<(), String> {
    let mut events = node(&state)?.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match events.recv().await {
                Ok(ev) => {
                    if channel.send(MeshEventDto::from(&ev)).is_err() {
                        return; // webview gone
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("event subscriber lagged by {n} events");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
            }
        }
    });
    Ok(())
}
