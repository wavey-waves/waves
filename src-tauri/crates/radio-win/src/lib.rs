//! Windows radio control (docs/MESH.md L1, P3):
//! - hosting a WiFi-Direct legacy-AP autonomous group owner ([`host`]),
//! - joining one as a plain WPA2 station via Win32 WLAN ([`join`]),
//! - adapter capability probing ([`probe_capabilities`]),
//! - room-code → SSID/PSK derivation ([`creds`], decision D2).
//!
//! Implementation facts (exact signatures, profile XML, gotchas) live in
//! docs/mesh-notes/winrt-radio-api.md. On non-Windows targets only the pure
//! parts (creds, capability parsing) compile, so the workspace builds and
//! tests everywhere; the real radio symbols are `cfg(windows)`.

pub mod creds;
#[cfg(windows)]
pub mod host;
#[cfg(windows)]
pub mod join;

mod caps;
pub use caps::{parse_wireless_capabilities, probe_capabilities, RadioCapabilities};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum RadioError {
    #[error("WPA2 passphrase must be 8..=63 characters")]
    BadPassphrase,
    #[error("SSID must be 1..=32 bytes")]
    BadSsid,
    #[error("no WLAN interface present")]
    NoWlanInterface,
    #[error("connect timed out")]
    Timeout,
    #[error("windows API error: {0}")]
    Win(String),
    #[error("WLAN error code {0}")]
    Win32(u32),
}

#[cfg(windows)]
impl From<windows::core::Error> for RadioError {
    fn from(e: windows::core::Error) -> Self {
        Self::Win(e.to_string())
    }
}

/// Events surfaced by the legacy-AP host. Callbacks arrive on WinRT
/// threadpool threads; the host forwards them through an mpsc channel.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RadioEvent {
    ApStarted,
    ApStopped,
    /// The OS tore the group owner down (radio off, Mobile Hotspot toggled,
    /// driver refusal). Carries the WiFiDirectError debug string.
    ApAborted(String),
    /// A client associated (WiFi-Direct or legacy STA). Carries the device id.
    ClientConnected(String),
}
