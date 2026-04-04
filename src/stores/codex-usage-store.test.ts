import { beforeEach, describe, expect, it, vi } from "vitest";

import * as bridge from "../lib/bridge";
import type { CodexUsageEventPayload } from "../lib/types";
import { teardownCodexUsageListener, useCodexUsageStore } from "./codex-usage-store";

vi.mock("../lib/bridge", () => ({
  getEnvironmentCodexRateLimits: vi.fn(),
  listenToCodexUsageEvents: vi.fn(),
}));

const mockedBridge = vi.mocked(bridge);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  teardownCodexUsageListener();
  useCodexUsageStore.setState((state) => ({
    ...state,
    snapshotsByEnvironmentId: {},
    loadingByEnvironmentId: {},
    errorByEnvironmentId: {},
    lastFetchedAtByEnvironmentId: {},
    listenerReady: false,
  }));
});

describe("codex usage store", () => {
  it("loads usage for the selected environment", async () => {
    mockedBridge.getEnvironmentCodexRateLimits.mockResolvedValue({
      primary: {
        usedPercent: 18,
        windowDurationMins: 300,
        resetsAt: 1_775_306_400,
      },
      secondary: {
        usedPercent: 55,
        windowDurationMins: 10_080,
        resetsAt: 1_775_910_400,
      },
    });

    await useCodexUsageStore.getState().ensureEnvironmentUsage("env-1");

    expect(mockedBridge.getEnvironmentCodexRateLimits).toHaveBeenCalledWith("env-1");
    expect(useCodexUsageStore.getState().snapshotsByEnvironmentId["env-1"]?.primary?.usedPercent).toBe(
      18,
    );
  });

  it("reuses fresh cached usage instead of refetching", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-04T10:00:00Z"));
    mockedBridge.getEnvironmentCodexRateLimits.mockResolvedValue({
      primary: { usedPercent: 11 },
      secondary: { usedPercent: 44 },
    });

    await useCodexUsageStore.getState().ensureEnvironmentUsage("env-1");
    await useCodexUsageStore.getState().ensureEnvironmentUsage("env-1");

    expect(mockedBridge.getEnvironmentCodexRateLimits).toHaveBeenCalledTimes(1);
  });

  it("does not cache failed usage fetches as fresh snapshots", async () => {
    mockedBridge.getEnvironmentCodexRateLimits
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        primary: { usedPercent: 21 },
        secondary: { usedPercent: 48 },
      });

    await useCodexUsageStore.getState().ensureEnvironmentUsage("env-1");
    expect(useCodexUsageStore.getState().lastFetchedAtByEnvironmentId["env-1"]).toBeNull();

    await useCodexUsageStore.getState().ensureEnvironmentUsage("env-1");

    expect(mockedBridge.getEnvironmentCodexRateLimits).toHaveBeenCalledTimes(2);
    expect(useCodexUsageStore.getState().snapshotsByEnvironmentId["env-1"]?.primary?.usedPercent).toBe(
      21,
    );
  });

  it("applies live usage updates from the runtime event stream", async () => {
    let callback: ((payload: CodexUsageEventPayload) => void) | null = null;
    mockedBridge.listenToCodexUsageEvents.mockImplementation(async (handler) => {
      callback = handler;
      return () => undefined;
    });

    await useCodexUsageStore.getState().initializeListener();
    expect(callback).not.toBeNull();
    callback!({
      environmentId: "env-1",
      rateLimits: {
        primary: { usedPercent: 72 },
      },
    });

    expect(useCodexUsageStore.getState().snapshotsByEnvironmentId["env-1"]?.primary?.usedPercent).toBe(
      72,
    );
    expect(useCodexUsageStore.getState().loadingByEnvironmentId["env-1"]).toBe(false);
  });
});
