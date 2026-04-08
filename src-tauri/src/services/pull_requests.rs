mod github;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;
use tracing::warn;

use crate::domain::workspace::{
    EnvironmentPullRequestSnapshot, WorkspaceEvent, WorkspaceEventKind,
};
use crate::error::AppResult;
use crate::services::workspace::{PullRequestWatchTarget, WorkspaceService};

const WORKSPACE_EVENT_NAME: &str = "threadex://workspace-event";
const PULL_REQUEST_REFRESH_INTERVAL: Duration = Duration::from_secs(30);
const PULL_REQUEST_REFRESH_CONCURRENCY: usize = 4;

#[derive(Debug, Clone)]
pub struct PullRequestMonitorService {
    app: Option<AppHandle>,
    workspace: WorkspaceService,
    state: Arc<PullRequestMonitorState>,
}

#[derive(Debug, Default)]
struct PullRequestMonitorState {
    snapshots: RwLock<HashMap<String, EnvironmentPullRequestSnapshot>>,
    in_flight: Mutex<HashSet<String>>,
    refresh_notify: Notify,
}

impl PullRequestMonitorService {
    pub fn new(app: AppHandle, workspace: WorkspaceService) -> Self {
        let service = Self {
            app: Some(app),
            workspace,
            state: Arc::new(PullRequestMonitorState::default()),
        };
        service.spawn_refresh_loop();
        service
    }

    #[cfg(test)]
    fn for_test(workspace: WorkspaceService) -> Self {
        Self {
            app: None,
            workspace,
            state: Arc::new(PullRequestMonitorState::default()),
        }
    }

    pub fn snapshot(&self) -> HashMap<String, EnvironmentPullRequestSnapshot> {
        self.state
            .snapshots
            .read()
            .expect("pull request snapshots lock should not be poisoned")
            .clone()
    }

    pub fn refresh_now(&self) {
        self.state.refresh_notify.notify_one();
    }

