// Custom URI scheme handler that lets the integrated browser panel embed
// dev servers that would otherwise refuse to render inside an iframe.
//
// The iframe loads `skein-preview://<scheme>_<host>[:port]/<path>?<query>`
// instead of the raw `http://localhost:3000/...`. This handler decodes
// the URI, fetches the real resource via reqwest, strips frame-blocking
// response headers (X-Frame-Options, Content-Security-Policy) and
// forwards the body back to the webview. Relative sub-resources resolve
// against the preview host and flow through the proxy too; absolute URLs
// baked into the page bypass it and may fail — a documented v1 limit.
//
// Targets are locked to loopback (`localhost`, `127.0.0.1`, `0.0.0.0`) so
// the proxy cannot be repurposed into a general-purpose header-stripping
// fetcher against arbitrary remote hosts. Non-loopback URIs are rejected
// with 403.

use std::time::Duration;

use reqwest::{Client, Url};
use tauri::http::header::{HeaderMap, HeaderName, HeaderValue};
use tauri::http::{Request, Response, StatusCode};

pub const PREVIEW_SCHEME: &str = "skein-preview";

const HOST_DELIMITER: char = '_';
const PROXY_TIMEOUT: Duration = Duration::from_secs(30);

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "0.0.0.0")
}

const MAX_REDIRECTS: usize = 10;
const MAX_RESPONSE_BYTES: u64 = 20 * 1024 * 1024;

pub fn build_client() -> Client {
    Client::builder()
        .timeout(PROXY_TIMEOUT)
        // Custom redirect policy re-validates the loopback constraint on
        // every hop. `Policy::limited` would follow a `302 Location:
        // https://remote.example/...` response out of loopback and defeat
        // the boundary enforced in `decode_preview_url`.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let next = attempt.url();
            let scheme_ok = matches!(next.scheme(), "http" | "https");
            let host_ok = next
                .host_str()
                .map(is_loopback_host)
                .unwrap_or(false);
            if scheme_ok && host_ok && attempt.previous().len() < MAX_REDIRECTS {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        // Cert validation is disabled only because the proxy is restricted to
        // loopback targets (see `decode_preview_url`). Self-signed certs on
        // local dev servers are common there.
        .danger_accept_invalid_certs(true)
        .build()
        .expect("reqwest client can be built with valid defaults")
}

/// Decode a `skein-preview://…` URL into the real `http(s)://…` target.
/// Returns `None` for malformed URIs or for non-loopback hosts — the proxy
/// is intentionally limited to local dev servers.
pub fn decode_preview_url(preview_url: &str) -> Option<Url> {
    let parsed = Url::parse(preview_url).ok()?;
    if parsed.scheme() != PREVIEW_SCHEME {
        return None;
    }
    let (scheme, target_host) = parsed.host_str()?.split_once(HOST_DELIMITER)?;
    if scheme != "http" && scheme != "https" {
        return None;
    }
    if !is_loopback_host(target_host) {
        return None;
    }
    let mut rebuilt = format!("{scheme}://{target_host}");
    if let Some(port) = parsed.port() {
        rebuilt.push(':');
        rebuilt.push_str(&port.to_string());
    }
    rebuilt.push_str(parsed.path());
    if let Some(query) = parsed.query() {
        rebuilt.push('?');
        rebuilt.push_str(query);
    }
    Url::parse(&rebuilt).ok()
}

#[cfg(test)]
fn encode_preview_url(http_url: &str) -> Option<String> {
    let parsed = Url::parse(http_url).ok()?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return None;
    }
    let host = parsed.host_str()?;
    let mut out = format!(
        "{}://{}{}{}",
        PREVIEW_SCHEME,
        parsed.scheme(),
        HOST_DELIMITER,
        host
    );
    if let Some(port) = parsed.port() {
        out.push(':');
        out.push_str(&port.to_string());
    }
    out.push_str(parsed.path());
    if let Some(query) = parsed.query() {
        out.push('?');
        out.push_str(query);
    }
    Some(out)
}

fn is_blocked_response_header(name: &HeaderName) -> bool {
    // `HeaderName::as_str()` is lowercase already.
    matches!(
        name.as_str(),
        "x-frame-options" | "content-security-policy" | "content-security-policy-report-only",
    )
}

// The iframe's window origin is `skein-preview://<scheme>_<host>[:port]`,
// so any Origin/Referer the browser attaches to fetches from the iframe
// carries that custom scheme. Dev servers and CSRF middlewares reject
// those as bogus. Rewrite them back to the real http(s) origin so POSTs
// and API calls behave like they would in a normal browser.
//
// Returns `None` when the header value is not a preview URL. The caller
// is expected to forward the original value verbatim in that case so
// the downstream CSRF/CORS middleware still has a cross-origin signal
// to reject truly cross-origin requests.
fn rewrite_origin_header(value: &HeaderValue) -> Option<HeaderValue> {
    let raw = value.to_str().ok()?;
    let decoded = decode_preview_url(raw)?;
    let host = decoded.host_str()?;
    let rebuilt = match decoded.port() {
        Some(port) => format!("{}://{}:{}", decoded.scheme(), host, port),
        None => format!("{}://{}", decoded.scheme(), host),
    };
    HeaderValue::from_str(&rebuilt).ok()
}

