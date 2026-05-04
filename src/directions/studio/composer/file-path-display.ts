export type FilePathDisplay = {
  label: string;
  directory: string | null;
};

export function filePathDisplay(path: string, fallback = path): FilePathDisplay {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex === -1) {
    return { label: normalized || fallback, directory: null };
  }

  return {
    label: normalized.slice(slashIndex + 1) || fallback,
    directory: normalized.slice(0, slashIndex) || null,
  };
}
