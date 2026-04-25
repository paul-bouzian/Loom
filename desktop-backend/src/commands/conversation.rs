use serde::Deserialize;
use tracing::warn;

use crate::app_identity::{FIRST_PROMPT_RENAME_FAILURE_EVENT_NAME, WORKSPACE_EVENT_NAME};
use crate::domain::conversation::{
    ComposerFileSearchResult, ComposerMentionBindingInput, ComposerTarget,
    ConversationComposerDraft, ConversationComposerSettings, ConversationImageAttachment,
    ConversationStatus, RespondToApprovalRequestInput, RespondToUserInputRequestInput,
    SubmitPlanDecisionInput, ThreadComposerCatalog, ThreadConversationOpenResponse,
    ThreadConversationSnapshot,
};
use crate::domain::settings::ProviderKind;
use crate::domain::workspace::{
    ThreadHandoffBootstrapStatus, ThreadHandoffImportedMessage, ThreadHandoffState,
};
use crate::domain::workspace::{WorkspaceEvent, WorkspaceEventKind};
use crate::error::{AppError, CommandError};
use crate::events::EventSink;
use crate::services::workspace::{
    AutoRenameFirstPromptRequest, CreateThreadHandoffRequest, WorkspaceService,
};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendThreadMessageInput {
    pub thread_id: String,
    pub text: String,
    pub composer: Option<ConversationComposerSettings>,
    pub images: Option<Vec<ConversationImageAttachment>>,
    pub mention_bindings: Option<Vec<ComposerMentionBindingInput>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchComposerFilesInput {
    pub target: ComposerTarget,
    pub request_key: String,
    pub query: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistThreadComposerDraftInput {
    pub thread_id: String,
    pub draft: Option<ConversationComposerDraft>,
}

pub async fn open_thread_conversation_impl(
    state: &AppState,
    thread_id: String,
) -> Result<ThreadConversationOpenResponse, CommandError> {
    let context = state.workspace.thread_runtime_context(&thread_id)?;
    let composer_draft = state.workspace.thread_composer_draft(&thread_id)?;
    let mut response = state.runtime.open_thread(context).await?;
    response.composer_draft = composer_draft;
    Ok(response)
}

pub fn save_thread_composer_draft_impl(
    state: &AppState,
    input: PersistThreadComposerDraftInput,
) -> Result<(), CommandError> {
    validate_non_blank_thread_id(&input.thread_id)?;
    validate_thread_composer_draft(input.draft.as_ref())?;
    state
        .workspace
        .persist_thread_composer_draft(&input.thread_id, input.draft.as_ref())?;
    Ok(())
}

pub async fn refresh_thread_conversation_impl(
    state: &AppState,
    thread_id: String,
) -> Result<ThreadConversationSnapshot, CommandError> {
    let context = state.workspace.thread_runtime_context(&thread_id)?;
    Ok(state.runtime.refresh_thread(context).await?)
}

pub async fn get_composer_catalog_impl(
    state: &AppState,
    target: ComposerTarget,
) -> Result<ThreadComposerCatalog, CommandError> {
    validate_composer_target(&target)?;
    let context = state.workspace.composer_target_context(&target)?;
    Ok(state.runtime.get_composer_catalog(context).await?)
}

pub async fn search_composer_files_impl(
    state: &AppState,
    input: SearchComposerFilesInput,
) -> Result<Vec<ComposerFileSearchResult>, CommandError> {
    validate_composer_target(&input.target)?;
    validate_non_blank_request_key(&input.request_key)?;
    let context = state.workspace.composer_target_context(&input.target)?;
    let limit = input.limit.unwrap_or(50).min(200);
    Ok(state
        .runtime
        .search_composer_files(context, &input.request_key, input.query, limit)
        .await?)
}

pub async fn send_thread_message_impl(
    state: &AppState,
    input: SendThreadMessageInput,
) -> Result<ThreadConversationSnapshot, CommandError> {
    let mut context = state.workspace.thread_runtime_context(&input.thread_id)?;
    let should_auto_rename = state.workspace.thread_needs_auto_title(&input.thread_id)?;
    let requested_composer = input.composer.clone();
    let message_text = input.text;
    if let Some(composer) = requested_composer.clone() {
        validate_thread_provider_lock(context.provider, composer.provider)?;
        context.composer = composer;
    }
    let rename_result = if !message_text.trim().is_empty() {
        let workspace = state.workspace.clone();
        let rename_request = AutoRenameFirstPromptRequest {
            thread_id: input.thread_id.clone(),
            message: message_text.clone(),
            codex_binary_path: context.codex_binary_path.clone(),
        };
        match spawn_blocking(move || {
            workspace.maybe_auto_rename_first_prompt_environment(rename_request)
        })
        .await
        {
            Ok(result) => result,
            Err(error) => {
                let message = error.message.clone();
                let thread_id = input.thread_id.clone();
                warn!(
                    thread_id,
                    "failed to auto-rename first prompt environment: {message}"
                );
                emit_first_prompt_rename_failure_event(
                    &state.events,
                    &state.workspace,
                    &thread_id,
                    message,
                );
                None
            }
        }
    } else {
        None
    };

    if let Some(rename) = rename_result.as_ref() {
        if rename.environment_renamed {
            state.pull_requests.clear_snapshot(&rename.environment_id);
            emit_workspace_event(
                &state.events,
                WorkspaceEvent {
                    kind: WorkspaceEventKind::EnvironmentRenamed,
                    project_id: Some(rename.project_id.clone()),
                    environment_id: Some(rename.environment_id.clone()),
                    thread_id: Some(rename.thread_id.clone()),
                },
            );
            state.pull_requests.refresh_now();
            if let Err(error) = state.runtime.stop(&rename.environment_id).await {
                warn!(
                    environment_id = rename.environment_id,
                    "failed to stop runtime after first prompt rename: {error}"
                );
            }
            context = state.workspace.thread_runtime_context(&input.thread_id)?;
            if let Some(composer) = requested_composer.clone() {
                validate_thread_provider_lock(context.provider, composer.provider)?;
                context.composer = composer;
            }
        }
        if rename.thread_renamed && !rename.environment_renamed {
            emit_workspace_event(
                &state.events,
                WorkspaceEvent {
                    kind: WorkspaceEventKind::ThreadAutoRenamed,
                    project_id: Some(rename.project_id.clone()),
                    environment_id: Some(rename.environment_id.clone()),
                    thread_id: Some(rename.thread_id.clone()),
                },
            );
        }
    }

    let had_pending_handoff = context.handoff.as_ref().is_some_and(|handoff| {
        matches!(
            handoff.bootstrap_status,
            ThreadHandoffBootstrapStatus::Pending
        )
    });
    if had_pending_handoff {
        context.handoff_bootstrap_context = context
            .handoff
            .as_ref()
            .map(build_handoff_bootstrap_context);
    }

    let result = state
        .runtime
        .send_thread_message(
            context,
            message_text.clone(),
            input.images.unwrap_or_default(),
            input.mention_bindings.unwrap_or_default(),
        )
        .await?;

    if should_auto_rename
        && !rename_result
            .as_ref()
            .is_some_and(|rename| rename.thread_renamed)
        && state
            .workspace
            .auto_rename_thread_from_message(&input.thread_id, &message_text)?
            .is_some()
    {
        emit_workspace_event(
            &state.events,
            WorkspaceEvent {
                kind: WorkspaceEventKind::ThreadAutoRenamed,
                project_id: None,
                environment_id: Some(result.snapshot.environment_id.clone()),
                thread_id: Some(input.thread_id.clone()),
            },
        );
    }
    persist_successful_thread_update(
        state,
        &input.thread_id,
        &result.snapshot,
        result.new_provider_thread_id.as_deref(),
        result.new_codex_thread_id.as_deref(),
        "send",
    )?;

    if had_pending_handoff && should_complete_handoff_bootstrap(&result.snapshot) {
        state
            .workspace
            .complete_thread_handoff_bootstrap(&input.thread_id)?;
    }

    Ok(result.snapshot)
}

fn should_complete_handoff_bootstrap(snapshot: &ThreadConversationSnapshot) -> bool {
    handoff_bootstrap_status_is_complete(snapshot.status)
}

fn handoff_bootstrap_status_is_complete(status: ConversationStatus) -> bool {
    !matches!(
        status,
        ConversationStatus::Interrupted | ConversationStatus::Failed
    )
}

pub async fn create_thread_handoff_impl(
    state: &AppState,
    input: CreateThreadHandoffRequest,
) -> Result<crate::domain::workspace::ThreadRecord, CommandError> {
    let source_context = state
        .workspace
        .thread_runtime_context(&input.source_thread_id)?;
    let source = state.runtime.open_thread(source_context).await?;
    Ok(state
        .workspace
        .create_thread_handoff(input, &source.snapshot)?)
}

pub async fn interrupt_thread_turn_impl(
    state: &AppState,
    thread_id: String,
) -> Result<ThreadConversationSnapshot, CommandError> {
    let context = state.workspace.thread_runtime_context(&thread_id)?;
    Ok(state.runtime.interrupt_thread(context).await?)
}

pub async fn respond_to_approval_request_impl(
    state: &AppState,
    input: RespondToApprovalRequestInput,
) -> Result<ThreadConversationSnapshot, CommandError> {
    let context = state.workspace.thread_runtime_context(&input.thread_id)?;
    Ok(state
        .runtime
        .respond_to_approval_request(context, &input.interaction_id, input.response)
        .await?)
}

pub async fn respond_to_user_input_request_impl(
    state: &AppState,
    input: RespondToUserInputRequestInput,
) -> Result<ThreadConversationSnapshot, CommandError> {
    let context = state.workspace.thread_runtime_context(&input.thread_id)?;
    Ok(state
        .runtime
        .respond_to_user_input_request(context, input)
        .await?)
}

pub async fn submit_plan_decision_impl(
    state: &AppState,
    input: SubmitPlanDecisionInput,
) -> Result<ThreadConversationSnapshot, CommandError> {
    let mut context = state.workspace.thread_runtime_context(&input.thread_id)?;
    if let Some(composer) = input.composer.clone() {
        validate_thread_provider_lock(context.provider, composer.provider)?;
        context.composer = composer;
    }

    let result = state.runtime.submit_plan_decision(context, input).await?;

    persist_successful_thread_update(
        state,
        &result.snapshot.thread_id,
        &result.snapshot,
        result.new_provider_thread_id.as_deref(),
        result.new_codex_thread_id.as_deref(),
        "plan decision",
    )?;

    Ok(result.snapshot)
}

fn validate_thread_provider_lock(
    thread_provider: ProviderKind,
    requested_provider: ProviderKind,
) -> Result<(), CommandError> {
    if thread_provider == requested_provider {
        return Ok(());
    }

    Err(CommandError::from(AppError::Validation(
        "Cannot change provider for an existing thread. Use handoff instead.".to_string(),
    )))
}

fn persist_successful_thread_update(
    state: &AppState,
    thread_id_for_codex_persist: &str,
    snapshot: &ThreadConversationSnapshot,
    new_provider_thread_id: Option<&str>,
    new_codex_thread_id: Option<&str>,
    action_label: &str,
) -> Result<(), CommandError> {
    if let Some(provider_thread_id) = new_provider_thread_id {
        state.workspace.persist_provider_thread_id(
            thread_id_for_codex_persist,
            snapshot.provider,
            provider_thread_id,
        )?;
    } else if matches!(snapshot.provider, ProviderKind::Codex) {
        // Older Codex-only call paths still return the explicit Codex id. Keep the
        // persistence fallback during the provider migration.
        if let Some(codex_thread_id) = new_codex_thread_id {
            state
                .workspace
                .persist_codex_thread_id(thread_id_for_codex_persist, codex_thread_id)?;
        }
    }
    state
        .workspace
        .persist_thread_composer_settings(&snapshot.thread_id, &snapshot.composer)?;
    if let Err(error) = state
        .workspace
        .clear_thread_composer_draft(&snapshot.thread_id)
    {
        warn!(
            thread_id = %snapshot.thread_id,
            "failed to clear persisted thread composer draft after successful {action_label}: {error}"
        );
    }

    Ok(())
}

fn validate_non_blank_thread_id(thread_id: &str) -> Result<(), CommandError> {
    if thread_id.trim().is_empty() {
        return Err(AppError::Validation("Thread id cannot be empty.".to_string()).into());
    }

    Ok(())
}

fn build_handoff_bootstrap_context(handoff: &ThreadHandoffState) -> String {
    let mut block = String::from("<handoff_context>\n");
    block.push_str(&format!(
        "source_provider: {}\n",
        provider_label(handoff.source_provider)
    ));
    block.push_str(&format!("source_thread_id: {}\n", handoff.source_thread_id));
    if let Some(title) = handoff.source_thread_title.as_deref() {
        block.push_str(&format!(
            "source_thread_title: {}\n",
            sanitize_handoff_text(title)
        ));
    }
    if let Some(environment_name) = handoff.environment_name.as_deref() {
        block.push_str(&format!(
            "environment: {}\n",
            sanitize_handoff_text(environment_name)
        ));
    }
    if let Some(branch_name) = handoff.branch_name.as_deref() {
        block.push_str(&format!("branch: {}\n", sanitize_handoff_text(branch_name)));
    }
    if let Some(worktree_path) = handoff.worktree_path.as_deref() {
        block.push_str(&format!(
            "worktree_path: {}\n",
            sanitize_handoff_text(worktree_path)
        ));
    }

    let detailed_count = 6usize;
    let split_at = handoff
        .imported_messages
        .len()
        .saturating_sub(detailed_count);
    let (older, recent) = handoff.imported_messages.split_at(split_at);
    if !older.is_empty() {
        block.push_str("\nolder_messages_summary:\n");
        for message in older {
            block.push_str("- ");
            block.push_str(provider_role_label(message.role));
            block.push_str(": ");
            block.push_str(&summarize_handoff_message(message));
            block.push('\n');
        }
    }
    if !recent.is_empty() {
        block.push_str("\nrecent_messages:\n");
        for message in recent {
            block.push_str(provider_role_label(message.role));
            block.push_str(":\n");
            block.push_str(&sanitize_handoff_message(message));
            block.push_str("\n\n");
        }
    }
    block.push_str("</handoff_context>");
    block
}

fn provider_label(provider: ProviderKind) -> &'static str {
    match provider {
        ProviderKind::Codex => "OpenAI",
        ProviderKind::Claude => "Anthropic",
    }
}

fn provider_role_label(role: crate::domain::conversation::ConversationRole) -> &'static str {
    match role {
        crate::domain::conversation::ConversationRole::User => "user",
        crate::domain::conversation::ConversationRole::Assistant => "assistant",
    }
}

