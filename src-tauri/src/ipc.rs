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

// rename_all covers variant names only; rename_all_fields is what makes
// struct-variant fields (origin_id, ...) camelCase on the wire.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "type")]
pub enum MeshEventDto {
    Message { message: MessageDto },
    PeerUp { peer: PeerDto },
    PeerDown { origin_id: String },
    BlobReady { hash: String },
    BlobFailed { hash: String, reason: String },
}

impl From<&MeshEvent> for MeshEventDto {
    fn from(ev: &MeshEvent) -> Self {
        match ev {
            MeshEvent::Message(m) => Self::Message { message: m.into() },
            MeshEvent::PeerUp(p) => Self::PeerUp { peer: p.into() },
            MeshEvent::PeerDown(origin) => Self::PeerDown {
                origin_id: hex(origin),
            },
            MeshEvent::BlobReady { hash } => Self::BlobReady { hash: hex(hash) },
            MeshEvent::BlobFailed { hash, reason } => Self::BlobFailed {
                hash: hex(hash),
                reason: reason.clone(),
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

/// Send an image: raw invoke body = the image bytes; `room` and `mime`
/// arrive as request headers (Tauri 2's binary-payload pattern — bytes skip
/// JSON entirely). The thumbnail is generated here so every announcement
/// carries one regardless of client.
#[tauri::command]
pub async fn mesh_send_image(
    state: State<'_, Mesh>,
    request: tauri::ipc::Request<'_>,
) -> Result<MessageDto, String> {
    let header = |name: &str| -> Result<String, String> {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
            .ok_or_else(|| format!("missing {name} header"))
    };
    let room = header("room")?;
    let mime = header("mime")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw image bytes as the invoke body".into());
    };
    let bytes = bytes.clone();

    let thumb = {
        let bytes = bytes.clone();
        tauri::async_runtime::spawn_blocking(move || make_thumbnail(&bytes))
            .await
            .map_err(|e| e.to_string())??
    };

    let msg = node(&state)?
        .send_image(&room, bytes, mime, thumb)
        .await
        .map_err(|e| e.to_string())?;
    Ok(MessageDto::from(&msg))
}

/// Downscale + JPEG-encode a thumbnail that fits in the flood (≤ ~10 KiB).
fn make_thumbnail(bytes: &[u8]) -> Result<Vec<u8>, String> {
    const MAX_THUMB_BYTES: usize = 10 * 1024;
    let img = image::load_from_memory(bytes).map_err(|e| format!("not a decodable image: {e}"))?;
    for (dim, quality) in [(256u32, 70u8), (256, 50), (192, 40), (128, 30)] {
        let small = img.thumbnail(dim, dim);
        let mut out = Vec::new();
        let mut enc =
            image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::Cursor::new(&mut out), quality);
        if enc.encode_image(&small.to_rgb8()).is_err() {
            continue;
        }
        if out.len() <= MAX_THUMB_BYTES {
            return Ok(out);
        }
    }
    Err("could not produce a small enough thumbnail".into())
}

/// Export a completed blob into the asset-protocol scope and return the
/// absolute path; the UI renders it via convertFileSrc(). Idempotent.
#[tauri::command]
pub async fn mesh_export_blob(
    app: AppHandle,
    state: State<'_, Mesh>,
    hash: String,
    mime: Option<String>,
) -> Result<String, String> {
    let hash_bytes = parse_hash(&hash)?;
    let node = node(&state)?;
    if !node.has_blob(&hash_bytes).await {
        return Err("blob-not-ready".into());
    }

    let ext = match mime.as_deref() {
        Some("image/jpeg") => "jpg",
        Some("image/png") => "png",
        Some("image/webp") => "webp",
        Some("image/gif") => "gif",
        _ => "bin",
    };
    // Must stay inside the assetProtocol scope ($APPDATA/blobs/**).
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("blobs")
        .join("export");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(format!("{hash}.{ext}"));
    if !target.exists() {
        node.export_blob(&hash_bytes, &target)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(target.to_string_lossy().into_owned())
}

fn parse_hash(s: &str) -> Result<[u8; 32], String> {
    if s.len() != 64 {
        return Err("bad hash".into());
    }
    let mut out = [0u8; 32];
    for (i, chunk) in s.as_bytes().chunks(2).enumerate() {
        let pair = std::str::from_utf8(chunk).map_err(|_| "bad hash")?;
        out[i] = u8::from_str_radix(pair, 16).map_err(|_| "bad hash")?;
    }
    Ok(out)
}

/// Radio state (P3): at most one hosted GO and one joined SSID at a time.
/// Per the Win11 publisher-restart bug, a host is never reused — stop drops
/// it and a new "Host mesh" creates a fresh one.
#[derive(Default)]
pub struct Radio {
    #[cfg(windows)]
    host: std::sync::Mutex<Option<radio_win::host::LegacyApHost>>,
    #[cfg(windows)]
    joined: std::sync::Mutex<Option<String>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RadioCapsDto {
    pub supported: bool,
    pub wifi_direct_go: bool,
    pub wifi_direct_client: bool,
    pub go_sta_concurrency: bool,
}

#[tauri::command]
pub async fn radio_caps() -> Result<RadioCapsDto, String> {
    let caps = radio_win::probe_capabilities();
    Ok(RadioCapsDto {
        supported: cfg!(windows),
        wifi_direct_go: caps.wifi_direct_go,
        wifi_direct_client: caps.wifi_direct_client,
        go_sta_concurrency: caps.go_sta_concurrency,
    })
}

/// Host a forest-mode mesh for `code`: derives SSID/PSK (D2), starts the
/// legacy-AP GO, and resolves once the OS reports Started. Returns the SSID
/// joiners will see.
#[tauri::command]
pub async fn radio_host(state: State<'_, Radio>, code: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        let (ssid, passphrase) = radio_win::creds::derive_credentials(&code);
        let ssid_for_host = ssid.clone();
        let host = tauri::async_runtime::spawn_blocking(move || {
            let (tx, rx) = std::sync::mpsc::channel();
            let host = radio_win::host::LegacyApHost::start(&ssid_for_host, &passphrase, tx)
                .map_err(|e| e.to_string())?;
            match rx.recv_timeout(std::time::Duration::from_secs(15)) {
                Ok(radio_win::RadioEvent::ApStarted) => Ok(host),
                Ok(radio_win::RadioEvent::ApAborted(detail)) => {
                    Err(format!("radio refused to start: {detail} (is Mobile Hotspot on?)"))
                }
                Ok(_) => Err("unexpected radio event during startup".into()),
                Err(_) => Err("timed out waiting for the access point to start".into()),
            }
        })
        .await
        .map_err(|e| e.to_string())??;
        *state.host.lock().expect("radio host lock") = Some(host);
        Ok(ssid)
    }
    #[cfg(not(windows))]
    {
        let _ = (state, code);
        Err("radio-requires-windows".into())
    }
}

#[tauri::command]
pub async fn radio_stop_host(state: State<'_, Radio>) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Dropping the host stops the publisher and releases the clients.
        state.host.lock().expect("radio host lock").take();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = state;
        Err("radio-requires-windows".into())
    }
}

/// Join the forest mesh hosted under `code` (blocking scan + connect, so it
/// runs on a blocking thread; ~25 s worst case).
#[tauri::command]
pub async fn radio_join(state: State<'_, Radio>, code: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (ssid, passphrase) = radio_win::creds::derive_credentials(&code);
        let ssid_for_join = ssid.clone();
        tauri::async_runtime::spawn_blocking(move || {
            radio_win::join::join(
                &ssid_for_join,
                &passphrase,
                std::time::Duration::from_secs(25),
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
        *state.joined.lock().expect("radio join lock") = Some(ssid);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (state, code);
        Err("radio-requires-windows".into())
    }
}

#[tauri::command]
pub async fn radio_leave(state: State<'_, Radio>) -> Result<(), String> {
    #[cfg(windows)]
    {
        let ssid = state.joined.lock().expect("radio join lock").take();
        if let Some(ssid) = ssid {
            tauri::async_runtime::spawn_blocking(move || {
                radio_win::join::leave(&ssid).map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())??;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = state;
        Err("radio-requires-windows".into())
    }
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
