use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::domain::settings::{OpenTarget, OpenTargetKind};
use crate::error::{AppError, AppResult};

pub fn open_environment(path: &Path, target: &OpenTarget) -> AppResult<()> {
    if !path.exists() {
        return Err(AppError::NotFound(format!(
            "Environment path does not exist: {}",
            path.display()
        )));
    }
    if !path.is_dir() {
        return Err(AppError::Validation(format!(
            "Environment path is not a directory: {}",
            path.display()
        )));
    }

    let spec = build_launch_spec(path, target)?;
    run_launch(spec)
}

pub fn open_environment_file(
    environment_path: &Path,
    file_path: &str,
    line: Option<u32>,
    column: Option<u32>,
    target: &OpenTarget,
) -> AppResult<()> {
    let path = resolve_environment_file_path(environment_path, file_path)?;
    let spec = build_file_launch_spec(&path, OpenFileLocation { line, column }, target)?;
    run_launch(spec)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OpenFileLocation {
    line: Option<u32>,
    column: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LaunchSpec {
    program: String,
    args: Vec<OsString>,
}

fn build_launch_spec(path: &Path, target: &OpenTarget) -> AppResult<LaunchSpec> {
    let path_arg = path.as_os_str().to_os_string();
    build_open_target_launch_spec(path_arg, target, build_file_manager_launch_spec)
}

fn build_file_launch_spec(
    path: &Path,
    location: OpenFileLocation,
    target: &OpenTarget,
) -> AppResult<LaunchSpec> {
    match target.kind {
        OpenTargetKind::FileManager => build_file_manager_file_launch_spec(path),
        OpenTargetKind::App => {
            build_app_file_launch_spec(path.as_os_str().to_os_string(), location, target)
        }
        OpenTargetKind::Command => build_open_target_launch_spec(
            path.as_os_str().to_os_string(),
            target,
            build_file_manager_launch_spec,
        ),
    }
}

fn build_app_file_launch_spec(
    path_arg: OsString,
    _location: OpenFileLocation,
    target: &OpenTarget,
) -> AppResult<LaunchSpec> {
    build_app_launch_spec(path_arg, target)
}

fn build_open_target_launch_spec(
    path_arg: OsString,
    target: &OpenTarget,
    file_manager_launch_spec: impl FnOnce(OsString) -> AppResult<LaunchSpec>,
) -> AppResult<LaunchSpec> {
    match target.kind {
        OpenTargetKind::App => build_app_launch_spec(path_arg, target),
        OpenTargetKind::Command => Err(AppError::Validation(
            "Command-based Open In targets are no longer supported.".to_string(),
        )),
        OpenTargetKind::FileManager => file_manager_launch_spec(path_arg),
    }
}

#[cfg(target_os = "macos")]
fn build_app_launch_spec(path_arg: OsString, target: &OpenTarget) -> AppResult<LaunchSpec> {
    let app_name = target
        .app_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::Validation("App targets require an application name.".to_string())
        })?;
    let args = vec![OsString::from("-a"), OsString::from(app_name), path_arg];
    Ok(LaunchSpec {
        program: "/usr/bin/open".to_string(),
        args,
    })
}

#[cfg(not(target_os = "macos"))]
fn build_app_launch_spec(_path_arg: OsString, _target: &OpenTarget) -> AppResult<LaunchSpec> {
    Err(AppError::Validation(
        "App launch targets are only supported on macOS in this build.".to_string(),
    ))
}

#[cfg(target_os = "macos")]
fn build_file_manager_launch_spec(path_arg: OsString) -> AppResult<LaunchSpec> {
    Ok(LaunchSpec {
        program: "/usr/bin/open".to_string(),
        args: vec![path_arg],
    })
}

#[cfg(target_os = "macos")]
fn build_file_manager_file_launch_spec(path: &Path) -> AppResult<LaunchSpec> {
    Ok(LaunchSpec {
        program: "/usr/bin/open".to_string(),
        args: vec![OsString::from("-R"), path.as_os_str().to_os_string()],
    })
}

