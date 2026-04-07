import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as bridge from "../lib/bridge";
import {
  resetVoiceSessionStore,
  useVoiceSessionStore,
} from "./voice-session-store";
import { startVoiceCapture } from "../directions/studio/composer/composer-voice-audio";

vi.mock("../lib/bridge", () => ({
  transcribeEnvironmentVoice: vi.fn(),
}));

vi.mock("../directions/studio/composer/composer-voice-audio", () => ({
  MAX_RECORDING_DURATION_MS: 120_000,
  startVoiceCapture: vi.fn(),
}));

const mockedBridge = vi.mocked(bridge);
const mockedStartVoiceCapture = vi.mocked(startVoiceCapture);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockImplementation(() => Date.now());
  await resetVoiceSessionStore();
  mockedBridge.transcribeEnvironmentVoice.mockReset();
  mockedStartVoiceCapture.mockReset();
});

afterEach(async () => {
  await resetVoiceSessionStore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("voice session store", () => {
  it("auto-stops at the max duration and stores the transcript for the owner thread", async () => {
    const capture = makeCapture();
    mockedStartVoiceCapture.mockResolvedValue(capture);
    mockedBridge.transcribeEnvironmentVoice.mockResolvedValue({
      text: "voice note",
    });

    await useVoiceSessionStore.getState().startSession({
      environmentId: "env-1",
      threadId: "thread-1",
    });

    expect(useVoiceSessionStore.getState().phase).toBe("recording");

    await vi.advanceTimersByTimeAsync(120_000);

    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(useVoiceSessionStore.getState().phase).toBe("idle");
    expect(
      useVoiceSessionStore.getState().pendingOutcomesByThreadId["thread-1"],
    ).toMatchObject({
      kind: "transcript",
      text: "voice note",
      threadId: "thread-1",
    });
  });

  it("refuses to start a second session while one is already active", async () => {
    mockedStartVoiceCapture.mockResolvedValue(makeCapture());

    await useVoiceSessionStore.getState().startSession({
      environmentId: "env-1",
      threadId: "thread-1",
    });
    await useVoiceSessionStore.getState().startSession({
      environmentId: "env-2",
      threadId: "thread-2",
    });

    expect(mockedStartVoiceCapture).toHaveBeenCalledTimes(1);
    expect(useVoiceSessionStore.getState().ownerThreadId).toBe("thread-1");
  });
});

function makeCapture() {
  return {
    cancel: vi.fn(async () => undefined),
    drawSpectrum: vi.fn(),
    stop: vi.fn(async () => ({
      audioBase64: "dGVzdA==",
      durationMs: 1_200,
      mimeType: "audio/wav" as const,
      sampleRateHz: 24_000 as const,
    })),
  };
}
