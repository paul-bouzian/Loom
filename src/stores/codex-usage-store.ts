import { create } from "zustand";

import * as bridge from "../lib/bridge";
import type { CodexRateLimitSnapshot } from "../lib/types";

const USAGE_CACHE_TTL_MS = 60_000;

type CodexUsageState = {
  snapshotsByEnvironmentId: Record<string, CodexRateLimitSnapshot | null>;
  loadingByEnvironmentId: Record<string, boolean>;
  errorByEnvironmentId: Record<string, string | null>;
  lastFetchedAtByEnvironmentId: Record<string, number | null>;
  listenerReady: boolean;

  initializeListener: () => Promise<void>;
  ensureEnvironmentUsage: (environmentId: string | null) => Promise<void>;
  refreshEnvironmentUsage: (environmentId: string) => Promise<void>;
};

type CodexUsageSet = (
  updater: (state: CodexUsageState) => Partial<CodexUsageState>,
) => void;

let unlistenCodexUsageEvents: null | (() => void) = null;
let listenerInitialization: Promise<void> | null = null;
let listenerGeneration = 0;

export const useCodexUsageStore = create<CodexUsageState>((set, get) => ({
  snapshotsByEnvironmentId: {},
  loadingByEnvironmentId: {},
  errorByEnvironmentId: {},
  lastFetchedAtByEnvironmentId: {},
  listenerReady: false,

  initializeListener: async () => {
    if (get().listenerReady) return;
    if (listenerInitialization) {
      await listenerInitialization;
      return;
    }

    const generation = listenerGeneration;
    const initialization = bridge
      .listenToCodexUsageEvents((payload) => {
        setUsageSnapshot(set, payload.environmentId, payload.rateLimits);
      })
      .then((unlisten) => {
        if (generation !== listenerGeneration) {
          unlisten();
          return;
        }
        unlistenCodexUsageEvents = unlisten;
        set({ listenerReady: true });
      });
    listenerInitialization = initialization;

    try {
      await initialization;
    } finally {
      if (listenerInitialization === initialization) {
        listenerInitialization = null;
      }
    }
  },

  ensureEnvironmentUsage: async (environmentId) => {
    if (!environmentId) return;

    const state = get();
    if (state.loadingByEnvironmentId[environmentId]) {
      return;
    }

    const lastFetchedAt = state.lastFetchedAtByEnvironmentId[environmentId] ?? null;
    if (lastFetchedAt !== null && Date.now() - lastFetchedAt < USAGE_CACHE_TTL_MS) {
      return;
    }

    await state.refreshEnvironmentUsage(environmentId);
  },

  refreshEnvironmentUsage: async (environmentId) => {
    setUsageLoading(set, environmentId);

    try {
      const snapshot = await bridge.getEnvironmentCodexRateLimits(environmentId);
      setUsageSnapshot(set, environmentId, snapshot);
    } catch (cause: unknown) {
      const message =
        cause instanceof Error ? cause.message : "Failed to load Codex usage";
      setUsageError(set, environmentId, message);
    }
  },
}));

export function teardownCodexUsageListener() {
  listenerGeneration += 1;
  unlistenCodexUsageEvents?.();
  unlistenCodexUsageEvents = null;
  listenerInitialization = null;
  useCodexUsageStore.setState({ listenerReady: false });
}

function setUsageLoading(
  set: CodexUsageSet,
  environmentId: string,
) {
  set((state) => ({
    loadingByEnvironmentId: {
      ...state.loadingByEnvironmentId,
      [environmentId]: true,
    },
    errorByEnvironmentId: {
      ...state.errorByEnvironmentId,
      [environmentId]: null,
    },
  }));
}

function setUsageSnapshot(
  set: CodexUsageSet,
  environmentId: string,
  snapshot: CodexRateLimitSnapshot,
) {
  const fetchedAt = Date.now();
  set((state) => ({
    snapshotsByEnvironmentId: {
      ...state.snapshotsByEnvironmentId,
      [environmentId]: snapshot,
    },
    loadingByEnvironmentId: {
      ...state.loadingByEnvironmentId,
      [environmentId]: false,
    },
    errorByEnvironmentId: {
      ...state.errorByEnvironmentId,
      [environmentId]: null,
    },
    lastFetchedAtByEnvironmentId: {
      ...state.lastFetchedAtByEnvironmentId,
      [environmentId]: fetchedAt,
    },
  }));
}

function setUsageError(
  set: CodexUsageSet,
  environmentId: string,
  message: string,
) {
  const fetchedAt = Date.now();
  set((state) => ({
    loadingByEnvironmentId: {
      ...state.loadingByEnvironmentId,
      [environmentId]: false,
    },
    errorByEnvironmentId: {
      ...state.errorByEnvironmentId,
      [environmentId]: message,
    },
    lastFetchedAtByEnvironmentId: {
      ...state.lastFetchedAtByEnvironmentId,
      [environmentId]: fetchedAt,
    },
  }));
}
