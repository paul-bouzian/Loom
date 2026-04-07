export type FileReferenceTarget = {
  rawTarget: string;
  filePath: string;
  line: number | null;
  column: number | null;
};

const HASH_POSITION_PATTERN = /#L(\d+)(?:C(\d+))?$/;
const COLON_POSITION_PATTERN = /:(\d+)(?::(\d+))?$/;
const KNOWN_RELATIVE_ROOT_PATTERN =
  /^(?:src|src-tauri|docs|tests?|scripts|assets|public|packages|apps|crates|examples|\.codex|\.github)\//;

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
  if (!value || hasUriScheme(value) || value.startsWith("//")) {
    return false;
  }

  return (
    value.startsWith("/") ||
    value.startsWith("~/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    KNOWN_RELATIVE_ROOT_PATTERN.test(value)
  );
}

function hasUriScheme(value: string) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function parsePositiveInteger(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
