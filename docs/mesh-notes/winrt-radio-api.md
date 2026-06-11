# WinRT/Win32 API reference for radio-win (windows crate 0.62.x)

Condensed from the verified API-extraction research (2026-06-11). Canonical Rust
docs: https://microsoft.github.io/windows-docs-rs/ (docs.rs hosts only a stub).
Implementation lives in `src-tauri/crates/radio-win`; this file exists so future
sessions don't re-research.

## Cargo features (each auto-enables parents)

`Devices_WiFiDirect`, `Security_Credentials`, `Foundation`, `Devices_Enumeration`,
`Foundation_Collections`, `Networking`, `Win32_NetworkManagement_WiFi`, `Win32_Foundation`.

## HOST — WiFi-Direct legacy AP (autonomous GO), plain Win32 process OK

Works from a desktop process with no UWP manifest (that's the point of MS's
WiFiDirectLegacyAP classic sample). windows-rs auto-initializes the MTA on
WinRT activation (CoIncrementMTAUsage fallback) — no manual RoInitialize.

- `WiFiDirectAdvertisementPublisher::new()?`
  - `.StatusChanged(&TypedEventHandler::new(closure))? -> i64` — register BEFORE `Start()`.
    Closure: `Fn(Ref<'_, Sender>, Ref<'_, Args>) -> windows::core::Result<()> + Send + 'static`;
    use `args.ok()?`; runs on a WinRT threadpool thread — only signal channels from it.
  - `.Advertisement()?` → `WiFiDirectAdvertisement`:
    - `.SetIsAutonomousGroupOwnerEnabled(true)?`
    - `.SetListenStateDiscoverability(WiFiDirectAdvertisementListenStateDiscoverability::Normal)?`
    - `.LegacySettings()?` → `.SetIsEnabled(true)?`, `.SetSsid(&HSTRING)?`,
      `.SetPassphrase(&PasswordCredential)?` (cred: `PasswordCredential::new()?` +
      `.SetPassword(&HSTRING)?`; WPA2 rule: 8..=63 chars)
  - `.Start()?` (async — success means StatusChanged fires Started), `.Stop()?`
- Status consts (transparent i32 struct): Created=0, Started=1, Stopped=2, Aborted=3.
  `WiFiDirectError`: Success=0, RadioNotAvailable=1, ResourceInUse=2.
- `WiFiDirectConnectionListener::new()?` + `.ConnectionRequested(handler)? -> i64`;
  in handler: `args.ok()?.GetConnectionRequest()?.DeviceInformation()?.Id()?` then
  `WiFiDirectDevice::FromIdAsync(&id)?.get()?` — HOLD the device objects (dropping
  one drops that client); both reference impls do this for legacy clients too.
- GO lives exactly as long as the publisher COM reference. Keep it in a struct.

## JOIN — Win32 WLAN (all fns `unsafe`, return u32, 0 = success)

Sequence: `WlanOpenHandle(2, …)` → `WlanEnumInterfaces` (copy GUID out, then
`WlanFreeMemory`) → `WlanScan` + retry `WlanGetAvailableNetworkList` (≤ ~5 s; on
Win11 24H2 may be empty if Location is off — attempt connect anyway) →
`WlanSetProfile(flags=0, xml, overwrite=true)` → `WlanRegisterNotification(
WLAN_NOTIFICATION_SOURCE_ACM /*=8*/, …)` watching NotificationCode ==
`wlan_notification_acm_connection_complete` (=10; pData → WLAN_CONNECTION_NOTIFICATION_DATA,
wlanReasonCode==0 means success) → `WlanConnect(WLAN_CONNECTION_PARAMETERS {
wlanConnectionMode: wlan_connection_mode_profile /*=0*/, strProfile: PCWSTR(ssid),
pDot11Ssid: null, pDesiredBssidList: null, dot11BssType: dot11_BSS_type_infrastructure /*=1*/,
dwFlags: 0 })` → wait on channel with timeout.

Cleanup: `WlanDisconnect` → `WlanDeleteProfile` (profile name == SSID) →
`WlanCloseHandle` (auto-unregisters notifications). NEVER call
WlanRegisterNotification from inside the callback (documented deadlock).
Callback type: `Option<unsafe extern "system" fn(*mut L2_NOTIFICATION_DATA, *mut c_void)>`
(the SDK's WLAN_NOTIFICATION_DATA is projected as `L2_NOTIFICATION_DATA`).

### Known-good WPA2-PSK profile XML (namespaces use http://, not https://)

```xml
<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
    <name>{SSID}</name>
    <SSIDConfig><SSID><name>{SSID}</name></SSID><nonBroadcast>false</nonBroadcast></SSIDConfig>
    <connectionType>ESS</connectionType>
    <connectionMode>manual</connectionMode>
    <MSM><security>
        <authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
        <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>{PASSPHRASE}</keyMaterial></sharedKey>
    </security></MSM>
    <MacRandomization xmlns="http://www.microsoft.com/networking/WLAN/profile/v3">
        <enableRandomization>false</enableRandomization>
    </MacRandomization>
</WLANProfile>
```

`connectionMode manual` stops Windows auto-chasing dead GOs; XML-escape SSID/passphrase.

## Capability probe

No public API reports WFD GO/Client or STA+GO concurrency
(WLAN_INTERFACE_CAPABILITY is useless for this). Practical: parse
`netsh wlan show wirelesscapabilities` — labels like `Wi-Fi Direct Device/GO/Client : Supported`;
concurrency line label unverified, match `simultaneous…station…(go|client)…supported`
case-insensitively, tolerate absence. Most robust runtime probe: just `Start()` the
publisher and interpret Aborted+Error (RadioNotAvailable vs ResourceInUse).

## Gotchas (load-bearing)

1. **Mobile Hotspot takes precedence over all WFD scenarios** (documented) —
   expect Aborted/ResourceInUse or silent teardown when toggled.
2. **Win11 publisher restart bug** (microsoft/Windows-universal-samples#1400):
   publisher may stay `Started` while ineffective and can't re-Start; recover by
   `Stop()` + creating a BRAND-NEW publisher. Treat a periodic liveness watchdog
   as defensive engineering.
3. **ICS subnet**: GO's virtual adapter gets 192.168.137.1; legacy clients lease
   192.168.137.x from ICS DHCP (widely observed, not officially documented; no
   API to query the GO's IP). Don't hardcode — discovery (beacon/mDNS) finds the
   host; 192.168.137.1 is only a fast-path guess; tolerate 169.254.x.x.
4. Legacy-AP mode does NOT provide internet cross-connectivity (documented) — fine, mesh is LAN-only.
5. Profile cleanup after leave, and consider that scan APIs are location-gated on Win11 24H2+.
