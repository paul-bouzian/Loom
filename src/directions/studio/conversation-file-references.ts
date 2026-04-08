export type FileReferenceTarget = {
  rawTarget: string;
  filePath: string;
  line: number | null;
  column: number | null;
};

const HASH_POSITION_PATTERN = /#L(\d+)(?:C(\d+))?$/;
const COLON_POSITION_PATTERN = /:(\d+)(?::(\d+))?$/;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const FILE_NAME_PATTERN =
  /^(?:\.[A-Za-z0-9._-]+|[A-Za-z0-9_-][A-Za-z0-9()_-]*(?:\.[A-Za-z0-9._-]+)+)$/;
const COMMON_EXTENSIONLESS_FILE_NAMES = new Set([
  "dockerfile",
  "makefile",
  "license",
  "readme",
  "changelog",
  "notice",
  "procfile",
  "gemfile",
  "podfile",
  "brewfile",
  "vagrantfile",
  "rakefile",
  "jenkinsfile",
  "justfile",
]);
const RECOGNIZED_FILE_EXTENSIONS = new Set([
  "bash",
  "c",
  "cc",
  "conf",
  "cpp",
  "css",
  "csv",
  "cxx",
  "dart",
  "env",
  "go",
  "h",
  "hpp",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "kts",
  "less",
  "lock",
  "lua",
  "m",
  "md",
  "mm",
  "php",
  "plist",
  "py",
  "rb",
  "rs",
  "sass",
  "scala",
  "scss",
  "sh",
  "sql",
  "svg",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

export function parseFileReferenceTarget(target: string): FileReferenceTarget | null {
  const rawTarget = target.trim();
  if (!rawTarget) {
    return null;
  }

  let filePath = rawTarget;
  let line: number | null = null;
  let column: number | null = null;

  const hashPosition = rawTarget.match(HASH_POSITION_PATTERN);
  if (hashPosition?.index !== undefined) {
    filePath = rawTarget.slice(0, hashPosition.index);
    line = parsePositiveInteger(hashPosition[1]);
    column = parsePositiveInteger(hashPosition[2]);
  } else {
    const colonPosition = rawTarget.match(COLON_POSITION_PATTERN);
    if (colonPosition?.index !== undefined) {
      const candidatePath = rawTarget.slice(0, colonPosition.index);
      if (isLikelyLocalFilePath(candidatePath)) {
        filePath = candidatePath;
        line = parsePositiveInteger(colonPosition[1]);
        column = parsePositiveInteger(colonPosition[2]);
      }
    }
  }

  const normalizedPath = filePath.trim();
  if (!isLikelyLocalFilePath(normalizedPath)) {
    return null;
  }

  return {
    rawTarget,
    filePath: normalizedPath,
    line,
    column,
  };
}

function isLikelyLocalFilePath(value: string) {
  if (!value || value.startsWith("//")) {
    return false;
  }

  if (isWindowsAbsolutePath(value)) {
    return true;
  }

  if (hasUriScheme(value)) {
    return false;
  }

  return (
    value.startsWith("/") ||
    value.startsWith("~/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    isLikelyRelativeFilePath(value)
  );
}

function hasUriScheme(value: string) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

export function isWindowsAbsolutePath(value: string) {
  return WINDOWS_ABSOLUTE_PATH_PATTERN.test(value);
}

function isLikelyRelativeFilePath(value: string) {
  const segments = value.trim().split(/[\\/]/).filter(Boolean);
  if (segments.length === 0) {
    return false;
  }

  return isLikelyFileName(segments[segments.length - 1] ?? "");
}

function isLikelyFileName(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.includes(" ")) {
    return false;
  }

  const lowerCased = normalized.toLowerCase();
  if (COMMON_EXTENSIONLESS_FILE_NAMES.has(lowerCased)) {
    return true;
  }

  if (looksLikeVersionLiteral(lowerCased) || !FILE_NAME_PATTERN.test(normalized)) {
    return false;
  }

  if (normalized.startsWith(".")) {
    return true;
  }

  const extension = normalized.split(".").pop()?.toLowerCase() ?? "";
  return RECOGNIZED_FILE_EXTENSIONS.has(extension);
}

function looksLikeVersionLiteral(value: string) {
  return /^v?\d+(?:\.\d+)+(?:[-+][A-Za-z0-9.-]+)?$/.test(value);
}

function parsePositiveInteger(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
