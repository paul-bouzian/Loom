import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as terminalOutputBus from "../../lib/terminal-output-bus";
import { useBrowserStore } from "../../stores/browser-store";
import {
  useTerminalStore,
  type EnvironmentTerminalSlot,
} from "../../stores/terminal-store";
import { useLocalhostAutoDetect } from "./useLocalhostAutoDetect";

type Listener = (bytes: Uint8Array) => void;

const listeners = new Map<string, Listener[]>();

vi.mock("../../lib/terminal-output-bus", () => ({
  subscribeToTerminalOutput: vi.fn((ptyId: string, listener: Listener) => {
    const current = listeners.get(ptyId) ?? [];
    current.push(listener);
    listeners.set(ptyId, current);
    return () => {
      const set = listeners.get(ptyId);
      if (!set) return;
      const index = set.indexOf(listener);
      if (index >= 0) set.splice(index, 1);
      if (set.length === 0) listeners.delete(ptyId);
    };
  }),
}));

function emit(ptyId: string, text: string) {
  const bytes = new TextEncoder().encode(text);
  const set = listeners.get(ptyId);
  if (!set) return;
  for (const listener of set) {
    listener(bytes);
  }
}

function buildSlot(tabs: Array<{ id: string; ptyId: string }>): EnvironmentTerminalSlot {
  return {
    tabs: tabs.map((t) => ({
      id: t.id,
      ptyId: t.ptyId,
      title: t.id,
      cwd: "/tmp",
      exited: false,
      kind: "shell" as const,
    })),
    activeTabId: tabs[0]?.id ?? null,
    visible: true,
    height: 280,
  };
}

function Host() {
  useLocalhostAutoDetect();
  return null;
}

beforeEach(() => {
  listeners.clear();
  vi.clearAllMocks();
  useTerminalStore.setState({ byEnv: {}, knownEnvironmentIds: [] });
  useBrowserStore.setState({
    tabs: [],
    activeTabId: null,
    detectedUrls: [],
  });
});

afterEach(() => {
  listeners.clear();
});

describe("useLocalhostAutoDetect", () => {
  it("subscribes to every live pty and routes detected URLs to the browser store", () => {
    useTerminalStore.setState({
      byEnv: {
        "env-a": buildSlot([{ id: "tab-1", ptyId: "pty-1" }]),
        "env-b": buildSlot([{ id: "tab-2", ptyId: "pty-2" }]),
      },
      knownEnvironmentIds: ["env-a", "env-b"],
    });

    render(<Host />);

    expect(terminalOutputBus.subscribeToTerminalOutput).toHaveBeenCalledTimes(2);

    act(() => {
      emit("pty-1", "Local:   http://localhost:5173/\n");
    });
    act(() => {
      emit("pty-2", "server listening at http://127.0.0.1:3000\n");
    });

    const detected = useBrowserStore
      .getState()
      .detectedUrls.map((entry) => entry.url);
    expect(detected).toContain("http://localhost:5173/");
    expect(detected).toContain("http://127.0.0.1:3000");
  });

  it("unsubscribes when a tab is removed", () => {
    useTerminalStore.setState({
      byEnv: {
        "env-a": buildSlot([{ id: "tab-1", ptyId: "pty-1" }]),
      },
      knownEnvironmentIds: ["env-a"],
    });

    render(<Host />);
    expect(listeners.get("pty-1")?.length ?? 0).toBe(1);

    act(() => {
      useTerminalStore.setState({
        byEnv: {
          "env-a": buildSlot([]),
        },
      });
    });
    expect(listeners.get("pty-1")).toBeUndefined();
  });
});
