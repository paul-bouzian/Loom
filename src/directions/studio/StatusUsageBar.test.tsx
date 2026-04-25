import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  makeEnvironment,
  makeProject,
  makeThread,
  makeWorkspaceSnapshot,
} from "../../test/fixtures/conversation";
import { useClaudeUsageStore } from "../../stores/claude-usage-store";
import { useCodexUsageStore } from "../../stores/codex-usage-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { StatusUsageBar } from "./StatusUsageBar";

beforeEach(() => {
  const now = Date.now();
  useWorkspaceStore.setState((state) => ({
    ...state,
    snapshot: makeWorkspaceSnapshot({
      projects: [
        makeProject({
          environments: [
            makeEnvironment({
              id: "env-1",
              threads: [makeThread({ environmentId: "env-1" })],
            }),
          ],
        }),
      ],
    }),
    selectedEnvironmentId: "env-1",
  }));
  useCodexUsageStore.setState((state) => ({
    ...state,
    snapshot: {
      primary: { usedPercent: 18, windowDurationMins: 300 },
      secondary: { usedPercent: 42, windowDurationMins: 10_080 },
    },
    loading: false,
    error: null,
    lastFetchedAt: now,
  }));
  useClaudeUsageStore.setState((state) => ({
    ...state,
    snapshot: {
      provider: "claude",
      primary: { usedPercent: 7, windowDurationMins: 300 },
      secondary: { usedPercent: 13, windowDurationMins: 10_080 },
      updatedAt: now,
      error: null,
      status: "ok",
    },
    loading: false,
    error: null,
    lastFetchedAt: now,
  }));
});

describe("StatusUsageBar", () => {
  it("renders compact Claude and OpenAI usage in the status bar", () => {
    render(<StatusUsageBar />);

    expect(screen.getByLabelText("Provider usage")).toBeInTheDocument();
    expect(screen.getByLabelText("Claude usage")).toBeInTheDocument();
    expect(screen.getByLabelText("OpenAI usage")).toBeInTheDocument();
    expect(screen.getByText("93% 5h")).toBeInTheDocument();
    expect(screen.getByText("87% wk")).toBeInTheDocument();
    expect(screen.getByText("82% 5h")).toBeInTheDocument();
    expect(screen.getByText("58% wk")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh provider usage" }),
    ).toBeInTheDocument();
  });

  it("surfaces initial provider usage fetch failures", () => {
    useCodexUsageStore.setState((state) => ({
      ...state,
      snapshot: null,
      loading: false,
      error: "Codex usage failed",
    }));
    useClaudeUsageStore.setState((state) => ({
      ...state,
      snapshot: null,
      loading: false,
      error: "Claude usage failed",
    }));

    render(<StatusUsageBar />);

    expect(screen.getByLabelText("OpenAI: Codex usage failed")).toBeInTheDocument();
    expect(screen.getByLabelText("Claude: Claude usage failed")).toBeInTheDocument();
    expect(screen.getByTitle("OpenAI: Codex usage failed")).toHaveTextContent("!");
    expect(screen.getByTitle("Claude: Claude usage failed")).toHaveTextContent("!");
  });

  it("derives usage window labels from provider durations", () => {
    useCodexUsageStore.setState((state) => ({
      ...state,
      snapshot: {
        primary: { usedPercent: 20, windowDurationMins: 60 },
        secondary: { usedPercent: 40, windowDurationMins: 1_440 },
      },
    }));
    useClaudeUsageStore.setState((state) => ({
      ...state,
      snapshot: {
        provider: "claude",
        primary: { usedPercent: 10, windowDurationMins: 90 },
        secondary: { usedPercent: 25, windowDurationMins: 20_160 },
        updatedAt: Date.now(),
        error: null,
        status: "ok",
      },
    }));

    render(<StatusUsageBar />);

    expect(screen.getByText("90% 90m")).toBeInTheDocument();
    expect(screen.getByText("75% 2wk")).toBeInTheDocument();
    expect(screen.getByText("80% 1h")).toBeInTheDocument();
    expect(screen.getByText("60% 1d")).toBeInTheDocument();
  });
});
