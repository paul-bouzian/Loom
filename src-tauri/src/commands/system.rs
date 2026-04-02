use serde::Serialize;
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStatus {
    app_name: String,
    app_version: String,
    backend: String,
    platform: String,
    app_data_dir: String,
    database_path: String,
    project_count: usize,
    environment_count: usize,
    thread_count: usize,
}

#[tauri::command]
pub fn get_bootstrap_status(state: State<'_, AppState>) -> Result<BootstrapStatus, crate::error::CommandError> {
    let runtime_statuses = state.runtime.refresh_statuses()?;
    let snapshot = state.workspace.snapshot(runtime_statuses)?;
    let environment_count = snapshot
        .projects
        .iter()
        .map(|project| project.environments.len())
        .sum::<usize>();
    let thread_count = snapshot
        .projects
        .iter()
        .flat_map(|project| project.environments.iter())
        .map(|environment| environment.threads.len())
        .sum::<usize>();

    Ok(BootstrapStatus {
        app_name: "ThreadEx".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        backend: "registry-ready".to_string(),
        platform: std::env::consts::OS.to_string(),
        app_data_dir: state.app_data_dir.to_string_lossy().to_string(),
        database_path: state.workspace.database_path().to_string_lossy().to_string(),
        project_count: snapshot.projects.len(),
        environment_count,
        thread_count,
    })
}
