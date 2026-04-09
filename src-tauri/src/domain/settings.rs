use serde::{Deserialize, Serialize};

use super::shortcuts::{ShortcutSettings, ShortcutSettingsPatch};

fn default_collapse_work_activity() -> bool {
    true
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningEffort {
    Low,
    Medium,
    High,
    #[serde(rename = "xhigh")]
    XHigh,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CollaborationMode {
    Build,
    Plan,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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
    #[serde(default = "default_collapse_work_activity")]
    pub collapse_work_activity: bool,
    #[serde(default)]
    pub shortcuts: ShortcutSettings,
    pub codex_binary_path: Option<String>,
}

impl Default for GlobalSettings {
    fn default() -> Self {
        Self {
            default_model: "gpt-5.4".to_string(),
            default_reasoning_effort: ReasoningEffort::High,
            default_collaboration_mode: CollaborationMode::Build,
            default_approval_policy: ApprovalPolicy::AskToEdit,
            collapse_work_activity: true,
            shortcuts: ShortcutSettings::default(),
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
    pub collapse_work_activity: Option<bool>,
    pub shortcuts: Option<ShortcutSettingsPatch>,
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
        if let Some(collapse_work_activity) = patch.collapse_work_activity {
            self.collapse_work_activity = collapse_work_activity;
        }
        if let Some(shortcuts) = patch.shortcuts {
            self.shortcuts.apply_patch(shortcuts);
        }
        if let Some(codex_binary_path) = patch.codex_binary_path {
            self.codex_binary_path = codex_binary_path;
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        self.shortcuts.validate().map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ApprovalPolicy, CollaborationMode, GlobalSettings, GlobalSettingsPatch, ReasoningEffort,
    };
    use crate::domain::shortcuts::ShortcutSettingsPatch;

    #[test]
    fn apply_patch_updates_only_provided_fields() {
        let mut settings = GlobalSettings::default();

        settings.apply_patch(GlobalSettingsPatch {
            default_model: Some("gpt-5.3-codex".to_string()),
            default_reasoning_effort: Some(ReasoningEffort::Medium),
            default_collaboration_mode: None,
            default_approval_policy: Some(ApprovalPolicy::FullAccess),
            collapse_work_activity: Some(true),
            shortcuts: Some(ShortcutSettingsPatch {
                toggle_terminal: Some(Some("mod+shift+j".to_string())),
                ..ShortcutSettingsPatch::default()
            }),
            codex_binary_path: Some(Some("/opt/homebrew/bin/codex".to_string())),
        });

        assert_eq!(settings.default_model, "gpt-5.3-codex");
        assert!(matches!(
            settings.default_reasoning_effort,
            ReasoningEffort::Medium
        ));
        assert!(matches!(
            settings.default_collaboration_mode,
            CollaborationMode::Build
        ));
        assert!(matches!(
            settings.default_approval_policy,
            ApprovalPolicy::FullAccess
        ));
        assert!(settings.collapse_work_activity);
        assert_eq!(settings.shortcuts.toggle_terminal.as_deref(), Some("mod+shift+j"));
        assert_eq!(
            settings.codex_binary_path.as_deref(),
            Some("/opt/homebrew/bin/codex")
        );
    }

    #[test]
    fn apply_patch_can_clear_optional_binary_path() {
        let mut settings = GlobalSettings {
            codex_binary_path: Some("/opt/homebrew/bin/codex".to_string()),
            ..GlobalSettings::default()
        };

        settings.apply_patch(GlobalSettingsPatch {
            codex_binary_path: Some(None),
            ..GlobalSettingsPatch::default()
        });

        assert_eq!(settings.codex_binary_path, None);
    }

    #[test]
    fn default_settings_enable_collapsed_work_activity_and_shortcuts() {
        let settings = GlobalSettings::default();

        assert!(settings.collapse_work_activity);
        assert_eq!(settings.shortcuts.toggle_terminal.as_deref(), Some("mod+j"));
    }

    #[test]
    fn deserialize_legacy_settings_defaults_collapse_work_activity_and_shortcuts() {
        let settings: GlobalSettings = serde_json::from_str(
            r#"{
                "defaultModel":"gpt-5.4",
                "defaultReasoningEffort":"high",
                "defaultCollaborationMode":"build",
                "defaultApprovalPolicy":"askToEdit",
                "codexBinaryPath":"/opt/homebrew/bin/codex"
            }"#,
        )
        .expect("legacy settings should deserialize");

        assert!(settings.collapse_work_activity);
        assert_eq!(settings.shortcuts.open_settings.as_deref(), Some("mod+comma"));
    }

    #[test]
    fn validate_uses_shortcut_rules() {
        let mut settings = GlobalSettings::default();
        settings.shortcuts.toggle_terminal = Some("j".to_string());

        assert_eq!(
            settings.validate().expect_err("invalid shortcuts should fail"),
            "Toggle terminal: Shortcut needs a primary modifier unless it is Shift+Tab."
        );
    }
}