fn sanitize_handoff_text(value: &str) -> String {
    value.replace("</handoff_context>", "<\\/handoff_context>")
}

fn summarize_handoff_text(value: &str) -> String {
    let sanitized = sanitize_handoff_text(value);
    let compact = sanitized.split_whitespace().collect::<Vec<_>>().join(" ");
    const LIMIT: usize = 180;
    if compact.chars().count() <= LIMIT {
        return compact;
    }
    let mut summary = compact.chars().take(LIMIT).collect::<String>();
    summary.push_str("...");
    summary
}

fn sanitize_handoff_message(message: &ThreadHandoffImportedMessage) -> String {
    if !message.text.trim().is_empty() {
        return sanitize_handoff_text(&message.text);
    }
    if message
        .images
        .as_ref()
        .is_some_and(|images| !images.is_empty())
    {
        return "[image attachment]".to_string();
    }
    String::new()
}

fn summarize_handoff_message(message: &ThreadHandoffImportedMessage) -> String {
    if !message.text.trim().is_empty() {
        return summarize_handoff_text(&message.text);
    }
    sanitize_handoff_message(message)
}

fn validate_thread_composer_draft(
    draft: Option<&ConversationComposerDraft>,
) -> Result<(), CommandError> {
    let Some(draft) = draft else {
        return Ok(());
    };

    for attachment in &draft.images {
        match attachment {
            ConversationImageAttachment::Image { url } if url.trim().is_empty() => {
                return Err(
                    AppError::Validation("Draft image URL cannot be empty.".to_string()).into(),
                );
            }
            ConversationImageAttachment::LocalImage { path } if path.trim().is_empty() => {
                return Err(
                    AppError::Validation("Draft image path cannot be empty.".to_string()).into(),
                );
            }
            _ => {}
        }
    }

    for binding in &draft.mention_bindings {
        if binding.mention.trim().is_empty() {
            return Err(
                AppError::Validation("Draft mention name cannot be empty.".to_string()).into(),
            );
        }
        if binding.path.trim().is_empty() {
            return Err(
                AppError::Validation("Draft mention path cannot be empty.".to_string()).into(),
            );
        }
        if binding.start >= binding.end {
            return Err(AppError::Validation(
                "Draft mention binding ranges must have start before end.".to_string(),
            )
            .into());
        }
    }

    Ok(())
}