#[cfg(target_os = "windows")]
fn build_file_manager_file_launch_spec(path: &Path) -> AppResult<LaunchSpec> {
    let mut select_arg = OsString::from("/select,");
    select_arg.push(path.as_os_str());

    Ok(LaunchSpec {
        program: "explorer".to_string(),
        args: vec![select_arg],
    })
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn build_file_manager_file_launch_spec(path: &Path) -> AppResult<LaunchSpec> {
    let parent = path.parent().ok_or_else(|| {
        AppError::Validation(format!(
            "File has no containing directory: {}",
            path.display()
        ))
    })?;

    Ok(LaunchSpec {
        program: "xdg-open".to_string(),
        args: vec![parent.as_os_str().to_os_string()],
    })
}

fn resolve_environment_file_path(environment_path: &Path, file_path: &str) -> AppResult<PathBuf> {
    resolve_environment_file_path_with_home(environment_path, file_path, current_home_dir)
}

fn resolve_environment_file_path_with_home(
    environment_path: &Path,
    file_path: &str,
    home_dir: impl FnOnce() -> AppResult<PathBuf>,
) -> AppResult<PathBuf> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("File path is required.".to_string()));
    }

    let environment_root = environment_path.canonicalize().map_err(|error| {
        AppError::NotFound(format!(
            "Environment path does not exist: {} ({error})",
            environment_path.display()
        ))
    })?;
    if !environment_root.is_dir() {
        return Err(AppError::Validation(format!(
            "Environment path is not a directory: {}",
            environment_root.display()
        )));
    }

    let candidate = build_file_reference_candidate(&environment_root, trimmed, home_dir)?;
    let resolved = candidate.canonicalize().map_err(|error| {
        AppError::NotFound(format!(
            "File does not exist: {} ({error})",
            candidate.display()
        ))
    })?;

    if !resolved.starts_with(&environment_root) {
        return Err(AppError::Validation(
            "File path must stay inside the selected environment.".to_string(),
        ));
    }

    if !resolved.is_file() {
        return Err(AppError::Validation(format!(
            "Expected a file path: {}",
            resolved.display()
        )));
    }

    Ok(resolved)
}

fn build_file_reference_candidate(
    environment_root: &Path,
    file_path: &str,
    home_dir: impl FnOnce() -> AppResult<PathBuf>,
) -> AppResult<PathBuf> {
    let requested_path = Path::new(file_path);
    if requested_path.is_absolute() {
        return Ok(requested_path.to_path_buf());
    }

    if let Some(suffix) = home_relative_suffix(file_path) {
        return Ok(home_dir()?.join(suffix));
    }

    Ok(environment_root.join(requested_path))
}

fn home_relative_suffix(path: &str) -> Option<&str> {
    if path == "~" {
        return Some("");
    }

    path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\"))
}

fn current_home_dir() -> AppResult<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| {
            AppError::Validation("Home directory is unavailable for file references.".to_string())
        })
}

#[cfg(target_os = "windows")]
fn build_file_manager_launch_spec(path_arg: OsString) -> AppResult<LaunchSpec> {
    Ok(LaunchSpec {
        program: "explorer".to_string(),
        args: vec![path_arg],
    })
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn build_file_manager_launch_spec(path_arg: OsString) -> AppResult<LaunchSpec> {
    Ok(LaunchSpec {
        program: "xdg-open".to_string(),
        args: vec![path_arg],
    })
}

fn run_launch(spec: LaunchSpec) -> AppResult<()> {
    let output = Command::new(&spec.program).args(&spec.args).output()?;
    if output.status.success() {
        return Ok(());
    }

    Err(AppError::Runtime(format_launch_failure(&spec, &output)))
}

fn format_launch_failure(spec: &LaunchSpec, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("exit status {}", output.status)
    };

    format!("Failed to launch {}: {details}", spec.program)
}

#[cfg(test)]
mod tests {
    use super::{
        build_file_launch_spec, build_launch_spec, format_launch_failure,
        resolve_environment_file_path, resolve_environment_file_path_with_home, LaunchSpec,
        OpenFileLocation,
    };
    use crate::domain::settings::{OpenTarget, OpenTargetKind};
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::{ExitStatus, Output};

    #[cfg(unix)]
    use std::os::unix::ffi::OsStringExt;
    #[cfg(unix)]
    use std::os::unix::process::ExitStatusExt;

