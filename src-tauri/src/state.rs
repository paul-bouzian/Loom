use std::path::PathBuf;

use tauri::AppHandle;

use crate::app_identity::prepare_storage_paths;
use crate::error::AppResult;
use crate::infrastructure::database::AppDatabase;
use crate::runtime::supervisor::RuntimeSupervisor;
use crate::services::pull_requests::PullRequestMonitorService;
use crate::services::terminal::TerminalService;
use crate::services::voice::VoiceService;
use crate::services::workspace::WorkspaceService;
use crate::services::worktree_scripts::WorktreeScriptService;

pub struct AppState {
    pub handle: AppHandle,
    pub workspace: WorkspaceService,
    pub pull_requests: PullRequestMonitorService,
    pub runtime: RuntimeSupervisor,
    pub voice: VoiceService,
    pub terminal: TerminalService,
    pub app_data_dir: PathBuf,
}

impl AppState {
    pub fn new(app: &AppHandle) -> AppResult<Self> {
        let storage_paths = prepare_storage_paths(app)?;
        let app_data_dir = storage_paths.app_data_dir.clone();
        std::fs::create_dir_all(storage_paths.app_home_dir.join("chats"))?;
        let database = AppDatabase::new(&storage_paths)?;
        let workspace = WorkspaceService::new(
            database,
            storage_paths.app_home_dir.join("worktrees"),
            storage_paths.app_home_dir.join("chats"),
            WorktreeScriptService::new(app.clone(), app_data_dir.clone()),
        );

        Ok(Self {
            handle: app.clone(),
            pull_requests: PullRequestMonitorService::new(app.clone(), workspace.clone()),
            workspace,
            runtime: RuntimeSupervisor::new(app.clone(), env!("CARGO_PKG_VERSION").to_string()),
            voice: VoiceService::new(),
            terminal: TerminalService::default(),
            app_data_dir,
        })
    }
}
