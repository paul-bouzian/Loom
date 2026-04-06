import { create } from "zustand";

import * as bridge from "../lib/bridge";
import type { EnvironmentVoiceStatusSnapshot } from "../lib/types";

const VOICE_STATUS_CACHE_TTL_MS = 60_000;

type VoiceStatusState = {
  snapshotsByEnvironmentId: Record<string, EnvironmentVoiceStatusSnapshot | null>;
  loadingByEnvironmentId: Record<string, boolean>;
  errorByEnvironmentId: Record<string, string | null>;
  lastFetchedAtByEnvironmentId: Record<string, number | null>;

  ensureEnvironmentVoiceStatus: (environmentId: string | null) => Promise<void>;
  refreshEnvironmentVoiceStatus: (environmentId: string) => Promise<void>;
};

type VoiceStatusSet = (
  updater: (state: VoiceStatusState) => Partial<VoiceStatusState>,
) => void;

export const useVoiceStatusStore = create<VoiceStatusState>((set, get) => ({
  snapshotsByEnvironmentId: {},
  loadingByEnvironmentId: {},
  errorByEnvironmentId: {},
  lastFetchedAtByEnvironmentId: {},

  ensureEnvironmentVoiceStatus: async (environmentId) => {
    if (!environmentId) {
      return;
    }

    const state = get();
    if (state.loadingByEnvironmentId[environmentId]) {
      return;
    }

    const lastFetchedAt = state.lastFetchedAtByEnvironmentId[environmentId] ?? null;
    if (
      lastFetchedAt !== null &&
      Date.now() - lastFetchedAt < VOICE_STATUS_CACHE_TTL_MS
    ) {
      return;
    }

    await state.refreshEnvironmentVoiceStatus(environmentId);
  },

  refreshEnvironmentVoiceStatus: async (environmentId) => {
    const requestStartedAt = Date.now();
    setVoiceStatusLoading(set, environmentId);

    try {
      const snapshot = await bridge.getEnvironmentVoiceStatus(environmentId);
      if (isVoiceStatusFetchStale(get, environmentId, requestStartedAt)) {
        return;
      }
      setVoiceStatusSnapshot(set, environmentId, snapshot);
    } catch (cause: unknown) {
      if (isVoiceStatusFetchStale(get, environmentId, requestStartedAt)) {
        return;
      }
      const message =
        cause instanceof Error ? cause.message : "Failed to load voice status";
      setVoiceStatusError(set, environmentId, message);
    }
  },
}));

function setVoiceStatusLoading(
  set: VoiceStatusSet,
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

function setVoiceStatusSnapshot(
  set: VoiceStatusSet,
  environmentId: string,
  snapshot: EnvironmentVoiceStatusSnapshot,
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

function setVoiceStatusError(
  set: VoiceStatusSet,
  environmentId: string,
  message: string,
) {
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
      [environmentId]: null,
    },
  }));
}

function isVoiceStatusFetchStale(
  get: () => VoiceStatusState,
  environmentId: string,
  requestStartedAt: number,
) {
  const latestAppliedAt =
    get().lastFetchedAtByEnvironmentId[environmentId] ?? Number.NEGATIVE_INFINITY;
  return latestAppliedAt > requestStartedAt;
}
