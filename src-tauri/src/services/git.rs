mod actions;
mod diff;
mod status;

use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};

use crate::domain::git_review::{
    GitChangeSection, GitFileDiff, GitReviewScope, GitReviewSnapshot,
};
use crate::error::{AppError, AppResult};

pub use actions::{
    commit, fetch, generate_commit_message, pull, push, revert_all, revert_file, stage_all,
    stage_file, unstage_all, unstage_file,
};

#[derive(Debug, Clone)]
pub struct RepoContext {
    pub root_path: PathBuf,
    pub current_branch: Option<String>,
}

#[derive(Debug, Clone)]
pub struct GitEnvironmentContext {
    pub environment_id: String,
    pub environment_path: String,
    pub current_branch: Option<String>,
    pub base_branch: Option<String>,
    pub codex_binary_path: Option<String>,
    pub default_model: String,
}

pub fn resolve_repo_context(path: &str) -> AppResult<RepoContext> {
    let root_path = run_git_for_output(path, ["rev-parse", "--show-toplevel"])?;
    let current_branch = run_git_for_output(&root_path, ["branch", "--show-current"]).ok();

    Ok(RepoContext {
        root_path: PathBuf::from(root_path),
        current_branch,
    })
}

pub fn current_branch(path: &Path) -> AppResult<Option<String>> {
    Ok(run_git_for_output(path, ["branch", "--show-current"]).ok())
}

pub fn create_worktree(
    repo_root: &Path,
    destination: &Path,
    branch_name: &str,
    base_branch: &str,
) -> AppResult<()> {
    if destination.exists() {
        return Err(AppError::Validation(format!(
            "The worktree path '{}' already exists.",
            destination.display()
        )));
    }

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }

    run_git(
        repo_root,
        [
            "worktree",
            "add",
            "-b",
            branch_name,
            &destination.to_string_lossy(),
            base_branch,
        ],
    )
}

pub fn ensure_branch_name(name: &str) -> AppResult<String> {
    let slug = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|character| match character {
            'a'..='z' | '0'..='9' => character,
            '/' | '-' => character,
            _ => '-',
        })
        .collect::<String>()
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if slug.is_empty() {
        return Err(AppError::Validation(
            "The worktree or branch name cannot be empty.".to_string(),
        ));
    }

    Ok(slug)
}

pub fn managed_worktree_path(repo_root: &Path, branch_name: &str) -> PathBuf {
    let project_name = repo_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("project");
    let parent = repo_root.parent().unwrap_or(repo_root);

    parent
        .join(".threadex-worktrees")
        .join(project_name)
        .join(branch_name)
}

pub fn git_review_snapshot(
    context: &GitEnvironmentContext,
    scope: GitReviewScope,
) -> AppResult<GitReviewSnapshot> {
    status::read_review_snapshot(context, scope)
}

pub fn git_file_diff(
    context: &GitEnvironmentContext,
    scope: GitReviewScope,
    section: GitChangeSection,
    path: &str,
) -> AppResult<GitFileDiff> {
    diff::read_file_diff(context, scope, section, path)
}

pub(crate) fn validate_relative_path(path: &str) -> AppResult<()> {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err(AppError::Validation(
            "Expected a repository-relative path.".to_string(),
        ));
    }

    if candidate.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(AppError::Validation(
            "Path traversal is not allowed for Git actions.".to_string(),
        ));
    }

    Ok(())
}

pub(crate) fn resolve_base_reference(
    repo_root: &Path,
    preferred: Option<&str>,
) -> Option<String> {
    if let Some(preferred) = preferred.filter(|value| !value.trim().is_empty()) {
        return Some(preferred.to_string());
    }

    if let Ok(upstream) = upstream_branch(repo_root) {
        return Some(upstream);
    }

    if let Ok(origin_head) = run_git_for_output(repo_root, ["symbolic-ref", "refs/remotes/origin/HEAD"]) {
        return Some(
            origin_head
                .trim_start_matches("refs/remotes/")
                .to_string(),
        );
    }

    ["origin/main", "origin/master", "main", "master"]
        .into_iter()
        .find(|candidate| reference_exists(repo_root, candidate))
        .map(ToString::to_string)
}

pub(crate) fn upstream_branch(repo_root: &Path) -> AppResult<String> {
    run_git_for_output(
        repo_root,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    )
}

pub(crate) fn reference_exists(repo_root: &Path, reference: &str) -> bool {
    run_git(repo_root, ["rev-parse", "--verify", "--quiet", reference]).is_ok()
}

pub(crate) fn run_git<P, I, A>(path: P, args: I) -> AppResult<()>
where
    P: AsRef<Path>,
    I: IntoIterator<Item = A>,
    A: AsRef<str>,
{
    let output = command_output(path, args)?;

    if output.status.success() {
        return Ok(());
    }

    Err(AppError::Git(stderr_message(&output.stderr)))
}

pub(crate) fn run_git_for_output<P, I, A>(path: P, args: I) -> AppResult<String>
where
    P: AsRef<Path>,
    I: IntoIterator<Item = A>,
    A: AsRef<str>,
{
    let output = command_output(path, args)?;

    if output.status.success() {
        let value = stdout_message(&output.stdout);
        if value.is_empty() {
            return Err(AppError::Git("Git returned an empty response.".to_string()));
        }
        return Ok(value);
    }

    Err(AppError::Git(stderr_message(&output.stderr)))
}

pub(crate) fn command_output<P, I, A>(path: P, args: I) -> AppResult<Output>
where
    P: AsRef<Path>,
    I: IntoIterator<Item = A>,
    A: AsRef<str>,
{
    let mut command = Command::new("git");
    command.current_dir(path.as_ref());

    for argument in args {
        command.arg(argument.as_ref());
    }

    command.output().map_err(AppError::from)
}

pub(crate) fn stdout_message(buffer: &[u8]) -> String {
    String::from_utf8_lossy(buffer).trim().to_string()
}

pub(crate) fn stderr_message(buffer: &[u8]) -> String {
    let message = String::from_utf8_lossy(buffer).trim().to_string();
    if message.is_empty() {
        "Git command failed.".to_string()
    } else {
        message
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{ensure_branch_name, managed_worktree_path, validate_relative_path};

    #[test]
    fn branch_name_is_sanitized_into_a_git_safe_slug() {
        let slug = ensure_branch_name(" Feature: Plan Mode UI! ").expect("slug should be created");
        assert_eq!(slug, "feature-plan-mode-ui");
    }

    #[test]
    fn branch_name_rejects_empty_values() {
        let error = ensure_branch_name("   ").expect_err("empty name should fail");
        assert!(error.to_string().contains("cannot be empty"));
    }

    #[test]
    fn managed_worktree_path_is_nested_under_threadex_directory() {
        let path = managed_worktree_path(Path::new("/tmp/acme/repo"), "feature-plan-mode");
        assert_eq!(
            path,
            Path::new("/tmp/acme/.threadex-worktrees/repo/feature-plan-mode")
        );
    }

    #[test]
    fn git_actions_reject_parent_path_segments() {
        let error = validate_relative_path("../secrets.txt").expect_err("path should be rejected");
        assert!(error.to_string().contains("Path traversal"));
    }
}