    #[test]
    fn legacy_command_targets_are_rejected() {
        let target = OpenTarget {
            id: "cursor-cli".to_string(),
            label: "Cursor CLI".to_string(),
            kind: OpenTargetKind::Command,
            app_name: None,
            args: vec!["--reuse-window".to_string()],
        };

        assert_eq!(
            build_launch_spec(Path::new("/tmp/skein"), &target)
                .expect_err("legacy command target should be rejected")
                .to_string(),
            "Command-based Open In targets are no longer supported."
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn app_targets_use_the_open_command_without_extra_args() {
        let target = OpenTarget {
            id: "cursor".to_string(),
            label: "Cursor".to_string(),
            kind: OpenTargetKind::App,
            app_name: Some(" Cursor ".to_string()),
            args: vec!["--reuse-window".to_string()],
        };

        let spec = build_launch_spec(Path::new("/tmp/skein"), &target).expect("launch spec");

        assert_eq!(
            spec,
            LaunchSpec {
                program: "/usr/bin/open".to_string(),
                args: vec![
                    OsString::from("-a"),
                    OsString::from("Cursor"),
                    OsString::from("/tmp/skein"),
                ],
            }
        );
    }

    #[test]
    fn file_manager_targets_use_the_platform_default_launcher() {
        let target = OpenTarget {
            id: "file-manager".to_string(),
            label: "Finder".to_string(),
            kind: OpenTargetKind::FileManager,
            app_name: None,
            args: Vec::new(),
        };

        let spec = build_launch_spec(Path::new("/tmp/skein"), &target).expect("launch spec");

        #[cfg(target_os = "macos")]
        assert_eq!(
            spec,
            LaunchSpec {
                program: "/usr/bin/open".to_string(),
                args: vec![OsString::from("/tmp/skein")],
            }
        );

        #[cfg(target_os = "windows")]
        assert_eq!(
            spec,
            LaunchSpec {
                program: "explorer".to_string(),
                args: vec![OsString::from("/tmp/skein")],
            }
        );

        #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
        assert_eq!(
            spec,
            LaunchSpec {
                program: "xdg-open".to_string(),
                args: vec![OsString::from("/tmp/skein")],
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn file_manager_targets_preserve_non_utf8_environment_paths() {
        let target = OpenTarget {
            id: "file-manager".to_string(),
            label: "Finder".to_string(),
            kind: OpenTargetKind::FileManager,
            app_name: None,
            args: Vec::new(),
        };
        let path = PathBuf::from(OsString::from_vec(vec![
            b'/', b't', b'm', b'p', b'/', b'l', b'o', b'o', b'm', b'-', 0xFE,
        ]));

        let spec = build_launch_spec(&path, &target).expect("launch spec");

        assert_eq!(
            spec.args.last().map(OsString::as_os_str),
            Some(path.as_os_str())
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn app_targets_open_file_paths_with_the_selected_app() {
        let target = OpenTarget {
            id: "cursor".to_string(),
            label: "Cursor".to_string(),
            kind: OpenTargetKind::App,
            app_name: Some("Cursor".to_string()),
            args: Vec::new(),
        };

        let spec = build_file_launch_spec(
            Path::new("/tmp/skein/src/app.ts"),
            OpenFileLocation {
                line: Some(42),
                column: Some(7),
            },
            &target,
        )
        .expect("launch spec");

        assert_eq!(
            spec,
            LaunchSpec {
                program: "/usr/bin/open".to_string(),
                args: vec![
                    OsString::from("-a"),
                    OsString::from("Cursor"),
                    OsString::from("/tmp/skein/src/app.ts"),
                ],
            }
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn file_manager_targets_reveal_file_paths() {
        let target = OpenTarget {
            id: "file-manager".to_string(),
            label: "Finder".to_string(),
            kind: OpenTargetKind::FileManager,
            app_name: None,
            args: Vec::new(),
        };

        let spec = build_file_launch_spec(
            Path::new("/tmp/skein/src/app.ts"),
            OpenFileLocation {
                line: Some(42),
                column: Some(7),
            },
            &target,
        )
        .expect("launch spec");

        assert_eq!(
            spec,
            LaunchSpec {
                program: "/usr/bin/open".to_string(),
                args: vec![
                    OsString::from("-R"),
                    OsString::from("/tmp/skein/src/app.ts"),
                ],
            }
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn file_manager_targets_select_file_paths() {
        let target = OpenTarget {
            id: "file-manager".to_string(),
            label: "Explorer".to_string(),
            kind: OpenTargetKind::FileManager,
            app_name: None,
            args: Vec::new(),
        };

        let spec = build_file_launch_spec(
            Path::new(r"C:\skein\src\app.ts"),
            OpenFileLocation {
                line: Some(42),
                column: Some(7),
            },
            &target,
        )
        .expect("launch spec");

        assert_eq!(
            spec,
            LaunchSpec {
                program: "explorer".to_string(),
                args: vec![OsString::from(r"/select,C:\skein\src\app.ts")],
            }
        );
    }

    #[test]
    fn file_references_resolve_relative_paths_inside_the_environment() {
        let temp = TempDirGuard::new("skein-open-file-relative");
        let file = temp.path.join("src/app.ts");
        fs::create_dir_all(file.parent().expect("parent")).expect("create parent");
        fs::write(&file, "export const value = 1;\n").expect("write file");

        let resolved = resolve_environment_file_path(&temp.path, "src/app.ts").expect("file path");

        assert_eq!(resolved, file.canonicalize().expect("canonical file"));
    }

    #[test]
    fn file_references_allow_parent_segments_inside_the_environment() {
        let temp = TempDirGuard::new("skein-open-file-parent-inside");
        let file = temp.path.join("src/app.ts");
        fs::create_dir_all(file.parent().expect("parent")).expect("create parent");
        fs::write(&file, "export const value = 1;\n").expect("write file");

        let resolved =
            resolve_environment_file_path(&temp.path, "src/../src/app.ts").expect("file path");

        assert_eq!(resolved, file.canonicalize().expect("canonical file"));
    }

    #[test]
    fn file_references_expand_home_relative_paths_inside_the_environment() {
        let temp = TempDirGuard::new("skein-open-file-home-relative");
        let file = temp.path.join("src/app.ts");
        fs::create_dir_all(file.parent().expect("parent")).expect("create parent");
        fs::write(&file, "export const value = 1;\n").expect("write file");

        let resolved = resolve_environment_file_path_with_home(&temp.path, "~/src/app.ts", || {
            Ok(temp.path.clone())
        })
        .expect("file path");

        assert_eq!(resolved, file.canonicalize().expect("canonical file"));
    }

    #[test]
    fn file_references_reject_home_relative_paths_outside_the_environment() {
        let environment = TempDirGuard::new("skein-open-file-home-environment");
        let outside = TempDirGuard::new("skein-open-file-home-outside");
        fs::write(outside.path.join("secrets.txt"), "secret\n").expect("write file");

        let error =
            resolve_environment_file_path_with_home(&environment.path, "~/secrets.txt", || {
                Ok(outside.path.clone())
            })
            .expect_err("outside home-relative path should be rejected");

        assert!(error
            .to_string()
            .contains("inside the selected environment"));
    }

    #[test]
    fn file_references_reject_parent_segments_outside_the_environment() {
        let root = TempDirGuard::new("skein-open-file-traversal-root");
        let environment_path = root.path.join("environment");
        let outside_path = root.path.join("outside");
        fs::create_dir_all(&environment_path).expect("create environment");
        fs::create_dir_all(&outside_path).expect("create outside");
        fs::write(outside_path.join("secrets.txt"), "secret\n").expect("write file");

        let error = resolve_environment_file_path(&environment_path, "../outside/secrets.txt")
            .expect_err("traversal should be rejected");

        assert!(error
            .to_string()
            .contains("inside the selected environment"));
    }

    #[test]
    fn file_references_reject_absolute_paths_outside_the_environment() {
        let environment = TempDirGuard::new("skein-open-file-environment");
        let outside = TempDirGuard::new("skein-open-file-outside");
        let file = outside.path.join("secrets.txt");
        fs::write(&file, "secret\n").expect("write file");

        let error = resolve_environment_file_path(
            &environment.path,
            file.to_str().expect("utf8 test path"),
        )
        .expect_err("outside path should be rejected");

        assert!(error
            .to_string()
            .contains("inside the selected environment"));
    }

    #[test]
    fn file_references_reject_directories() {
        let temp = TempDirGuard::new("skein-open-file-directory");
        let directory = temp.path.join("src");
        fs::create_dir_all(&directory).expect("create directory");

        let error = resolve_environment_file_path(&temp.path, "src")
            .expect_err("directory should be rejected");

        assert!(error.to_string().contains("Expected a file path"));
    }

    #[cfg(unix)]
    #[test]
    fn launch_failure_prefers_stderr_output() {
        let failure = format_launch_failure(
            &LaunchSpec {
                program: "/usr/bin/open".to_string(),
                args: vec![],
            },
            &Output {
                status: ExitStatus::from_raw(1 << 8),
                stdout: Vec::new(),
                stderr: b"Unable to find application named 'MissingApp'".to_vec(),
            },
        );

        assert_eq!(
            failure,
            "Failed to launch /usr/bin/open: Unable to find application named 'MissingApp'"
        );
    }

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(prefix: &str) -> Self {
            let path = std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::now_v7()));
            fs::create_dir_all(&path).expect("create temp directory");
            Self { path }
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}
