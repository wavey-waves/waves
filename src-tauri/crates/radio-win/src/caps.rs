//! Adapter capability probing. There is no public API that reports
//! WiFi-Direct GO/Client support or STA+GO concurrency
//! (WLAN_INTERFACE_CAPABILITY carries none of it), so the practical route is
//! parsing `netsh wlan show wirelesscapabilities` — with the caveat that the
//! concurrency line label varies; absence of a match means "unknown", and the
//! authoritative runtime signal is simply starting the publisher and reading
//! its Aborted error.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RadioCapabilities {
    pub wifi_direct_go: bool,
    pub wifi_direct_client: bool,
    /// Can host a GO while simultaneously joined as a station — the multi-hop
    /// chaining requirement (docs/MESH.md risk #2). False also means
    /// "couldn't determine"; treat as star-topology-only, never as an error.
    pub go_sta_concurrency: bool,
}

/// Pure parser, testable everywhere. Lines look like
/// `Wi-Fi Direct GO                 : Supported`.
pub fn parse_wireless_capabilities(text: &str) -> RadioCapabilities {
    let lower = text.to_lowercase();
    let line_supported = |label: &str| {
        lower
            .lines()
            .any(|l| l.contains(label) && l.contains(": supported"))
    };
    RadioCapabilities {
        wifi_direct_go: line_supported("wi-fi direct go"),
        wifi_direct_client: line_supported("wi-fi direct client"),
        go_sta_concurrency: lower.lines().any(|l| {
            l.contains("simultaneous")
                && l.contains("station")
                && (l.contains("go") || l.contains("client"))
                && l.contains(": supported")
        }),
    }
}

#[cfg(windows)]
pub fn probe_capabilities() -> RadioCapabilities {
    match std::process::Command::new("netsh")
        .args(["wlan", "show", "wirelesscapabilities"])
        .output()
    {
        Ok(out) => parse_wireless_capabilities(&String::from_utf8_lossy(&out.stdout)),
        Err(e) => {
            tracing::warn!("netsh capability probe failed: {e}");
            RadioCapabilities::default()
        }
    }
}

#[cfg(not(windows))]
pub fn probe_capabilities() -> RadioCapabilities {
    RadioCapabilities::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
Wireless System Capabilities
----------------------------
    Number of supported bands  : 2

Wireless Device Capabilities
----------------------------
    Interface name: Wi-Fi
    WDI Version (Windows)              : 0.1.1.10
    Station                            : Supported
    Soft AP                            : Not Supported
    Network monitor mode               : Not Supported
    Wi-Fi Direct Device                : Supported
    Wi-Fi Direct GO                    : Supported
    Wi-Fi Direct Client                : Supported
    Simultaneous station and GO        : Supported
    Simultaneous station and Client    : Not Supported
";

    #[test]
    fn parses_supported_and_not_supported_lines() {
        let caps = parse_wireless_capabilities(SAMPLE);
        assert!(caps.wifi_direct_go);
        assert!(caps.wifi_direct_client);
        assert!(caps.go_sta_concurrency, "station+GO line is Supported");
    }

    #[test]
    fn not_supported_never_matches() {
        let caps = parse_wireless_capabilities(
            "Wi-Fi Direct GO : Not Supported\nSimultaneous station and GO : Not Supported\n",
        );
        assert!(!caps.wifi_direct_go);
        assert!(!caps.go_sta_concurrency);
    }

    #[test]
    fn empty_or_garbage_yields_defaults() {
        assert_eq!(parse_wireless_capabilities(""), RadioCapabilities::default());
        assert_eq!(
            parse_wireless_capabilities("no such tool output"),
            RadioCapabilities::default()
        );
    }
}
