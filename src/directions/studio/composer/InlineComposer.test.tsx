import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as bridge from "../../../lib/bridge";
import { baseComposer, capabilitiesFixture } from "../../../test/fixtures/conversation";
import { useVoiceStatusStore } from "../../../stores/voice-status-store";
import { InlineComposer } from "./InlineComposer";
import type { ComposerDraftMentionBinding } from "./composer-mention-bindings";
import { startVoiceCapture } from "./composer-voice-audio";

vi.mock("../../../lib/bridge", () => ({
  getThreadComposerCatalog: vi.fn(),
  searchThreadFiles: vi.fn(),
  getEnvironmentVoiceStatus: vi.fn(),
  transcribeEnvironmentVoice: vi.fn(),
}));

vi.mock("./composer-voice-audio", () => ({
  MAX_RECORDING_DURATION_MS: 120_000,
  startVoiceCapture: vi.fn(),
}));

const mockedBridge = vi.mocked(bridge);
const mockedStartVoiceCapture = vi.mocked(startVoiceCapture);

beforeEach(() => {
  vi.clearAllMocks();
  useVoiceStatusStore.setState((state) => ({
    ...state,
    snapshotsByEnvironmentId: {},
    loadingByEnvironmentId: {},
    errorByEnvironmentId: {},
    lastFetchedAtByEnvironmentId: {},
  }));
  mockedBridge.getThreadComposerCatalog.mockResolvedValue({
    prompts: [],
    skills: [],
    apps: [],
  });
  mockedBridge.searchThreadFiles.mockResolvedValue([]);
  mockedBridge.getEnvironmentVoiceStatus.mockResolvedValue({
    environmentId: "env-1",
    available: true,
    authMode: "chatgpt",
    unavailableReason: null,
    message: null,
  });

  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(),
    },
  });
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    value: class FakeAudioContext {},
  });
});

describe("InlineComposer voice dictation", () => {
  it("records, transcribes, and inserts text into an empty draft", async () => {
    mockedStartVoiceCapture.mockResolvedValue(makeCapture());
    mockedBridge.transcribeEnvironmentVoice.mockResolvedValue({
      text: "Transcribed words",
    });

    renderComposer("");

    const startButton = await screen.findByRole("button", {
      name: "Start voice dictation",
    });
    await waitFor(() => {
      expect(startButton).toBeEnabled();
    });

    await userEvent.click(startButton);
    expect(mockedStartVoiceCapture).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Listening")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Stop voice dictation" }),
    );

    await waitFor(() => {
      expect(mockedBridge.transcribeEnvironmentVoice).toHaveBeenCalledWith({
        environmentId: "env-1",
        audioBase64: "dGVzdA==",
        durationMs: 1_200,
        mimeType: "audio/wav",
        sampleRateHz: 24_000,
      });
    });
    expect(await screen.findByDisplayValue("Transcribed words")).toBeInTheDocument();
  });

  it("appends transcript to an existing draft with one separator space", async () => {
    mockedStartVoiceCapture.mockResolvedValue(makeCapture());
    mockedBridge.transcribeEnvironmentVoice.mockResolvedValue({
      text: "add rollback coverage",
    });

    renderComposer("Plan:");

    const startButton = await screen.findByRole("button", {
      name: "Start voice dictation",
    });
    await waitFor(() => {
      expect(startButton).toBeEnabled();
    });

    await userEvent.click(startButton);
    await userEvent.click(
      await screen.findByRole("button", { name: "Stop voice dictation" }),
    );

    expect(
      await screen.findByDisplayValue("Plan: add rollback coverage"),
    ).toBeInTheDocument();
  });
});

function renderComposer(initialDraft: string) {
  function Harness() {
    const [draft, setDraft] = useState(initialDraft);
    const [mentionBindings, setMentionBindings] = useState<ComposerDraftMentionBinding[]>([]);

    return (
      <InlineComposer
        environmentId="env-1"
        threadId="thread-1"
        composer={baseComposer}
        collaborationModes={capabilitiesFixture.collaborationModes}
        disabled={false}
        draft={draft}
        effortOptions={["low", "medium", "high", "xhigh"]}
        focusKey="thread-1"
        isBusy={false}
        isSending={false}
        isRefiningPlan={false}
        mentionBindings={mentionBindings}
        modelOptions={capabilitiesFixture.models}
        tokenUsage={null}
        onCancelRefine={() => undefined}
        onChangeDraft={setDraft}
        onChangeMentionBindings={setMentionBindings}
        onInterrupt={() => undefined}
        onSend={() => undefined}
        onUpdateComposer={() => undefined}
      />
    );
  }

  return render(<Harness />);
}

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