fn validate_composer_target(target: &ComposerTarget) -> Result<(), CommandError> {
    match target {
        ComposerTarget::Thread { thread_id } => {
            if thread_id.trim().is_empty() {
                return Err(AppError::Validation("Thread id cannot be empty.".to_string()).into());
            }
        }
        ComposerTarget::Environment { environment_id, .. } => {
            if environment_id.trim().is_empty() {
                return Err(
                    AppError::Validation("Environment id cannot be empty.".to_string()).into(),
                );
            }
        }
        ComposerTarget::ChatWorkspace {} => {}
    }

    Ok(())
}

fn validate_non_blank_request_key(request_key: &str) -> Result<(), CommandError> {
    if request_key.trim().is_empty() {
        return Err(AppError::Validation("Request key cannot be empty.".to_string()).into());
    }

    Ok(())
}

fn emit_workspace_event(events: &EventSink, payload: WorkspaceEvent) {
    events.emit(WORKSPACE_EVENT_NAME, payload);
}

fn emit_first_prompt_rename_failure_event(
    events: &EventSink,
    workspace: &WorkspaceService,
    thread_id: &str,
    message: String,
) {
    match workspace.first_prompt_rename_failure_event(thread_id, message) {
        Ok(payload) => {
            events.emit(FIRST_PROMPT_RENAME_FAILURE_EVENT_NAME, payload);
        }
        Err(error) => {
            warn!(
                thread_id,
                "failed to build first prompt rename failure event: {error}"
            );
        }
    }
}

