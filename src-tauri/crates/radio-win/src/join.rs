//! Join a legacy-AP (any WPA2-PSK network) as a station via Win32 WLAN.
//!
//! Everything here BLOCKS (scan retries, connect wait) — call from a
//! blocking-OK thread (`spawn_blocking` in the app). Call sequence and
//! gotchas per docs/mesh-notes/winrt-radio-api.md: profile XML with MAC
//! randomization off, connect-complete via ACM notification, never
//! re-register from inside the callback, clean the profile up on leave.

use std::ffi::c_void;
use std::ptr::null_mut;
use std::sync::mpsc;
use std::time::Duration;

use windows::core::{GUID, PCWSTR};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::NetworkManagement::WiFi::{
    dot11_BSS_type_infrastructure, wlan_connection_mode_profile,
    wlan_notification_acm_connection_complete, L2_NOTIFICATION_DATA, WlanCloseHandle,
    WlanConnect, WlanDeleteProfile, WlanDisconnect, WlanEnumInterfaces, WlanFreeMemory,
    WlanGetAvailableNetworkList, WlanOpenHandle, WlanRegisterNotification, WlanScan,
    WlanSetProfile, WLAN_AVAILABLE_NETWORK_LIST, WLAN_CONNECTION_PARAMETERS,
    WLAN_INTERFACE_INFO_LIST, WLAN_NOTIFICATION_SOURCE_ACM, WLAN_NOTIFICATION_SOURCE_NONE,
};

use crate::RadioError;

const SCAN_TRIES: u32 = 8;
const SCAN_PAUSE: Duration = Duration::from_millis(500);

/// Connect to `ssid` with `passphrase`. Returns once the interface reports
/// connection-complete (or errors/times out, in which case the temporary
/// profile is removed).
pub fn join(ssid: &str, passphrase: &str, timeout: Duration) -> Result<(), RadioError> {
    let handle = WlanHandle::open()?;
    let guid = first_interface(handle.0)?;

    // Best-effort visibility check. On Win11 24H2+ the scan list can be
    // empty with Location off, so absence is NOT fatal — we attempt the
    // connect regardless and let the timeout decide.
    unsafe {
        let _ = WlanScan(handle.0, &guid, None, None, None);
    }
    for _ in 0..SCAN_TRIES {
        if ssid_visible(handle.0, &guid, ssid) {
            break;
        }
        std::thread::sleep(SCAN_PAUSE);
    }

    let xml = wide(&profile_xml(ssid, passphrase));
    let mut reason = 0u32;
    win32(unsafe {
        WlanSetProfile(
            handle.0,
            &guid,
            0,
            PCWSTR(xml.as_ptr()),
            PCWSTR::null(),
            true,
            None,
            &mut reason,
        )
    })?;

    let (tx, rx) = mpsc::channel::<()>();
    let context = Box::into_raw(Box::new(tx));
    let registered = unsafe {
        WlanRegisterNotification(
            handle.0,
            WLAN_NOTIFICATION_SOURCE_ACM,
            true,
            Some(on_acm_notification),
            Some(context as *const c_void),
            None,
            None,
        )
    };

    let name = wide(ssid);
    let connect_result = (|| {
        win32(registered)?;
        let parameters = WLAN_CONNECTION_PARAMETERS {
            wlanConnectionMode: wlan_connection_mode_profile,
            strProfile: PCWSTR(name.as_ptr()),
            pDot11Ssid: null_mut(),
            pDesiredBssidList: null_mut(),
            dot11BssType: dot11_BSS_type_infrastructure,
            dwFlags: 0,
        };
        win32(unsafe { WlanConnect(handle.0, &guid, &parameters, None) })?;
        rx.recv_timeout(timeout).map_err(|_| RadioError::Timeout)
    })();

    // Unregister BEFORE freeing the context the callback dereferences; doing
    // this from outside the callback avoids the documented deadlock.
    unsafe {
        WlanRegisterNotification(
            handle.0,
            WLAN_NOTIFICATION_SOURCE_NONE,
            true,
            None,
            None,
            None,
            None,
        );
        drop(Box::from_raw(context));
    }

    if connect_result.is_err() {
        unsafe {
            let _ = WlanDisconnect(handle.0, &guid, None);
            let _ = WlanDeleteProfile(handle.0, &guid, PCWSTR(name.as_ptr()), None);
        }
    }
    connect_result
}

