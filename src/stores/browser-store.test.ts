import { beforeEach, describe, expect, it } from "vitest";

import {
  BROWSER_HOME_URL,
  DETECTED_URLS_LIMIT,
  MAX_BROWSER_TABS,
  hostFromUrl,
  selectCanGoBack,
  selectCanGoForward,
  selectCurrentUrl,
  useBrowserStore,
} from "./browser-store";

beforeEach(() => {
  useBrowserStore.setState({
    tabs: [],
    activeTabId: null,
    detectedUrls: [],
  });
});

describe("hostFromUrl", () => {
  it("returns host for valid URLs", () => {
    expect(hostFromUrl("http://localhost:3000/foo")).toBe("localhost:3000");
  });

  it("returns placeholder for blank", () => {
    expect(hostFromUrl(BROWSER_HOME_URL)).toBe("New tab");
  });

  it("returns the raw string for invalid URLs", () => {
    expect(hostFromUrl("not a url")).toBe("not a url");
  });
});

describe("browser-store: tabs", () => {
  it("openTab creates a tab with history and marks it active", () => {
    const id = useBrowserStore.getState().openTab("http://localhost:3000");
    expect(id).not.toBeNull();
    const state = useBrowserStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe(id);
    expect(state.tabs[0].history).toEqual(["http://localhost:3000"]);
    expect(state.tabs[0].cursor).toBe(0);
    expect(state.tabs[0].pending).toBe(true);
  });

  it("openTab with no URL uses BROWSER_HOME_URL and pending=false", () => {
    const id = useBrowserStore.getState().openTab();
    const tab = useBrowserStore
      .getState()
      .tabs.find((t) => t.id === id);
    expect(tab?.history[0]).toBe(BROWSER_HOME_URL);
    expect(tab?.pending).toBe(false);
  });

  it("openTab returns null when MAX_BROWSER_TABS reached", () => {
    for (let i = 0; i < MAX_BROWSER_TABS; i++) {
      expect(useBrowserStore.getState().openTab()).not.toBeNull();
    }
    expect(useBrowserStore.getState().openTab()).toBeNull();
  });

  it("closeTab removes tab and picks a sensible next active", () => {
    const a = useBrowserStore.getState().openTab("http://a");
    const b = useBrowserStore.getState().openTab("http://b");
    const c = useBrowserStore.getState().openTab("http://c");
    expect(useBrowserStore.getState().activeTabId).toBe(c);
    useBrowserStore.getState().closeTab(c!);
    expect(useBrowserStore.getState().activeTabId).toBe(b);
    useBrowserStore.getState().closeTab(a!);
    expect(useBrowserStore.getState().activeTabId).toBe(b);
    useBrowserStore.getState().closeTab(b!);
    expect(useBrowserStore.getState().activeTabId).toBeNull();
  });

  it("activateTab switches the active tab", () => {
    const a = useBrowserStore.getState().openTab("http://a");
    const b = useBrowserStore.getState().openTab("http://b");
    expect(useBrowserStore.getState().activeTabId).toBe(b);
    useBrowserStore.getState().activateTab(a!);
    expect(useBrowserStore.getState().activeTabId).toBe(a);
  });
});

describe("browser-store: navigation", () => {
  it("navigate pushes URL to history and advances cursor", () => {
    useBrowserStore.getState().openTab("http://a");
    useBrowserStore.getState().navigate("http://b");
    const tab = useBrowserStore.getState().tabs[0];
    expect(tab.history).toEqual(["http://a", "http://b"]);
    expect(tab.cursor).toBe(1);
    expect(selectCurrentUrl(useBrowserStore.getState())).toBe("http://b");
  });

  it("back/forward move the cursor without mutating history", () => {
    useBrowserStore.getState().openTab("http://a");
    useBrowserStore.getState().navigate("http://b");
    useBrowserStore.getState().navigate("http://c");

    useBrowserStore.getState().back();
    expect(selectCurrentUrl(useBrowserStore.getState())).toBe("http://b");
    expect(selectCanGoBack(useBrowserStore.getState())).toBe(true);
    expect(selectCanGoForward(useBrowserStore.getState())).toBe(true);

    useBrowserStore.getState().forward();
    expect(selectCurrentUrl(useBrowserStore.getState())).toBe("http://c");
    expect(selectCanGoForward(useBrowserStore.getState())).toBe(false);
  });

  it("navigate after back truncates forward history", () => {
    useBrowserStore.getState().openTab("http://a");
    useBrowserStore.getState().navigate("http://b");
    useBrowserStore.getState().navigate("http://c");
    useBrowserStore.getState().back();
    useBrowserStore.getState().navigate("http://d");
    expect(useBrowserStore.getState().tabs[0].history).toEqual([
      "http://a",
      "http://b",
      "http://d",
    ]);
    expect(selectCanGoForward(useBrowserStore.getState())).toBe(false);
  });

  it("reload bumps reloadNonce and marks pending", () => {
    useBrowserStore.getState().openTab("http://a");
    useBrowserStore.getState().markLoaded(
      useBrowserStore.getState().tabs[0].id,
    );
    expect(useBrowserStore.getState().tabs[0].pending).toBe(false);
    useBrowserStore.getState().reload();
    expect(useBrowserStore.getState().tabs[0].pending).toBe(true);
    expect(useBrowserStore.getState().tabs[0].reloadNonce).toBe(1);
  });

  it("back is no-op at cursor=0", () => {
    useBrowserStore.getState().openTab("http://a");
    useBrowserStore.getState().back();
    expect(useBrowserStore.getState().tabs[0].cursor).toBe(0);
  });
});

describe("browser-store: detectedUrls", () => {
  it("reportDetectedUrl dedups and orders most-recent first", () => {
    useBrowserStore.getState().reportDetectedUrl("http://localhost:3000");
    useBrowserStore.getState().reportDetectedUrl("http://localhost:5173");
    useBrowserStore.getState().reportDetectedUrl("http://localhost:3000");
    const urls = useBrowserStore
      .getState()
      .detectedUrls.map((entry) => entry.url);
    expect(urls).toEqual([
      "http://localhost:3000",
      "http://localhost:5173",
    ]);
  });

  it("caps at DETECTED_URLS_LIMIT", () => {
    for (let i = 0; i < DETECTED_URLS_LIMIT + 4; i++) {
      useBrowserStore.getState().reportDetectedUrl(`http://localhost:${i}`);
    }
    expect(useBrowserStore.getState().detectedUrls).toHaveLength(
      DETECTED_URLS_LIMIT,
    );
  });

  it("clearDetectedUrls empties the list", () => {
    useBrowserStore.getState().reportDetectedUrl("http://localhost:3000");
    useBrowserStore.getState().clearDetectedUrls();
    expect(useBrowserStore.getState().detectedUrls).toEqual([]);
  });
});

describe("browser-store: session-only", () => {
  it("does not persist tabs to localStorage", async () => {
    useBrowserStore.getState().openTab("http://a");
    await new Promise((resolve) => setTimeout(resolve, 120));
    // Every skein localStorage key is namespaced with "skein-". No
    // browser-related entry should be written.
    const keys = Object.keys(localStorage).filter((key) =>
      key.includes("browser"),
    );
    expect(keys).toEqual([]);
  });
});
