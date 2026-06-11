//! WiFi-Direct legacy-AP host: an autonomous group owner advertising a plain
//! WPA2 SSID that any device can join — no pairing, no consent prompts, works
//! from a normal Win32 process (docs/mesh-notes/winrt-radio-api.md).
//!
//! Lifetime rules that are easy to get wrong:
//! - The GO exists exactly as long as the publisher COM object — keep the
//!   host struct alive for the whole session.
//! - Every accepted client's `WiFiDirectDevice` must be held; dropping one
//!   drops that client's association.
//! - Win11 can leave a dead publisher stuck in `Started`
//!   (Windows-universal-samples#1400): never restart an instance — drop it
//!   and `start()` a brand-new host.

use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use windows::core::{Ref, HSTRING};
use windows::Devices::WiFiDirect::{
    WiFiDirectAdvertisementListenStateDiscoverability, WiFiDirectAdvertisementPublisher,
    WiFiDirectAdvertisementPublisherStatus,
    WiFiDirectAdvertisementPublisherStatusChangedEventArgs, WiFiDirectConnectionListener,
    WiFiDirectConnectionRequestedEventArgs, WiFiDirectDevice,
};
use windows::Foundation::TypedEventHandler;
use windows::Security::Credentials::PasswordCredential;

use crate::{RadioError, RadioEvent};

pub struct LegacyApHost {
    publisher: WiFiDirectAdvertisementPublisher,
    listener: WiFiDirectConnectionListener,
    status_token: i64,
    conn_token: i64,
    devices: Arc<Mutex<Vec<WiFiDirectDevice>>>,
    pub ssid: String,
}

impl LegacyApHost {
    /// Start advertising. `Start()` is asynchronous: success is the
    /// `RadioEvent::ApStarted` on `events`; `ApAborted` means the OS refused
    /// (radio off, Mobile Hotspot active — which takes precedence over all
    /// WiFi-Direct, documented).
    pub fn start(
        ssid: &str,
        passphrase: &str,
        events: Sender<RadioEvent>,
    ) -> Result<Self, RadioError> {
        if !(8..=63).contains(&passphrase.len()) {
            return Err(RadioError::BadPassphrase);
        }
        if ssid.is_empty() || ssid.len() > 32 {
            return Err(RadioError::BadSsid);
        }

        let publisher = WiFiDirectAdvertisementPublisher::new()?;

        // Register BEFORE Start() so Started/Aborted is never missed. The
        // closure runs on a WinRT threadpool thread — only signal the channel.
        let status_events = events.clone();
        let status_token = publisher.StatusChanged(&TypedEventHandler::new(
            move |_sender: Ref<'_, WiFiDirectAdvertisementPublisher>,
                  args: Ref<'_, WiFiDirectAdvertisementPublisherStatusChangedEventArgs>| {
                let args = args.ok()?;
                let status = args.Status()?;
                let event = if status == WiFiDirectAdvertisementPublisherStatus::Started {
                    Some(RadioEvent::ApStarted)
                } else if status == WiFiDirectAdvertisementPublisherStatus::Stopped {
                    Some(RadioEvent::ApStopped)
                } else if status == WiFiDirectAdvertisementPublisherStatus::Aborted {
                    let detail = match args.Error() {
                        Ok(e) => format!("{e:?}"),
                        Err(e) => e.to_string(),
                    };
                    Some(RadioEvent::ApAborted(detail))
                } else {
                    None // Created
                };
                if let Some(event) = event {
                    let _ = status_events.send(event);
                }
                Ok(())
            },
        ))?;

        let advertisement = publisher.Advertisement()?;
        advertisement.SetIsAutonomousGroupOwnerEnabled(true)?;
        advertisement.SetListenStateDiscoverability(
            WiFiDirectAdvertisementListenStateDiscoverability::Normal,
        )?;

        let legacy = advertisement.LegacySettings()?;
        legacy.SetIsEnabled(true)?;
        legacy.SetSsid(&HSTRING::from(ssid))?;
        let credential = PasswordCredential::new()?;
        credential.SetPassword(&HSTRING::from(passphrase))?;
        legacy.SetPassphrase(&credential)?;

        let devices: Arc<Mutex<Vec<WiFiDirectDevice>>> = Arc::default();
        let listener = WiFiDirectConnectionListener::new()?;
        let conn_devices = devices.clone();
        let conn_token = listener.ConnectionRequested(&TypedEventHandler::new(
            move |_listener: Ref<'_, WiFiDirectConnectionListener>,
                  args: Ref<'_, WiFiDirectConnectionRequestedEventArgs>| {
                let request = args.ok()?.GetConnectionRequest()?;
                let id = request.DeviceInformation()?.Id()?;
                // Blocking get() is fine on the threadpool thread.
                let device = WiFiDirectDevice::FromIdAsync(&id)?.get()?;
                if let Ok(mut held) = conn_devices.lock() {
                    held.push(device);
                }
                let _ = events.send(RadioEvent::ClientConnected(id.to_string()));
                Ok(())
            },
        ))?;

        publisher.Start()?;

        Ok(Self {
            publisher,
            listener,
            status_token,
            conn_token,
            devices,
            ssid: ssid.to_string(),
        })
    }

    pub fn client_count(&self) -> usize {
        self.devices.lock().map(|d| d.len()).unwrap_or(0)
    }

    /// Best-effort teardown; also runs on drop.
    pub fn stop(&self) {
        let _ = self.listener.RemoveConnectionRequested(self.conn_token);
        let _ = self.publisher.RemoveStatusChanged(self.status_token);
        let _ = self.publisher.Stop();
        if let Ok(mut devices) = self.devices.lock() {
            devices.clear();
        }
    }
}

impl Drop for LegacyApHost {
    fn drop(&mut self) {
        self.stop();
    }
}
