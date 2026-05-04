use std::collections::VecDeque;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::domain::conversation::ComposerFileSearchResult;
use crate::error::{AppError, AppResult};
use crate::services::git::{command_output, stderr_message};

const FILE_SEARCH_MAX_INDEX_ENTRIES: usize = 25_000;
const FILE_SEARCH_IGNORED_DIRECTORIES: &[&str] = &[
    ".git",
    ".next",
    ".turbo",
    ".cache",
    "build",
    "dist",
    "node_modules",
    "out",
    "target",
];

pub fn search_workspace_files(
    environment_path: &str,
    query: &str,
    limit: usize,
) -> AppResult<Vec<ComposerFileSearchResult>> {
    let root = Path::new(environment_path);
    if !root.is_dir() {
        return Err(AppError::Validation(
            "File search target must be an existing directory.".to_string(),
        ));
    }

    let mut paths = match list_git_workspace_files(root) {
        Ok(paths) => paths,
        Err(_) => list_filesystem_workspace_files(root)?,
    };
    paths.sort();
    paths.dedup();

    let normalized_query = normalize_file_search_query(query);
    let mut ranked = paths
        .into_iter()
        .filter_map(|path| score_file_path(&path, &normalized_query).map(|score| (score, path)))
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));

    Ok(trim_file_search_results(
        ranked.into_iter().map(|(_, path)| path).collect(),
        limit,
    ))
}

fn trim_file_search_results(paths: Vec<String>, limit: usize) -> Vec<ComposerFileSearchResult> {
    paths
        .into_iter()
        .take(limit)
        .map(|path| ComposerFileSearchResult { path })
        .collect()
}

fn list_git_workspace_files(root: &Path) -> AppResult<Vec<String>> {
    let output = command_output(
        root,
        [
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
    )?;
    if !output.status.success() {
        return Err(AppError::Git(stderr_message(&output.stderr)));
    }

    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|token| !token.is_empty())
        .filter_map(|token| String::from_utf8(token.to_vec()).ok())
        .filter_map(|path| normalize_relative_file_path(&path))
        .take(FILE_SEARCH_MAX_INDEX_ENTRIES)
        .collect())
}

fn list_filesystem_workspace_files(root: &Path) -> AppResult<Vec<String>> {
    let mut pending = VecDeque::from([PathBuf::new()]);
    let mut paths = Vec::new();

    while let Some(relative_dir) = pending.pop_front() {
        let absolute_dir = root.join(&relative_dir);
        let entries = match fs::read_dir(&absolute_dir) {
            Ok(entries) => entries,
            Err(error) if !relative_dir.as_os_str().is_empty() => {
                tracing::debug!(
                    path = %absolute_dir.display(),
                    "skipping unreadable file-search directory: {error}"
                );
                continue;
            }
            Err(error) => return Err(error.into()),
        };

        for entry in entries {
            let entry = entry?;
            let file_type = entry.file_type()?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.is_empty() || name == "." || name == ".." {
                continue;
            }

            let relative_path = relative_dir.join(name.as_ref());
            if file_type.is_dir() {
                if FILE_SEARCH_IGNORED_DIRECTORIES
                    .iter()
                    .any(|ignored| *ignored == name)
                {
                    continue;
                }
                pending.push_back(relative_path);
            } else if file_type.is_file() {
                if let Some(path) = normalize_relative_file_path(&relative_path.to_string_lossy()) {
                    paths.push(path);
                    if paths.len() >= FILE_SEARCH_MAX_INDEX_ENTRIES {
                        return Ok(paths);
                    }
                }
            }
        }
    }

    Ok(paths)
}

fn normalize_relative_file_path(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    if normalized.trim().is_empty() || normalized.starts_with('/') {
        return None;
    }
    let candidate = Path::new(&normalized);
    if candidate
        .components()
        .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
    {
        return None;
    }
    let trimmed = normalized.trim_start_matches("./").to_string();
    (!trimmed.is_empty()).then_some(trimmed)
}

fn normalize_file_search_query(query: &str) -> String {
    query
        .trim()
        .trim_start_matches(['@', '.', '/'])
        .to_ascii_lowercase()
}

fn score_file_path(path: &str, query: &str) -> Option<usize> {
    if query.is_empty() {
        return Some(path.matches('/').count() * 4 + path.len().min(240));
    }

    let normalized_path = path.to_ascii_lowercase();
    let file_name = normalized_path
        .rsplit_once('/')
        .map(|(_, name)| name)
        .unwrap_or(normalized_path.as_str());

    if file_name == query {
        return Some(0);
    }
    if file_name.starts_with(query) {
        return Some(10 + file_name.len().saturating_sub(query.len()));
    }
    if normalized_path.starts_with(query) {
        return Some(30 + normalized_path.len().saturating_sub(query.len()));
    }
    if file_name.contains(query) {
        return Some(50 + file_name.find(query).unwrap_or_default());
    }
    if normalized_path.contains(query) {
        return Some(70 + normalized_path.find(query).unwrap_or_default());
    }

    fuzzy_match_score(&normalized_path, query).map(|score| 100 + score)
}

fn fuzzy_match_score(value: &str, query: &str) -> Option<usize> {
    let mut score = 0usize;
    let mut search_start = 0usize;

    for character in query.chars() {
        let remainder = value.get(search_start..)?;
        let offset = remainder.find(character)?;
        score += offset;
        search_start += offset + character.len_utf8();
    }

    Some(score + value.len().saturating_sub(query.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn returns_project_files_for_empty_query() {
        let workspace = temp_workspace("empty-query");
        fs::create_dir_all(workspace.path.join("src")).expect("src dir");
        fs::write(workspace.path.join("src").join("App.tsx"), "export {}").expect("app file");
        fs::write(workspace.path.join("README.md"), "# Test").expect("readme file");

        let results = search_workspace_files(workspace.path.to_str().unwrap(), "", 10)
            .expect("empty query should return files");
        let paths = results
            .into_iter()
            .map(|result| result.path)
            .collect::<Vec<_>>();

        assert!(paths.contains(&"README.md".to_string()));
        assert!(paths.contains(&"src/App.tsx".to_string()));
    }

    #[test]
    fn ranks_matching_file_names() {
        let workspace = temp_workspace("ranked-query");
        fs::create_dir_all(workspace.path.join("src")).expect("src dir");
        fs::write(workspace.path.join("src").join("App.tsx"), "export {}").expect("app file");
        fs::write(workspace.path.join("src").join("Other.ts"), "export {}").expect("other file");

        let results = search_workspace_files(workspace.path.to_str().unwrap(), "app", 10)
            .expect("query should return matching files");

        assert_eq!(
            results.first().map(|result| result.path.as_str()),
            Some("src/App.tsx")
        );
    }

    struct TempWorkspace {
        path: PathBuf,
    }

    impl Drop for TempWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn temp_workspace(label: &str) -> TempWorkspace {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "skein-composer-{label}-{}-{now}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("temp workspace");
        TempWorkspace { path }
    }
}