    fn spawn_refresh_loop(&self) {
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            service.run_refresh_loop().await;
        });
    }

    async fn run_refresh_loop(self) {
        loop {
            if let Err(error) = self.refresh_once().await {
                warn!("failed to refresh pull request state: {error}");
            }

            tokio::select! {
                _ = tokio::time::sleep(PULL_REQUEST_REFRESH_INTERVAL) => {}
                _ = self.state.refresh_notify.notified() => {}
            }
        }
    }

    async fn refresh_once(&self) -> AppResult<()> {
        let targets = self.workspace.pull_request_watch_targets()?;
        self.prune_stale_snapshots(&targets);

        let semaphore = Arc::new(tokio::sync::Semaphore::new(
            PULL_REQUEST_REFRESH_CONCURRENCY.max(1),
        ));
        let mut tasks = Vec::with_capacity(targets.len());
        for target in targets {
            let permit = semaphore
                .clone()
                .acquire_owned()
                .await
                .expect("pull request refresh semaphore should remain open");
            let monitor = self.clone();
            tasks.push(tauri::async_runtime::spawn(async move {
                let _permit = permit;
                monitor.refresh_target(target).await;
            }));
        }

        for task in tasks {
            let _ = task.await;
        }

        Ok(())
    }

    fn prune_stale_snapshots(&self, targets: &[PullRequestWatchTarget]) {
        let live_environment_ids = targets
            .iter()
            .map(|target| target.environment_id.as_str())
            .collect::<HashSet<_>>();
        let stale_ids = {
            let snapshots = self
                .state
                .snapshots
                .read()
                .expect("pull request snapshots lock should not be poisoned");
            snapshots
                .keys()
                .filter(|environment_id| !live_environment_ids.contains(environment_id.as_str()))
                .cloned()
                .collect::<Vec<_>>()
        };

        if stale_ids.is_empty() {
            return;
        }

        let mut snapshots = self
            .state
            .snapshots
            .write()
            .expect("pull request snapshots lock should not be poisoned");
        for environment_id in stale_ids {
            snapshots.remove(&environment_id);
        }
    }

    async fn refresh_target(&self, target: PullRequestWatchTarget) {
        if !self.begin_target_refresh(&target.environment_id) {
            return;
        }

        let next_snapshot = {
            let resolve_target = target.clone();
            match tokio::task::spawn_blocking(move || {
                github::resolve_pull_request_for_target(&resolve_target)
            })
            .await
            {
                Ok(Ok(snapshot)) => snapshot,
                Ok(Err(error)) => {
                    warn!(
                        environment_id = target.environment_id,
                        path = %target.path,
                        "failed to resolve pull request state: {error}"
                    );
                    None
                }
                Err(error) => {
                    warn!(
                        environment_id = target.environment_id,
                        path = %target.path,
                        "pull request refresh task failed: {error}"
                    );
                    None
                }
            }
        };

        self.finish_target_refresh(target, next_snapshot);
    }

    fn begin_target_refresh(&self, environment_id: &str) -> bool {
        let mut in_flight = self
            .state
            .in_flight
            .lock()
            .expect("pull request in-flight lock should not be poisoned");
        in_flight.insert(environment_id.to_string())
    }

    fn finish_target_refresh(
        &self,
        target: PullRequestWatchTarget,
        next_snapshot: Option<EnvironmentPullRequestSnapshot>,
    ) {
        {
            let mut in_flight = self
                .state
                .in_flight
                .lock()
                .expect("pull request in-flight lock should not be poisoned");
            in_flight.remove(&target.environment_id);
        }

        let changed = {
            let mut snapshots = self
                .state
                .snapshots
                .write()
                .expect("pull request snapshots lock should not be poisoned");
            let previous = snapshots.get(&target.environment_id).cloned();
            if previous == next_snapshot {
                false
            } else {
                match next_snapshot {
                    Some(snapshot) => {
                        snapshots.insert(target.environment_id.clone(), snapshot);
                    }
                    None => {
                        snapshots.remove(&target.environment_id);
                    }
                }
                true
            }
        };

        if changed {
            self.emit_workspace_event(target.project_id, target.environment_id);
        }
    }

    fn emit_workspace_event(&self, project_id: String, environment_id: String) {
        let Some(app) = self.app.as_ref() else {
            return;
        };

        if let Err(error) = app.emit(
            WORKSPACE_EVENT_NAME,
            WorkspaceEvent {
                kind: WorkspaceEventKind::EnvironmentPullRequestChanged,
                project_id: Some(project_id),
                environment_id: Some(environment_id),
                thread_id: None,
            },
        ) {
            warn!("failed to emit workspace pull request event: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::PullRequestMonitorService;
    use crate::domain::workspace::{EnvironmentPullRequestSnapshot, PullRequestState};
    use crate::services::workspace::{PullRequestWatchTarget, WorkspaceService};
    use crate::services::worktree_scripts::WorktreeScriptService;

    #[test]
    fn monitor_replaces_changed_snapshots() {
        let monitor = PullRequestMonitorService::for_test(test_workspace_service());
        monitor.finish_target_refresh(
            PullRequestWatchTarget {
                environment_id: "env-1".to_string(),
                project_id: "project-1".to_string(),
                path: "/tmp/env-1".to_string(),
                git_branch: "feature".to_string(),
            },
            Some(EnvironmentPullRequestSnapshot {
                number: 3,
                title: "Initial".to_string(),
                url: "https://github.com/acme/threadex/pull/3".to_string(),
                state: PullRequestState::Open,
            }),
        );

        monitor.finish_target_refresh(
            PullRequestWatchTarget {
                environment_id: "env-1".to_string(),
                project_id: "project-1".to_string(),
                path: "/tmp/env-1".to_string(),
                git_branch: "feature".to_string(),
            },
            Some(EnvironmentPullRequestSnapshot {
                number: 4,
                title: "Updated".to_string(),
                url: "https://github.com/acme/threadex/pull/4".to_string(),
                state: PullRequestState::Merged,
            }),
        );

        let snapshot = monitor.snapshot();
        assert_eq!(snapshot.get("env-1").map(|value| value.number), Some(4));
        assert_eq!(
            snapshot.get("env-1").map(|value| value.state),
            Some(PullRequestState::Merged)
        );
    }

    fn test_workspace_service() -> WorkspaceService {
        let temp_root =
            std::env::temp_dir().join(format!("threadex-pr-monitor-test-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&temp_root).expect("temp root should be created");
        let database = crate::infrastructure::database::AppDatabase::for_test(
            temp_root.join("threadex.sqlite3"),
        )
        .expect("test database should be created");
        WorkspaceService::new(
            database,
            temp_root.join("managed-worktrees"),
            WorktreeScriptService::for_test(temp_root),
        )
    }
}
