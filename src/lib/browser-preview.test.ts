import { describe, expect, it } from "vitest";

import {
  fromPreviewUrl,
  normalizeBrowserUrl,
  toPreviewUrl,
} from "./browser-preview";

describe("normalizeBrowserUrl", () => {
  it("prefixes http:// to bare localhost", () => {
    expect(normalizeBrowserUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeBrowserUrl("127.0.0.1:8000")).toBe("http://127.0.0.1:8000");
  });

  it("keeps explicit protocol", () => {
    expect(normalizeBrowserUrl("https://github.com")).toBe("https://github.com");
  });

  it("rejects a bare word (no dot, no colon)", () => {
    expect(normalizeBrowserUrl("hello")).toBeNull();
  });

  it("prefixes https:// for domains", () => {
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com");
  });

  it("returns null for empty input", () => {
    expect(normalizeBrowserUrl("   ")).toBeNull();
  });
});

describe("toPreviewUrl", () => {
  it("rewrites http URL with port", () => {
    expect(toPreviewUrl("http://localhost:3000/fr")).toBe(
      "skein-preview://http_localhost:3000/fr",
    );
  });

  it("preserves query string and hash", () => {
    expect(
      toPreviewUrl("http://localhost:5173/path?q=1&r=2#section"),
    ).toBe("skein-preview://http_localhost:5173/path?q=1&r=2#section");
  });

  it("rewrites https without port", () => {
    expect(toPreviewUrl("https://example.com/path")).toBe(
      "skein-preview://https_example.com/path",
    );
  });

  it("returns the input unchanged for about:blank", () => {
    expect(toPreviewUrl("about:blank")).toBe("about:blank");
  });

  it("returns the input unchanged for a malformed URL", () => {
    expect(toPreviewUrl("not a url")).toBe("not a url");
  });

  it("leaves skein-preview URLs alone", () => {
    const already = "skein-preview://http_localhost:3000/";
    expect(toPreviewUrl(already)).toBe(already);
  });
});

describe("fromPreviewUrl", () => {
  it("decodes a preview URL back to the original", () => {
    expect(
      fromPreviewUrl("skein-preview://http_localhost:3000/fr"),
    ).toBe("http://localhost:3000/fr");
  });

  it("returns null for a non-preview URL", () => {
    expect(fromPreviewUrl("http://localhost:3000/")).toBeNull();
  });

  it("returns null for a malformed preview URL", () => {
    expect(fromPreviewUrl("skein-preview://missing-delimiter/")).toBeNull();
  });

  it("round-trips a complex URL", () => {
    const original = "https://api.example.com:8443/v1?token=abc#/";
    const decoded = fromPreviewUrl(toPreviewUrl(original));
    expect(decoded).toBe(original);
  });
});
