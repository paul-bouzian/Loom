// Proxy layer that lets the integrated browser panel embed dev servers that
// would otherwise refuse to render inside an iframe.
//
// The iframe loads `skein-preview://<scheme>_<host>[:port]/<path>?<query>`
// instead of the raw `http://localhost:3000/...`. This handler decodes the
// URI, fetches the real resource via reqwest, strips frame-blocking
// headers (X-Frame-Options, CSP frame-ancestors), and forwards the body
// back to the webview. Sub-resources the page requests as relative URLs
// resolve against the preview host and therefore flow through the proxy
// too — absolute URLs pointing at the original host bypass it and may
// fail, which is documented as a v1 limitation.

use std::time::Duration;

use reqwest::Client;
use reqwest::Method;
use reqwest::Url;
use tauri::http::header::{HeaderMap, HeaderName, HeaderValue};
use tauri::http::{Request, Response, StatusCode};
use tracing::warn;

pub const PREVIEW_SCHEME: &str = "skein-preview";

const HOST_DELIMITER: char = '_';
const PROXY_TIMEOUT: Duration = Duration::from_secs(30);

/// Build a reqwest client tuned for the preview proxy. Shared across all
/// webview requests to reuse connection pools.
pub fn build_client() -> Client {
    Client::builder()
        .timeout(PROXY_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(10))
        // The preview is a trust-the-user dev tool, so don't validate TLS.
        // Local dev servers often use self-signed certs.
        .danger_accept_invalid_certs(true)
        .build()
        .unwrap_or_else(|error| {
            warn!("failed to build browser proxy client: {error}");
            Client::new()
        })
}

/// Decode a `skein-preview://…` URL into the real `http(s)://…` URL the
/// client actually wants to reach. Returns `None` for malformed URIs.
pub fn decode_preview_url(preview_url: &str) -> Option<Url> {
    let parsed = Url::parse(preview_url).ok()?;
    if parsed.scheme() != PREVIEW_SCHEME {
        return None;
    }
    let host = parsed.host_str()?;
    let (scheme, target_host) = host.split_once(HOST_DELIMITER)?;
    if scheme != "http" && scheme != "https" {
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

/// Encode a real URL into the preview scheme (mirrors the TS helper, used in
/// Rust-side tests).
#[cfg(test)]
pub fn encode_preview_url(http_url: &str) -> Option<String> {
    let parsed = Url::parse(http_url).ok()?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return None;
    }
    let host = parsed.host_str()?;
    let mut out = format!("{}://{}{}{}", PREVIEW_SCHEME, parsed.scheme(), HOST_DELIMITER, host);
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
    matches!(
        name.as_str().to_ascii_lowercase().as_str(),
        "x-frame-options" | "content-security-policy" | "content-security-policy-report-only",
    )
}

fn is_forwardable_request_header(name: &HeaderName) -> bool {
    matches!(
        name.as_str().to_ascii_lowercase().as_str(),
        "accept"
            | "accept-language"
            | "accept-encoding"
            | "cache-control"
            | "cookie"
            | "pragma"
            | "user-agent"
    )
}

/// Build an error response displayed inside the iframe when the proxy can't
/// reach the target.
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

/// Main entry point. Given a preview scheme request, fetch the real URL and
/// produce a response the webview can render.
pub async fn handle_request(
    request: Request<Vec<u8>>,
    client: &Client,
) -> Response<Vec<u8>> {
    let Some(target) = decode_preview_url(&request.uri().to_string()) else {
        return error_response(
            StatusCode::BAD_REQUEST,
            "Invalid preview URL.",
        );
    };

    let method = match Method::from_bytes(request.method().as_str().as_bytes()) {
        Ok(method) => method,
        Err(_) => return error_response(StatusCode::BAD_REQUEST, "Unsupported HTTP method."),
    };

    let mut outgoing = client.request(method, target.clone());
    let mut forwarded_headers = HeaderMap::new();
    for (name, value) in request.headers() {
        if is_forwardable_request_header(name) {
            forwarded_headers.insert(name.clone(), value.clone());
        }
    }
    if !forwarded_headers.contains_key(reqwest::header::HOST) {
        if let Some(host) = target.host_str() {
            let host_header = match target.port() {
                Some(port) => format!("{host}:{port}"),
                None => host.to_string(),
            };
            if let Ok(value) = HeaderValue::from_str(&host_header) {
                forwarded_headers.insert(reqwest::header::HOST, value);
            }
        }
    }
    outgoing = outgoing.headers(forwarded_headers);

    if !request.body().is_empty() {
        outgoing = outgoing.body(request.body().clone());
    }

    let response = match outgoing.send().await {
        Ok(response) => response,
        Err(error) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                &format!("Failed to reach {}: {}", target, error),
            );
        }
    };

    let status = response.status();
    let mut builder = Response::builder().status(status.as_u16());
    for (name, value) in response.headers() {
        if is_blocked_response_header(name) {
            continue;
        }
        builder = builder.header(name.as_str(), value.as_bytes());
    }

    let body = match response.bytes().await {
        Ok(bytes) => bytes.to_vec(),
        Err(error) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                &format!("Failed to read body from {}: {}", target, error),
            );
        }
    };

    builder.body(body).unwrap_or_else(|error| {
        warn!("browser proxy could not build response: {error}");
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Proxy response construction failed.",
        )
    })
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
        let decoded = decode_preview_url(
            "skein-preview://http_localhost:5173/path?q=1&r=two",
        )
        .unwrap();
        assert_eq!(decoded.as_str(), "http://localhost:5173/path?q=1&r=two");
    }

    #[test]
    fn decodes_https_scheme() {
        let decoded =
            decode_preview_url("skein-preview://https_api.example.com/v1").unwrap();
        assert_eq!(decoded.as_str(), "https://api.example.com/v1");
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
    fn encode_and_decode_roundtrip() {
        let encoded = encode_preview_url("http://localhost:3000/fr").unwrap();
        assert_eq!(encoded, "skein-preview://http_localhost:3000/fr");
        let decoded = decode_preview_url(&encoded).unwrap();
        assert_eq!(decoded.as_str(), "http://localhost:3000/fr");
    }

    #[test]
    fn blocks_frame_ancestors_headers() {
        let name: HeaderName = "content-security-policy".parse().unwrap();
        assert!(is_blocked_response_header(&name));
        let x_frame: HeaderName = "X-Frame-Options".parse().unwrap();
        assert!(is_blocked_response_header(&x_frame));
    }

    #[test]
    fn keeps_normal_headers() {
        let ct: HeaderName = "content-type".parse().unwrap();
        assert!(!is_blocked_response_header(&ct));
    }
}
