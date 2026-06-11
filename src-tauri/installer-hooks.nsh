; NSIS hooks consumed by Tauri's bundler (tauri.conf.json →
; bundle.windows.nsis.installerHooks).
;
; Discovery is UDP multicast (mDNS 5353) + broadcast (beacon 47474) + dynamic
; QUIC ports. Windows Firewall silently drops all of it for unlisted programs
; — the documented #1 "mesh finds nobody" failure (docs/MESH.md L2) — so the
; installer adds a program-scoped inbound allow rule for the app binary on
; private AND public profiles (forest-mode networks classify as Public).

!macro NSIS_HOOK_POSTINSTALL
  ; Idempotent: drop any stale rule from a previous install first.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Waves Mesh"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Waves Mesh" dir=in action=allow program="$INSTDIR\Waves.exe" enable=yes profile=private,public'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Waves Mesh"'
!macroend
