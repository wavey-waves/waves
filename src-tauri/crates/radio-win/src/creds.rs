//! Room-code → radio credentials (docs/MESH.md decision D2).
//!
//! Both the host and joiners derive the same SSID + WPA2 passphrase from the
//! 6-character room code, so joining a forest mesh needs exactly the same
//! knowledge as joining a custom room: the code. Tradeoff accepted in D2:
//! anyone who learns the code can join the radio network.

pub const SSID_PREFIX: &str = "WAVES-";

pub fn derive_credentials(code: &str) -> (String, String) {
    let code = code.trim().to_ascii_uppercase();
    let ssid = format!("{SSID_PREFIX}{code}");
    // 6-char codes yield 17 chars — comfortably inside WPA2's 8..=63 rule,
    // and lowercase keeps it distinct from the (visible) SSID.
    let passphrase = format!("waves-{}-mesh", code.to_ascii_lowercase());
    (ssid, passphrase)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derivation_is_deterministic_and_case_insensitive() {
        let (ssid_a, psk_a) = derive_credentials("ab12cd");
        let (ssid_b, psk_b) = derive_credentials(" AB12CD ");
        assert_eq!(ssid_a, ssid_b);
        assert_eq!(psk_a, psk_b);
        assert_eq!(ssid_a, "WAVES-AB12CD");
        assert_eq!(psk_a, "waves-ab12cd-mesh");
    }

    #[test]
    fn outputs_respect_radio_limits() {
        let (ssid, psk) = derive_credentials("AB12CD");
        assert!(!ssid.is_empty() && ssid.len() <= 32, "SSID must fit 802.11");
        assert!((8..=63).contains(&psk.len()), "passphrase must satisfy WPA2");
    }
}
