use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningEffort {
    Low,
    Medium,
    High,
    #[serde(rename = "xhigh")]
    XHigh,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CollaborationMode {
    Build,
    Plan,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum ApprovalPolicy {
    #[serde(rename = "askToEdit")]
    AskToEdit,
    #[serde(rename = "fullAccess")]
    FullAccess,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSettings {
    pub default_model: String,
    pub default_reasoning_effort: ReasoningEffort,
    pub default_collaboration_mode: CollaborationMode,
    pub default_approval_policy: ApprovalPolicy,
    pub codex_binary_path: Option<String>,
}

impl Default for GlobalSettings {
    fn default() -> Self {
        Self {
            default_model: "gpt-5.4".to_string(),
            default_reasoning_effort: ReasoningEffort::High,
            default_collaboration_mode: CollaborationMode::Build,
            default_approval_policy: ApprovalPolicy::AskToEdit,
            codex_binary_path: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSettingsPatch {
    pub default_model: Option<String>,
    pub default_reasoning_effort: Option<ReasoningEffort>,
    pub default_collaboration_mode: Option<CollaborationMode>,
    pub default_approval_policy: Option<ApprovalPolicy>,
    pub codex_binary_path: Option<Option<String>>,
}

impl GlobalSettings {
    pub fn apply_patch(&mut self, patch: GlobalSettingsPatch) {
        if let Some(default_model) = patch.default_model {
            self.default_model = default_model;
        }
        if let Some(default_reasoning_effort) = patch.default_reasoning_effort {
            self.default_reasoning_effort = default_reasoning_effort;
        }
        if let Some(default_collaboration_mode) = patch.default_collaboration_mode {
            self.default_collaboration_mode = default_collaboration_mode;
        }
        if let Some(default_approval_policy) = patch.default_approval_policy {
            self.default_approval_policy = default_approval_policy;
        }
        if let Some(codex_binary_path) = patch.codex_binary_path {
            self.codex_binary_path = codex_binary_path;
        }
    }
}
