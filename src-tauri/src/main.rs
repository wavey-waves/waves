// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ipc;

fn main() {
    tracing_subscriber_init();

    tauri::Builder::default()
        .manage(ipc::Mesh::default())
        .setup(|app| {
            ipc::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::mesh_info,
            ipc::mesh_set_author,
            ipc::mesh_send_text,
            ipc::mesh_history,
            ipc::mesh_peers,
            ipc::mesh_subscribe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Plain env-filter logging to stderr; `RUST_LOG=mesh_core=debug` etc.
fn tracing_subscriber_init() {
    use tracing::level_filters::LevelFilter;
    use tracing_subscriber::EnvFilter;

    let filter = EnvFilter::builder()
        .with_default_directive(LevelFilter::INFO.into())
        .from_env_lossy();
    tracing_subscriber::fmt().with_env_filter(filter).init();
}
