// URL helpers for the integrated browser.
//
// `toPreviewUrl` / `fromPreviewUrl` translate between the user-facing
// http(s) URL the panel stores and the `skein-preview://` URL the iframe
// actually loads. The custom scheme is intercepted by the Rust proxy in
// `services/browser_proxy.rs`, which refetches the real URL and strips
// frame-blocking headers.
//
// `normalizeBrowserUrl` prepares raw text typed in the address bar:
// it accepts explicit http(s) URLs, auto-prefixes bare localhost with
// `http://`, auto-prefixes anything dotted with `https://`, and rejects
// unstructured input so the bar never doubles as a search box.

export const PREVIEW_SCHEME = "skein-preview";
const HOST_DELIMITER = "_";

export function normalizeBrowserUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(trimmed)
  ) {
    return `http://${trimmed}`;
  }
  if (!trimmed.includes(".") && !trimmed.includes(":")) return null;
  return `https://${trimmed}`;
}

export function toPreviewUrl(httpUrl: string): string {
  if (!httpUrl) return httpUrl;
  let parsed: URL;
  try {
    parsed = new URL(httpUrl);
  } catch {
    return httpUrl;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return httpUrl;
  }
  const scheme = parsed.protocol.slice(0, -1);
  const host = parsed.hostname;
  const port = parsed.port ? `:${parsed.port}` : "";
  return `${PREVIEW_SCHEME}://${scheme}${HOST_DELIMITER}${host}${port}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function fromPreviewUrl(previewUrl: string): string | null {
  if (!previewUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(previewUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${PREVIEW_SCHEME}:`) return null;
  const host = parsed.hostname;
  const separator = host.indexOf(HOST_DELIMITER);
  if (separator === -1) return null;
  const scheme = host.slice(0, separator);
  const targetHost = host.slice(separator + 1);
  if (scheme !== "http" && scheme !== "https") return null;
  const port = parsed.port ? `:${parsed.port}` : "";
  return `${scheme}://${targetHost}${port}${parsed.pathname}${parsed.search}${parsed.hash}`;
}
