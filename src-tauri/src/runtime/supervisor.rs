use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;

use chrono::Utc;
use tokio::process::{Child, Command};

use crate::domain::workspace::{RuntimeState, RuntimeStatusSnapshot};
use crate::error::{AppError, AppResult};

#[derive(Debug)]
struct RunningRuntime {
    child: Child,
    status: RuntimeStatusSnapshot,
}

#[derive(Debug, Default)]
struct RuntimeRegistry {
    running: HashMap<String, RunningRuntime>,
    last_known: HashMap<String, RuntimeStatusSnapshot>,
}

#[derive(Debug, Default)]
pub struct RuntimeSupervisor {
    registry: Mutex<RuntimeRegistry>,
}

impl RuntimeSupervisor {
    pub fn refresh_statuses(&self) -> AppResult<Vec<RuntimeStatusSnapshot>> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| AppError::Runtime("The runtime registry is poisoned.".to_string()))?;

        let environment_ids = registry.running.keys().cloned().collect::<Vec<_>>();

        for environment_id in environment_ids {
            let Some(runtime) = registry.running.get_mut(&environment_id) else {
                continue;
            };
            let exited = runtime.child.try_wait()?;

            if let Some(exit_status) = exited {
                let Some(removed) = registry.running.remove(&environment_id) else {
                    continue;
                };
                let mut status = removed.status;
                status.state = RuntimeState::Exited;
                status.last_exit_code = exit_status.code();
                registry.last_known.insert(environment_id.clone(), status);
            }
        }

        Ok(registry.last_known.values().cloned().collect())
    }

    pub fn start(
        &self,
        environment_id: &str,
        environment_path: &str,
        codex_binary_path: Option<String>,
    ) -> AppResult<RuntimeStatusSnapshot> {
        self.refresh_statuses()?;

        let mut registry = self
            .registry
            .lock()
            .map_err(|_| AppError::Runtime("The runtime registry is poisoned.".to_string()))?;

        if let Some(runtime) = registry.running.get(environment_id) {
            return Ok(runtime.status.clone());
        }

        let binary_path = match codex_binary_path {
            Some(path) => path,
            None => which::which("codex")
                .map_err(|_| AppError::Runtime("Unable to resolve the Codex CLI binary.".to_string()))?
                .to_string_lossy()
                .to_string(),
        };

        let mut command = Command::new(&binary_path);
        command
            .arg("app-server")
            .current_dir(environment_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);

        let child = command.spawn()?;
        let status = RuntimeStatusSnapshot {
            environment_id: environment_id.to_string(),
            state: RuntimeState::Running,
            pid: child.id(),
            binary_path: Some(binary_path),
            started_at: Some(Utc::now()),
            last_exit_code: None,
        };

        registry.running.insert(
            environment_id.to_string(),
            RunningRuntime {
                child,
                status: status.clone(),
            },
        );
        registry
            .last_known
            .insert(environment_id.to_string(), status.clone());

        Ok(status)
    }

    pub fn stop(&self, environment_id: &str) -> AppResult<RuntimeStatusSnapshot> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| AppError::Runtime("The runtime registry is poisoned.".to_string()))?;

        if let Some(mut runtime) = registry.running.remove(environment_id) {
            runtime.child.start_kill()?;

            let status = RuntimeStatusSnapshot {
                environment_id: environment_id.to_string(),
                state: RuntimeState::Stopped,
                pid: None,
                binary_path: runtime.status.binary_path.clone(),
                started_at: None,
                last_exit_code: None,
            };
            registry
                .last_known
                .insert(environment_id.to_string(), status.clone());
            return Ok(status);
        }

        Ok(registry
            .last_known
            .get(environment_id)
            .cloned()
            .unwrap_or(RuntimeStatusSnapshot {
                environment_id: environment_id.to_string(),
                state: RuntimeState::Stopped,
                pid: None,
                binary_path: None,
                started_at: None,
                last_exit_code: None,
            }))
    }
}
