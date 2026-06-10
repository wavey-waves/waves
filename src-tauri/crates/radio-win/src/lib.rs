//! Windows-only radio control (docs/MESH.md L1, implemented in P3):
//! - hosting a WiFi-Direct legacy-AP autonomous group owner
//!   (`WiFiDirectAdvertisementPublisher` + `LegacySettings`),
//! - joining one as a station via Win32 `WlanConnect`,
//! - probing adapter capabilities (`netsh wlan show wirelesscapabilities`).
//!
//! On non-Windows targets the crate compiles to this empty shell so the
//! workspace builds and tests everywhere; all real symbols are `cfg(windows)`.

/// Adapter capability report. Populated by the P3.a probe; until then every
/// field is `false`, which downstream code must treat as "radio unavailable",
/// never as an error.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RadioCapabilities {
    pub wifi_direct: bool,
    /// Can host a group owner while simultaneously joined to another network
    /// (the GO+STA chaining requirement for multi-hop, docs/MESH.md risk #2).
    pub go_sta_concurrency: bool,
}

/// TODO(P3.a — see docs/MESH.md checklist): real WinRT probe behind
/// `cfg(windows)`; this stub keeps Linux dev/test builds green.
pub fn probe_capabilities() -> RadioCapabilities {
    RadioCapabilities::default()
}
