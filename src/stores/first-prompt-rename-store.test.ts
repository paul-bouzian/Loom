import { beforeEach, describe, expect, it, vi } from "vitest";

import * as bridge from "../lib/bridge";
import {
  teardownFirstPromptRenameListener,
  useFirstPromptRenameStore,
} from "./first-prompt-rename-store";

vi.mock("../lib/bridge", () => ({
  listenToFirstPromptRenameFailures: vi.fn(async () => () => undefined),
}));

const mockedBridge = vi.mocked(bridge);

describe("first prompt rename store", () => {
  beforeEach(() => {
    teardownFirstPromptRenameListener();
    mockedBridge.listenToFirstPromptRenameFailures.mockReset();
    mockedBridge.listenToFirstPromptRenameFailures.mockResolvedValue(
      () => undefined,
    );
  });

  it("captures and dismisses the latest rename failure", async () => {
    const listeners: Parameters<
      typeof bridge.listenToFirstPromptRenameFailures
    >[0][] = [];
    mockedBridge.listenToFirstPromptRenameFailures.mockImplementation(
      async (nextListener) => {
        listeners.push(nextListener);
        return () => undefined;
      },
    );

    await useFirstPromptRenameStore.getState().initializeListener();

    expect(listeners).toHaveLength(1);
    listeners[0]?.({
      projectId: "project-1",
      environmentId: "env-1",
      threadId: "thread-1",
      environmentName: "snowy-toad",
      branchName: "snowy-toad",
      message: "Codex timed out while generating a first prompt name.",
    });

    expect(useFirstPromptRenameStore.getState().latestFailure?.message).toBe(
      "Codex timed out while generating a first prompt name.",
    );

    useFirstPromptRenameStore.getState().dismissLatestFailure();

    expect(useFirstPromptRenameStore.getState().latestFailure).toBeNull();
  });
});
