import { create } from "zustand";

import * as bridge from "../lib/bridge";
import type { ProviderRateLimitSnapshot } from "../lib/types";

const CLAUDE_USAGE_CACHE_TTL_MS = 60_000;

type RefreshClaudeUsageOptions = {
  silent?: boolean;
};

type ClaudeUsageState = {
  snapshot: ProviderRateLimitSnapshot | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;

  ensureClaudeUsage: () => Promise<void>;
  refreshClaudeUsage: (options?: RefreshClaudeUsageOptions) => Promise<void>;
};

type ClaudeUsageSet = (
  updater: (state: ClaudeUsageState) => Partial<ClaudeUsageState>,
) => void;

let inflightClaudeUsageFetch: Promise<void> | null = null;

export const useClaudeUsageStore = create<ClaudeUsageState>((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,
  lastFetchedAt: null,

  ensureClaudeUsage: async () => {
    if (inflightClaudeUsageFetch) {
      await inflightClaudeUsageFetch;
    }
    if (isClaudeUsageSnapshotFresh(get().lastFetchedAt)) {
      return;
    }
    await get().refreshClaudeUsage({ silent: get().snapshot !== null });
  },

  refreshClaudeUsage: async (options = {}) => {
    while (inflightClaudeUsageFetch) {
      await inflightClaudeUsageFetch;
      if (isClaudeUsageSnapshotFresh(get().lastFetchedAt)) {
        return;
      }
    }

    const requestStartedAt = Date.now();
    const request = (async () => {
      setClaudeUsageLoading(set);

      try {
        const snapshot = await bridge.getClaudeRateLimits();
        if (isClaudeUsageFetchStale(get, requestStartedAt)) {
          return;
        }
        setClaudeUsageSnapshot(set, snapshot);
      } catch (cause: unknown) {
        if (isClaudeUsageFetchStale(get, requestStartedAt)) {
          return;
        }
        const message =
          cause instanceof Error ? cause.message : "Failed to load Claude usage";
        setClaudeUsageError(set, message, options.silent ?? false);
      }
    })();

    inflightClaudeUsageFetch = request;
    try {
      await request;
    } finally {
      if (inflightClaudeUsageFetch === request) {
        inflightClaudeUsageFetch = null;
      }
    }
  },
}));

export function teardownClaudeUsageStore() {
  inflightClaudeUsageFetch = null;
  useClaudeUsageStore.setState({
    snapshot: null,
    loading: false,
    error: null,
    lastFetchedAt: null,
  });
}

function setClaudeUsageLoading(set: ClaudeUsageSet) {
  set((state) => ({
    loading: true,
    error: state.snapshot === null ? null : state.error,
  }));
}

function setClaudeUsageSnapshot(
  set: ClaudeUsageSet,
  snapshot: ProviderRateLimitSnapshot,
) {
  set(() => ({
    snapshot,
    loading: false,
    error: snapshot.status === "error" ? (snapshot.error ?? null) : null,
    lastFetchedAt: Date.now(),
  }));
}

function setClaudeUsageError(
  set: ClaudeUsageSet,
  message: string,
  silent: boolean,
) {
  set((state) => ({
    loading: false,
    error: silent && state.snapshot !== null ? null : message,
    lastFetchedAt: silent && state.snapshot !== null ? state.lastFetchedAt : null,
  }));
}

function isClaudeUsageFetchStale(
  get: () => ClaudeUsageState,
  requestStartedAt: number,
) {
  const latestAppliedAt = get().lastFetchedAt ?? Number.NEGATIVE_INFINITY;
  return latestAppliedAt > requestStartedAt;
}

function isClaudeUsageSnapshotFresh(lastFetchedAt: number | null) {
  return (
    lastFetchedAt !== null &&
    Date.now() - lastFetchedAt < CLAUDE_USAGE_CACHE_TTL_MS
  );
}