async fn spawn_blocking<T, F>(operation: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, crate::error::AppError> + Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|error| CommandError::from(crate::error::AppError::Runtime(error.to_string())))?
        .map_err(CommandError::from)
}

#[cfg(test)]
mod tests {
    use super::{
        handoff_bootstrap_status_is_complete, validate_composer_target,
        validate_non_blank_request_key, validate_non_blank_thread_id,
        validate_thread_composer_draft,
    };
    use crate::domain::conversation::{
        ComposerDraftMentionBinding, ComposerMentionBindingKind, ComposerTarget,
        ConversationComposerDraft, ConversationImageAttachment, ConversationStatus,
    };

    #[test]
    fn save_thread_composer_draft_rejects_blank_thread_ids() {
        let error = validate_non_blank_thread_id("   ").expect_err("blank thread id should fail");

        assert_eq!(error.code, "validation_error");
        assert!(error.message.contains("Thread id cannot be empty"));
    }

    #[test]
    fn save_thread_composer_draft_rejects_invalid_payloads() {
        let error = validate_thread_composer_draft(Some(&ConversationComposerDraft {
            text: "Review this".to_string(),
            images: vec![ConversationImageAttachment::LocalImage {
                path: "/tmp/screenshot.png".to_string(),
            }],
            mention_bindings: vec![ComposerDraftMentionBinding {
                mention: "github".to_string(),
                kind: ComposerMentionBindingKind::App,
                path: "app://github".to_string(),
                start: 8,
                end: 8,
            }],
            is_refining_plan: false,
        }))
        .expect_err("invalid draft should fail");

        assert_eq!(error.code, "validation_error");
        assert!(error.message.contains("start before end"));
    }

    #[test]
    fn composer_target_rejects_blank_environment_ids() {
        let error = validate_composer_target(&ComposerTarget::Environment {
            environment_id: "   ".to_string(),
            provider: None,
        })
        .expect_err("blank environment id should fail");

        assert_eq!(error.code, "validation_error");
        assert!(error.message.contains("Environment id cannot be empty"));
    }

    #[test]
    fn request_key_rejects_blank_values() {
        let error =
            validate_non_blank_request_key("   ").expect_err("blank request key should fail");

        assert_eq!(error.code, "validation_error");
        assert!(error.message.contains("Request key cannot be empty"));
    }

    #[test]
    fn interrupted_handoff_bootstrap_stays_pending_for_retry() {
        assert!(!handoff_bootstrap_status_is_complete(
            ConversationStatus::Interrupted
        ));
        assert!(!handoff_bootstrap_status_is_complete(
            ConversationStatus::Failed
        ));
        assert!(handoff_bootstrap_status_is_complete(
            ConversationStatus::Completed
        ));
        assert!(handoff_bootstrap_status_is_complete(
            ConversationStatus::WaitingForExternalAction
        ));
    }
}
