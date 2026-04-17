import { create } from "zustand";

export const MAX_BROWSER_TABS = 8;
export const DETECTED_URLS_LIMIT = 16;
export const BROWSER_HOME_URL = "about:blank";

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
};

export function hostFromUrl(url: string): string {
  if (!url || url === BROWSER_HOME_URL) return "New tab";
  try {
    const parsed = new URL(url);
    return parsed.host || url;
  } catch {
    return url;
  }
}

function buildTab(initialUrl: string): BrowserTab {
  return {
    id: crypto.randomUUID(),
    history: [initialUrl],
    cursor: 0,
    reloadNonce: 0,
    pending: initialUrl !== BROWSER_HOME_URL,
    title: hostFromUrl(initialUrl),
  };
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  detectedUrls: [],

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
    set({ tabs: [...state.tabs, tab], activeTabId: tab.id });
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
  },

  activateTab: (id) => {
    const state = get();
    if (state.activeTabId === id) return;
    if (!state.tabs.some((tab) => tab.id === id)) return;
    set({ activeTabId: id });
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