/// Disconnect and remove the temporary profile (the GO's credentials may be
/// regenerated next session; a stale profile would make Windows chase a dead
/// SSID).
pub fn leave(ssid: &str) -> Result<(), RadioError> {
    let handle = WlanHandle::open()?;
    let guid = first_interface(handle.0)?;
    let name = wide(ssid);
    unsafe {
        let _ = WlanDisconnect(handle.0, &guid, None);
        let _ = WlanDeleteProfile(handle.0, &guid, PCWSTR(name.as_ptr()), None);
    }
    Ok(())
}

struct WlanHandle(HANDLE);

impl WlanHandle {
    fn open() -> Result<Self, RadioError> {
        let mut negotiated = 0u32;
        let mut handle = HANDLE::default();
        win32(unsafe { WlanOpenHandle(2, None, &mut negotiated, &mut handle) })?;
        Ok(Self(handle))
    }
}

impl Drop for WlanHandle {
    // Closing auto-unregisters notifications; it does NOT drop an
    // established connection.
    fn drop(&mut self) {
        unsafe {
            WlanCloseHandle(self.0, None);
        }
    }
}

fn win32(rc: u32) -> Result<(), RadioError> {
    if rc == 0 {
        Ok(())
    } else {
        Err(RadioError::Win32(rc))
    }
}

fn first_interface(handle: HANDLE) -> Result<GUID, RadioError> {
    let mut list: *mut WLAN_INTERFACE_INFO_LIST = null_mut();
    win32(unsafe { WlanEnumInterfaces(handle, None, &mut list) })?;
    unsafe {
        let n = (*list).dwNumberOfItems as usize;
        let result = if n == 0 {
            Err(RadioError::NoWlanInterface)
        } else {
            Ok(std::slice::from_raw_parts((*list).InterfaceInfo.as_ptr(), n)[0].InterfaceGuid)
        };
        WlanFreeMemory(list as *const c_void);
        result
    }
}

fn ssid_visible(handle: HANDLE, guid: &GUID, ssid: &str) -> bool {
    let mut nets: *mut WLAN_AVAILABLE_NETWORK_LIST = null_mut();
    if unsafe { WlanGetAvailableNetworkList(handle, guid, 0, None, &mut nets) } != 0 {
        return false;
    }
    unsafe {
        let items =
            std::slice::from_raw_parts((*nets).Network.as_ptr(), (*nets).dwNumberOfItems as usize);
        let found = items.iter().any(|n| {
            &n.dot11Ssid.ucSSID[..n.dot11Ssid.uSSIDLength as usize] == ssid.as_bytes()
        });
        WlanFreeMemory(nets as *const c_void);
        found
    }
}

unsafe extern "system" fn on_acm_notification(data: *mut L2_NOTIFICATION_DATA, context: *mut c_void) {
    if data.is_null() || context.is_null() {
        return;
    }
    let data = unsafe { &*data };
    if data.NotificationSource == WLAN_NOTIFICATION_SOURCE_ACM
        && data.NotificationCode == wlan_notification_acm_connection_complete.0 as u32
    {
        let sender = unsafe { &*(context as *const mpsc::Sender<()>) };
        let _ = sender.send(());
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// WPA2-PSK profile with MAC randomization disabled (stable client identity
/// across reconnects) and manual connection mode (Windows must not auto-chase
/// a transient GO). Namespaces are http:// — that's what real profiles use.
fn profile_xml(ssid: &str, passphrase: &str) -> String {
    let ssid = xml_escape(ssid);
    let passphrase = xml_escape(passphrase);
    format!(
        r#"<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
    <name>{ssid}</name>
    <SSIDConfig><SSID><name>{ssid}</name></SSID><nonBroadcast>false</nonBroadcast></SSIDConfig>
    <connectionType>ESS</connectionType>
    <connectionMode>manual</connectionMode>
    <MSM>
        <security>
            <authEncryption>
                <authentication>WPA2PSK</authentication>
                <encryption>AES</encryption>
                <useOneX>false</useOneX>
            </authEncryption>
            <sharedKey>
                <keyType>passPhrase</keyType>
                <protected>false</protected>
                <keyMaterial>{passphrase}</keyMaterial>
            </sharedKey>
        </security>
    </MSM>
    <MacRandomization xmlns="http://www.microsoft.com/networking/WLAN/profile/v3">
        <enableRandomization>false</enableRandomization>
    </MacRandomization>
</WLANProfile>"#
    )
}
