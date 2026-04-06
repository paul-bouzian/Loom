import { beforeEach, describe, expect, it, vi } from "vitest";

import * as bridge from "../lib/bridge";
import { useVoiceStatusStore } from "./voice-status-store";

vi.mock("../lib/bridge", () => ({
  getEnvironmentVoiceStatus: vi.fn(),
}));

const mockedBridge = vi.mocked(bridge);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  useVoiceStatusStore.setState((state) => ({
    ...state,
    snapshotsByEnvironmentId: {},
    loadingByEnvironmentId: {},
    errorByEnvironmentId: {},
    lastFetchedAtByEnvironmentId: {},
  }));
});

describe("voice status store", () => {
  it("loads voice status for an environment", async () => {
    mockedBridge.getEnvironmentVoiceStatus.mockResolvedValue({
      environmentId: "env-1",
      available: true,
      authMode: "chatgpt",
      unavailableReason: null,
      message: null,
    });

    await useVoiceStatusStore.getState().ensureEnvironmentVoiceStatus("env-1");

    expect(mockedBridge.getEnvironmentVoiceStatus).toHaveBeenCalledWith("env-1");
    expect(useVoiceStatusStore.getState().snapshotsByEnvironmentId["env-1"]?.available).toBe(true);
  });

  it("reuses a fresh cached voice status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T10:00:00Z"));
    mockedBridge.getEnvironmentVoiceStatus.mockResolvedValue({
      environmentId: "env-1",
      available: false,
      authMode: "apiKey",
      unavailableReason: "chatgptRequired",
      message: "Voice transcription requires Sign in with ChatGPT.",
    });

    await useVoiceStatusStore.getState().ensureEnvironmentVoiceStatus("env-1");
    await useVoiceStatusStore.getState().ensureEnvironmentVoiceStatus("env-1");

    expect(mockedBridge.getEnvironmentVoiceStatus).toHaveBeenCalledTimes(1);
  });

  it("does not cache failed voice status fetches as fresh", async () => {
    mockedBridge.getEnvironmentVoiceStatus
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        environmentId: "env-1",
        available: true,
        authMode: "chatgpt",
        unavailableReason: null,
        message: null,
      });

    await useVoiceStatusStore.getState().ensureEnvironmentVoiceStatus("env-1");
    expect(useVoiceStatusStore.getState().lastFetchedAtByEnvironmentId["env-1"]).toBeNull();

    await useVoiceStatusStore.getState().ensureEnvironmentVoiceStatus("env-1");

    expect(mockedBridge.getEnvironmentVoiceStatus).toHaveBeenCalledTimes(2);
    expect(useVoiceStatusStore.getState().snapshotsByEnvironmentId["env-1"]?.available).toBe(true);
  });
});
