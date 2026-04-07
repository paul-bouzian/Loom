import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  makeEnvironment,
  makeProject,
  makeThread,
  makeWorkspaceSnapshot,
} from "../../test/fixtures/conversation";
import { resetVoiceSessionStore, useVoiceSessionStore } from "../../stores/voice-session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { StudioStatusBar } from "./StudioStatusBar";

beforeEach(async () => {
  await resetVoiceSessionStore();
  useWorkspaceStore.setState((state) => ({
    ...state,
    snapshot: makeWorkspaceSnapshot({
      projects: [
        makeProject({
          environments: [
            makeEnvironment({
              id: "env-1",
              name: "Worktree A",
              threads: [makeThread({ id: "thread-1", environmentId: "env-1", title: "Thread 1" })],
            }),
            makeEnvironment({
              id: "env-2",
              name: "Worktree B",
              threads: [makeThread({ id: "thread-2", environmentId: "env-2", title: "Thread 2" })],
            }),
          ],
        }),
      ],
    }),
    selectedProjectId: "project-1",
    selectedEnvironmentId: "env-2",
    selectedThreadId: "thread-2",
  }));
});

describe("StudioStatusBar", () => {
  it("shows a passive voice indicator away from the owner thread and navigates back on click", async () => {
    useVoiceSessionStore.setState((state) => ({
      ...state,
      durationMs: 12_000,
      ownerEnvironmentId: "env-1",
      ownerThreadId: "thread-1",
      phase: "recording",
    }));

    render(<StudioStatusBar />);

    const indicator = screen.getByRole("button", {
      name: /Listening in Thread 1/i,
    });
    expect(indicator).toHaveTextContent("00:12");

    await userEvent.click(indicator);

    expect(useWorkspaceStore.getState().selectedThreadId).toBe("thread-1");
    expect(useWorkspaceStore.getState().selectedEnvironmentId).toBe("env-1");
  });

  it("hides the passive indicator on the owner thread", () => {
    useWorkspaceStore.setState((state) => ({
      ...state,
      selectedEnvironmentId: "env-1",
      selectedThreadId: "thread-1",
    }));
    useVoiceSessionStore.setState((state) => ({
      ...state,
      durationMs: 5_000,
      ownerEnvironmentId: "env-1",
      ownerThreadId: "thread-1",
      phase: "recording",
    }));

    render(<StudioStatusBar />);

    expect(
      screen.queryByRole("button", { name: /Listening in Thread 1/i }),
    ).toBeNull();
  });
});
