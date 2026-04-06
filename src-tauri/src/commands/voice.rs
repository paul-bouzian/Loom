use tauri::State;

use crate::domain::voice::{
    EnvironmentVoiceStatusSnapshot, TranscribeEnvironmentVoiceInput, VoiceTranscriptionResult,
};
use crate::error::CommandError;
use crate::state::AppState;

#[tauri::command]
pub async fn get_environment_voice_status(
    environment_id: String,
    state: State<'_, AppState>,
) -> Result<EnvironmentVoiceStatusSnapshot, CommandError> {
    Ok(state
        .voice
        .get_environment_voice_status(&state.workspace, &state.runtime, &environment_id)
        .await?)
}

#[tauri::command]
pub async fn transcribe_environment_voice(
    input: TranscribeEnvironmentVoiceInput,
    state: State<'_, AppState>,
) -> Result<VoiceTranscriptionResult, CommandError> {
    Ok(state
        .voice
        .transcribe_environment_voice(&state.workspace, &state.runtime, input)
        .await?)
}
