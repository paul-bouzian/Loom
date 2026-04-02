use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStatus {
    app_name: String,
    app_version: String,
    backend: String,
    platform: String,
}

#[tauri::command]
pub fn get_bootstrap_status() -> BootstrapStatus {
    BootstrapStatus {
        app_name: "ThreadEx".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        backend: "ready".to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}