fn rewrite_referer_header(value: &HeaderValue) -> Option<HeaderValue> {
    let raw = value.to_str().ok()?;
    let decoded = decode_preview_url(raw)?;
    HeaderValue::from_str(decoded.as_str()).ok()
}

// Request headers we refuse to forward. Since the proxy is locked to
// loopback (see `decode_preview_url`), everything else can pass through
// so apps get the custom headers they need (x-csrf-token, x-inertia,
// x-requested-with, auth tokens, …). The denylist covers hop-by-hop
// headers that don't survive a reverse proxy and `host`, which reqwest
// re-derives from the target URL.
fn is_blocked_request_header(name: &HeaderName) -> bool {
    matches!(
        name.as_str(),
        "connection"
            | "host"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn error_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Skein browser error</title>\
        <body style=\"font-family:system-ui;padding:2rem;color:#f87171;\">\
        <h1>Can't reach this URL</h1><p>{}</p></body>",
        html_escape(message)
    )
    .into_bytes();
    Response::builder()
        .status(status)
        .header("content-type", "text/html; charset=utf-8")
        .body(body)
        .expect("static error response is valid")
}

fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

enum BoundedBodyError {
    TooLarge,
    Io(reqwest::Error),
}

async fn collect_bounded_body(
    mut response: reqwest::Response,
    max_bytes: u64,
) -> Result<Vec<u8>, BoundedBodyError> {
    let mut collected: Vec<u8> = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if (collected.len() as u64) + (chunk.len() as u64) > max_bytes {
                    return Err(BoundedBodyError::TooLarge);
                }
                collected.extend_from_slice(&chunk);
            }
            Ok(None) => return Ok(collected),
            Err(error) => return Err(BoundedBodyError::Io(error)),
        }
    }
}

