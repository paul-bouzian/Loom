use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::Deserialize;
use tokio::process::Command;
use tokio::time::timeout;

use crate::domain::settings::ProviderKind;
use crate::domain::workspace::{
    ProviderRateLimitSnapshot, ProviderRateLimitStatus, ProviderRateLimitWindow,
};
use crate::error::{AppError, AppResult};

const CLAUDE_OAUTH_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA_HEADER: &str = "oauth-2025-04-20";
const CLAUDE_USAGE_TIMEOUT: Duration = Duration::from_secs(10);
const CLAUDE_KEYCHAIN_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone)]
pub struct ProviderUsageService {
    client: Client,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeCredentials {
    claude_ai_oauth: Option<ClaudeOAuthCredentials>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeOAuthCredentials {
    access_token: Option<String>,
    expires_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ClaudeUsageResponse {
    five_hour: Option<ClaudeUsageWindow>,
    seven_day: Option<ClaudeUsageWindow>,
}

#[derive(Debug, Deserialize)]
struct ClaudeUsageWindow {
    utilization: Option<f64>,
    resets_at: Option<String>,
}

impl ProviderUsageService {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .connect_timeout(CLAUDE_USAGE_TIMEOUT)
                .timeout(CLAUDE_USAGE_TIMEOUT)
                .build()
                .expect("provider usage HTTP client should build"),
        }
    }

    pub async fn read_claude_rate_limits(&self) -> AppResult<ProviderRateLimitSnapshot> {
        let Some(token) = read_claude_oauth_token().await? else {
            return Ok(claude_snapshot(
                ProviderRateLimitStatus::Unavailable,
                None,
                None,
                Some("Claude subscription usage is unavailable for API-key billing.".to_string()),
            ));
        };

        match self.fetch_claude_oauth_usage(&token).await {
            Ok(snapshot) => Ok(snapshot),
            Err(error) => Ok(claude_snapshot(
                ProviderRateLimitStatus::Error,
                None,
                None,
                Some(error.to_string()),
            )),
        }
    }

    async fn fetch_claude_oauth_usage(&self, token: &str) -> AppResult<ProviderRateLimitSnapshot> {
        let response = self
            .client
            .get(CLAUDE_OAUTH_USAGE_URL)
            .bearer_auth(token)
            .header("anthropic-beta", CLAUDE_OAUTH_BETA_HEADER)
            .send()
            .await
            .map_err(|error| AppError::Runtime(format!("Failed to read Claude usage: {error}")))?;

        if !response.status().is_success() {
            return Err(AppError::Runtime(format!(
                "Claude usage endpoint returned {}.",
                response.status()
            )));
        }

        let usage = response
            .json::<ClaudeUsageResponse>()
            .await
            .map_err(|error| {
                AppError::Runtime(format!("Failed to decode Claude usage response: {error}"))
            })?;

        Ok(claude_snapshot(
            ProviderRateLimitStatus::Ok,
            map_claude_usage_window(usage.five_hour, 300),
            map_claude_usage_window(usage.seven_day, 10_080),
            None,
        ))
    }
}

async fn read_claude_oauth_token() -> AppResult<Option<String>> {
    if let Some(token) = read_claude_keychain_token().await? {
        return Ok(Some(token));
    }
    read_claude_credentials_file_token()
}

async fn read_claude_keychain_token() -> AppResult<Option<String>> {
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }

    let Some(user) = std::env::var("USER")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    let output = timeout(
        CLAUDE_KEYCHAIN_TIMEOUT,
        Command::new("security")
            .args([
                "find-generic-password",
                "-s",
                "Claude Code-credentials",
                "-a",
                &user,
                "-w",
            ])
            .output(),
    )
    .await;

    let output = match output {
        Ok(Ok(output)) if output.status.success() => output,
        _ => return Ok(None),
    };
    let raw = String::from_utf8_lossy(&output.stdout);
    parse_claude_oauth_token(raw.trim())
}

fn read_claude_credentials_file_token() -> AppResult<Option<String>> {
    let Some(path) = claude_credentials_file_path() else {
        return Ok(None);
    };

    match fs::read_to_string(path) {
        Ok(raw) => parse_claude_oauth_token(&raw),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(AppError::Io(error)),
    }
}

fn claude_credentials_file_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join(".claude")
            .join(".credentials.json"),
    )
}

fn parse_claude_oauth_token(raw: &str) -> AppResult<Option<String>> {
    let credentials = serde_json::from_str::<ClaudeCredentials>(raw).map_err(|error| {
        AppError::Runtime(format!("Failed to decode Claude credentials: {error}"))
    })?;
    let Some(oauth) = credentials.claude_ai_oauth else {
        return Ok(None);
    };
    if oauth
        .expires_at
        .is_some_and(|expires_at| expires_at < now_millis())
    {
        return Ok(None);
    }
    Ok(oauth
        .access_token
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty()))
}

fn map_claude_usage_window(
    window: Option<ClaudeUsageWindow>,
    window_duration_mins: i64,
) -> Option<ProviderRateLimitWindow> {
    let window = window?;
    let utilization = window.utilization?;
    Some(ProviderRateLimitWindow {
        resets_at: parse_reset_millis(window.resets_at.as_deref()),
        used_percent: utilization.round().clamp(0.0, 100.0) as i32,
        window_duration_mins: Some(window_duration_mins),
    })
}

fn parse_reset_millis(value: Option<&str>) -> Option<i64> {
    let value = value?;
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.timestamp_millis())
}

fn claude_snapshot(
    status: ProviderRateLimitStatus,
    primary: Option<ProviderRateLimitWindow>,
    secondary: Option<ProviderRateLimitWindow>,
    error: Option<String>,
) -> ProviderRateLimitSnapshot {
    ProviderRateLimitSnapshot {
        provider: ProviderKind::Claude,
        primary,
        secondary,
        updated_at: now_millis(),
        error,
        status,
    }
}

fn now_millis() -> i64 {
    Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_claude_oauth_credentials() {
        let token = parse_claude_oauth_token(
            r#"{"claudeAiOauth":{"accessToken":" token-123 ","expiresAt":4102444800000}}"#,
        )
        .expect("valid credentials should parse");

        assert_eq!(token.as_deref(), Some("token-123"));
    }

    #[test]
    fn ignores_expired_claude_oauth_credentials() {
        let token = parse_claude_oauth_token(
            r#"{"claudeAiOauth":{"accessToken":"token-123","expiresAt":1}}"#,
        )
        .expect("expired credentials should parse");

        assert_eq!(token, None);
    }

    #[test]
    fn maps_claude_usage_windows_to_provider_limits() {
        let window = map_claude_usage_window(
            Some(ClaudeUsageWindow {
                utilization: Some(47.6),
                resets_at: Some("2026-04-24T15:00:00Z".to_string()),
            }),
            300,
        )
        .expect("usage window");

        assert_eq!(window.used_percent, 48);
        assert_eq!(window.window_duration_mins, Some(300));
        assert!(window.resets_at.unwrap_or_default() > 1_000_000_000_000);
    }
}
