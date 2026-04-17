import { create } from "zustand";

import {
  BROWSER_STATE_STORAGE_KEY,
  LEGACY_BROWSER_STATE_STORAGE_KEYS,
  readLocalStorageWithMigration,
} from "../lib/app-identity";

export const MAX_BROWSER_TABS = 8;
export const DETECTED_URLS_LIMIT = 16;
export const BROWSER_HOME_URL = "about:blank";

const PERSIST_DEBOUNCE_MS = 100;

export type BrowserTab = {
  id: string;
  history: string[];
  cursor: number;
  reloadNonce: number;
  pending: boolean;
  title: string;
};

export type DetectedUrl = {
  url: string;
  firstSeenAt: number;
};

type BrowserState = {
  tabs: BrowserTab[];
  activeTabId: string | null;
  detectedUrls: DetectedUrl[];

  openTab: (url?: string) => string | null;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;

  navigate: (url: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  markLoaded: (tabId: string) => void;

  reportDetectedUrl: (url: string) => void;
  clearDetectedUrls: () => void;
};

type PersistedTab = Pick<BrowserTab, "id" | "history" | "cursor" | "title">;
type PersistedState = {
  tabs: PersistedTab[];
  activeTabId: string | null;
};

function newTabId(): string {
  return crypto.randomUUID();
}

export function hostFromUrl(url: string): string {
  if (!url || url === BROWSER_HOME_URL) return "New tab";
  try {
    const parsed = new URL(url);
    return parsed.host || url;
  } catch {
    return url;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readPersistedState(): PersistedState | null {
  try {
    const raw = readLocalStorageWithMigration(
      BROWSER_STATE_STORAGE_KEY,
      LEGACY_BROWSER_STATE_STORAGE_KEYS,
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return null;
    const tabsRaw = parsed.tabs;
    if (!Array.isArray(tabsRaw)) return null;
    const tabs: PersistedTab[] = [];
    for (const entry of tabsRaw) {
      if (!isPlainObject(entry)) continue;
      const id = typeof entry.id === "string" ? entry.id : null;
      const history = Array.isArray(entry.history)
        ? entry.history.filter((u): u is string => typeof u === "string")
        : null;
      const cursor = typeof entry.cursor === "number" ? entry.cursor : null;
      const title = typeof entry.title === "string" ? entry.title : null;
      if (!id || !history || history.length === 0 || cursor === null) continue;
      tabs.push({
        id,
        history,
        cursor: Math.min(Math.max(0, cursor), history.length - 1),
        title: title ?? hostFromUrl(history[cursor] ?? ""),
      });
    }
    const activeTabIdRaw = parsed.activeTabId;
    const activeTabId =
      typeof activeTabIdRaw === "string" &&
      tabs.some((tab) => tab.id === activeTabIdRaw)
        ? activeTabIdRaw
        : tabs[0]?.id ?? null;
    return { tabs: tabs.slice(0, MAX_BROWSER_TABS), activeTabId };
  } catch {
    return null;
  }
}

let persistTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

function persistNow(tabs: BrowserTab[], activeTabId: string | null) {
  const persistedTabs: PersistedTab[] = tabs.map((tab) => ({
    id: tab.id,
    history: tab.history,
    cursor: tab.cursor,
    title: tab.title,
  }));
  try {
    localStorage.setItem(
      BROWSER_STATE_STORAGE_KEY,
      JSON.stringify({ tabs: persistedTabs, activeTabId }),
    );
  } catch {
    /* storage quota or disabled — ignore */
  }
}

function schedulePersist(tabs: BrowserTab[], activeTabId: string | null) {
  if (persistTimer !== null) {
    globalThis.clearTimeout(persistTimer);
  }
  persistTimer = globalThis.setTimeout(() => {
    persistTimer = null;
    persistNow(tabs, activeTabId);
  }, PERSIST_DEBOUNCE_MS);
}

function buildTab(initialUrl: string): BrowserTab {
  return {
    id: newTabId(),
    history: [initialUrl],
    cursor: 0,
    reloadNonce: 0,
    pending: initialUrl !== BROWSER_HOME_URL,
    title: hostFromUrl(initialUrl),
  };
}

function initialState(): Pick<
  BrowserState,
  "tabs" | "activeTabId" | "detectedUrls"
> {
  const persisted = readPersistedState();
  if (persisted) {
    return {
      tabs: persisted.tabs.map((tab) => ({
        ...tab,
        reloadNonce: 0,
        pending: false,
      })),
      activeTabId: persisted.activeTabId,
      detectedUrls: [],
    };
  }
  return { tabs: [], activeTabId: null, detectedUrls: [] };
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  ...initialState(),

  openTab: (url) => {
    const state = get();
    if (state.tabs.length >= MAX_BROWSER_TABS) {
      return null;
    }
    // If no URL is provided, auto-seed with the most-recently-detected
    // localhost URL so fresh tabs land on the dev server without a click.
    const resolvedUrl =
      url ?? state.detectedUrls[0]?.url ?? BROWSER_HOME_URL;
    const tab = buildTab(resolvedUrl);
    const nextTabs = [...state.tabs, tab];
    set({ tabs: nextTabs, activeTabId: tab.id });
    schedulePersist(nextTabs, tab.id);
    return tab.id;
  },

  closeTab: (id) => {
    const state = get();
    const index = state.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const nextTabs = state.tabs.filter((tab) => tab.id !== id);
    let nextActive = state.activeTabId;
    if (state.activeTabId === id) {
      const fallback = nextTabs[index] ?? nextTabs[index - 1] ?? null;
      nextActive = fallback ? fallback.id : null;
    }
    set({ tabs: nextTabs, activeTabId: nextActive });
    schedulePersist(nextTabs, nextActive);
  },

  activateTab: (id) => {
    const state = get();
    if (state.activeTabId === id) return;
    if (!state.tabs.some((tab) => tab.id === id)) return;
    set({ activeTabId: id });
    schedulePersist(state.tabs, id);
  },

  navigate: (url) => {
    const state = get();
    const activeId = state.activeTabId;
    if (!activeId) return;
    const nextTabs = state.tabs.map((tab) => {
      if (tab.id !== activeId) return tab;
      const trimmedHistory = tab.history.slice(0, tab.cursor + 1);
      const nextHistory = [...trimmedHistory, url];
      return {
        ...tab,
        history: nextHistory,
        cursor: nextHistory.length - 1,
        pending: true,
        title: hostFromUrl(url),
      };
    });
    set({ tabs: nextTabs });
    schedulePersist(nextTabs, state.activeTabId);
  },

  back: () => {
    const state = get();
    const activeId = state.activeTabId;
    if (!activeId) return;
    const nextTabs = state.tabs.map((tab) => {
      if (tab.id !== activeId || tab.cursor <= 0) return tab;
      const nextCursor = tab.cursor - 1;
      return {
        ...tab,
        cursor: nextCursor,
        pending: true,
        title: hostFromUrl(tab.history[nextCursor] ?? ""),
      };
    });
    set({ tabs: nextTabs });
    schedulePersist(nextTabs, state.activeTabId);
  },

  forward: () => {
    const state = get();
    const activeId = state.activeTabId;
    if (!activeId) return;
    const nextTabs = state.tabs.map((tab) => {
      if (tab.id !== activeId || tab.cursor >= tab.history.length - 1) {
        return tab;
      }
      const nextCursor = tab.cursor + 1;
      return {
        ...tab,
        cursor: nextCursor,
        pending: true,
        title: hostFromUrl(tab.history[nextCursor] ?? ""),
      };
    });
    set({ tabs: nextTabs });
    schedulePersist(nextTabs, state.activeTabId);
  },

  reload: () => {
    const state = get();
    const activeId = state.activeTabId;
    if (!activeId) return;
    const nextTabs = state.tabs.map((tab) =>
      tab.id === activeId
        ? { ...tab, reloadNonce: tab.reloadNonce + 1, pending: true }
        : tab,
    );
    set({ tabs: nextTabs });
  },

  markLoaded: (tabId) => {
    const state = get();
    if (!state.tabs.some((tab) => tab.id === tabId && tab.pending)) return;
    set({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, pending: false } : tab,
      ),
    });
  },

  reportDetectedUrl: (url) => {
    if (!url) return;
    const state = get();
    const existing = state.detectedUrls.filter((entry) => entry.url !== url);
    const next: DetectedUrl[] = [
      { url, firstSeenAt: Date.now() },
      ...existing,
    ].slice(0, DETECTED_URLS_LIMIT);
    set({ detectedUrls: next });
  },

  clearDetectedUrls: () => {
    set({ detectedUrls: [] });
  },
}));

export function selectActiveTab(state: BrowserState): BrowserTab | null {
  if (!state.activeTabId) return null;
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

export function selectCurrentUrl(state: BrowserState): string | null {
  const tab = selectActiveTab(state);
  if (!tab) return null;
  return tab.history[tab.cursor] ?? null;
}

export function selectCanGoBack(state: BrowserState): boolean {
  const tab = selectActiveTab(state);
  return tab ? tab.cursor > 0 : false;
}

export function selectCanGoForward(state: BrowserState): boolean {
  const tab = selectActiveTab(state);
  return tab ? tab.cursor < tab.history.length - 1 : false;
}