pub async fn handle_request(
    request: Request<Vec<u8>>,
    client: &Client,
) -> Response<Vec<u8>> {
    let Some(target) = decode_preview_url(&request.uri().to_string()) else {
        return error_response(
            StatusCode::FORBIDDEN,
            "The integrated browser only proxies loopback URLs.",
        );
    };

    let mut forwarded = HeaderMap::new();
    for (name, value) in request.headers() {
        if is_blocked_request_header(name) {
            continue;
        }
        // For Origin/Referer, rewrite preview-scheme values back to the
        // real loopback origin so dev servers don't reject them. When
        // the value is NOT a preview URL, forward it verbatim so the
        // target's CSRF/CORS middleware still sees cross-origin
        // requests and can reject them.
        let forwarded_value = match name.as_str() {
            "origin" => {
                rewrite_origin_header(value).unwrap_or_else(|| value.clone())
            }
            "referer" => {
                rewrite_referer_header(value).unwrap_or_else(|| value.clone())
            }
            _ => value.clone(),
        };
        forwarded.insert(name.clone(), forwarded_value);
    }

    let mut outgoing = client
        .request(request.method().clone(), target.clone())
        .headers(forwarded);
    if !request.body().is_empty() {
        outgoing = outgoing.body(request.body().clone());
    }

    let response = match outgoing.send().await {
        Ok(response) => response,
        Err(error) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                &format!("Failed to reach {target}: {error}"),
            );
        }
    };

    if response
        .content_length()
        .map(|len| len > MAX_RESPONSE_BYTES)
        .unwrap_or(false)
    {
        return error_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            &format!(
                "Response from {target} is larger than the {}-MiB proxy limit.",
                MAX_RESPONSE_BYTES / (1024 * 1024)
            ),
        );
    }

    let mut builder = Response::builder().status(response.status().as_u16());
    for (name, value) in response.headers() {
        if !is_blocked_response_header(name) {
            builder = builder.header(name.as_str(), value.as_bytes());
        }
    }

    let body = match collect_bounded_body(response, MAX_RESPONSE_BYTES).await {
        Ok(bytes) => bytes,
        Err(BoundedBodyError::TooLarge) => {
            return error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                &format!(
                    "Response from {target} exceeded the {}-MiB proxy limit while streaming.",
                    MAX_RESPONSE_BYTES / (1024 * 1024)
                ),
            );
        }
        Err(BoundedBodyError::Io(error)) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                &format!("Failed to read body from {target}: {error}"),
            );
        }
    };

    builder
        .body(body)
        .expect("response builder has a valid status and headers")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_plain_localhost_url() {
        let decoded = decode_preview_url("skein-preview://http_localhost:3000/fr").unwrap();
        assert_eq!(decoded.as_str(), "http://localhost:3000/fr");
    }

    #[test]
    fn decodes_query_string() {
        let decoded =
            decode_preview_url("skein-preview://http_localhost:5173/path?q=1&r=two").unwrap();
        assert_eq!(decoded.as_str(), "http://localhost:5173/path?q=1&r=two");
    }

    #[test]
    fn decodes_https_loopback() {
        let decoded = decode_preview_url("skein-preview://https_localhost:8443/v1").unwrap();
        assert_eq!(decoded.as_str(), "https://localhost:8443/v1");
    }

    #[test]
    fn rejects_unknown_inner_scheme() {
        assert!(decode_preview_url("skein-preview://ftp_server/file").is_none());
    }

    #[test]
    fn rejects_wrong_outer_scheme() {
        assert!(decode_preview_url("http://localhost:3000/").is_none());
    }

    #[test]
    fn rejects_non_loopback_host() {
        assert!(decode_preview_url("skein-preview://http_example.com/path").is_none());
        assert!(decode_preview_url("skein-preview://https_api.github.com/v3").is_none());
        assert!(decode_preview_url("skein-preview://http_192.168.1.1/").is_none());
    }

    #[test]
    fn accepts_loopback_variants() {
        assert!(decode_preview_url("skein-preview://http_localhost:3000/").is_some());
        assert!(decode_preview_url("skein-preview://http_127.0.0.1:3000/").is_some());
        assert!(decode_preview_url("skein-preview://http_0.0.0.0:3000/").is_some());
    }

    #[test]
    fn encode_and_decode_roundtrip() {
        let encoded = encode_preview_url("http://localhost:3000/fr").unwrap();
        assert_eq!(encoded, "skein-preview://http_localhost:3000/fr");
        let decoded = decode_preview_url(&encoded).unwrap();
        assert_eq!(decoded.as_str(), "http://localhost:3000/fr");
    }

    #[test]
    fn blocks_frame_ancestors_headers() {
        let csp: HeaderName = "content-security-policy".parse().unwrap();
        assert!(is_blocked_response_header(&csp));
        let x_frame: HeaderName = "X-Frame-Options".parse().unwrap();
        assert!(is_blocked_response_header(&x_frame));
    }

    #[test]
    fn keeps_normal_headers() {
        let ct: HeaderName = "content-type".parse().unwrap();
        assert!(!is_blocked_response_header(&ct));
    }

    #[test]
    fn rewrites_origin_header_to_loopback_scheme() {
        let value = HeaderValue::from_static("skein-preview://http_localhost:3000");
        let rewritten = rewrite_origin_header(&value).unwrap();
        assert_eq!(rewritten.to_str().unwrap(), "http://localhost:3000");
    }

    #[test]
    fn rewrites_origin_header_without_port() {
        let value = HeaderValue::from_static("skein-preview://http_localhost");
        let rewritten = rewrite_origin_header(&value).unwrap();
        assert_eq!(rewritten.to_str().unwrap(), "http://localhost");
    }

    #[test]
    fn leaves_origin_header_alone_when_not_preview_scheme() {
        // rewrite_origin_header returns None so the caller keeps the
        // original value — the downstream CSRF middleware still needs
        // the real Origin to detect cross-origin requests.
        let value = HeaderValue::from_static("http://localhost:1420");
        assert!(rewrite_origin_header(&value).is_none());
    }

    #[test]
    fn rewrites_referer_preserving_path_and_query() {
        let value = HeaderValue::from_static(
            "skein-preview://http_localhost:3000/login?from=home",
        );
        let rewritten = rewrite_referer_header(&value).unwrap();
        assert_eq!(
            rewritten.to_str().unwrap(),
            "http://localhost:3000/login?from=home",
        );
    }

    #[test]
    fn leaves_referer_header_alone_when_not_preview_scheme() {
        let value = HeaderValue::from_static("http://localhost:1420/foo");
        assert!(rewrite_referer_header(&value).is_none());
    }

    #[test]
    fn blocks_hop_by_hop_request_headers() {
        for name in [
            "connection",
            "host",
            "keep-alive",
            "proxy-authenticate",
            "proxy-authorization",
            "te",
            "trailer",
            "transfer-encoding",
            "upgrade",
        ] {
            let header: HeaderName = name.parse().unwrap();
            assert!(
                is_blocked_request_header(&header),
                "expected {name} to be blocked",
            );
        }
    }

    #[test]
    fn forwards_app_defined_request_headers() {
        for name in [
            "x-csrf-token",
            "x-inertia",
            "x-requested-with",
            "authorization",
            "content-type",
            "cookie",
        ] {
            let header: HeaderName = name.parse().unwrap();
            assert!(
                !is_blocked_request_header(&header),
                "expected {name} to be forwarded",
            );
        }
    }
}
