import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TERMINAL_HEIGHT_PX,
  MIN_TERMINAL_HEIGHT_PX,
  selectEnvironmentTerminalUi,
  useTerminalStore,
} from "./terminal-store";

const STORAGE_KEY = "threadex-terminal-ui:v1";

describe("terminal-store", () => {
  beforeEach(() => {
    const storage = new Map<string, string>([[STORAGE_KEY, "{}"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    });
    useTerminalStore.setState({
      environments: {},
    });
  });

  it("creates the first terminal and opens the panel on demand", () => {
    const terminalId = useTerminalStore.getState().ensurePanel("env-1");
    const state = selectEnvironmentTerminalUi("env-1")(useTerminalStore.getState());

    expect(terminalId).toBeTruthy();
    expect(state.open).toBe(true);
    expect(state.heightPx).toBe(DEFAULT_TERMINAL_HEIGHT_PX);
    expect(state.tabs).toEqual([{ id: terminalId, title: "Terminal 1" }]);
    expect(state.activeTerminalId).toBe(terminalId);
  });

  it("creates sequentially numbered terminals and renumbers after close", () => {
    const first = useTerminalStore.getState().ensurePanel("env-1");
    const second = useTerminalStore.getState().createTerminal("env-1");
    const third = useTerminalStore.getState().createTerminal("env-1");

    useTerminalStore.getState().closeTerminal("env-1", second);

    const state = selectEnvironmentTerminalUi("env-1")(useTerminalStore.getState());
    expect(state.tabs).toEqual([
      { id: first, title: "Terminal 1" },
      { id: third, title: "Terminal 2" },
    ]);
    expect(state.activeTerminalId).toBe(third);
  });

  it("closes the panel when the last terminal is removed", () => {
    const first = useTerminalStore.getState().ensurePanel("env-1");

    useTerminalStore.getState().closeTerminal("env-1", first);

    const state = selectEnvironmentTerminalUi("env-1")(useTerminalStore.getState());
    expect(state.open).toBe(false);
    expect(state.tabs).toEqual([]);
    expect(state.activeTerminalId).toBeNull();
  });

  it("clamps terminal height and prunes removed environments", () => {
    useTerminalStore.getState().ensurePanel("env-1");
    useTerminalStore.getState().ensurePanel("env-2");
    useTerminalStore.getState().setHeight("env-1", 80);
    useTerminalStore.getState().pruneEnvironments(["env-1"]);

    const state = selectEnvironmentTerminalUi("env-1")(useTerminalStore.getState());
    expect(state.heightPx).toBe(MIN_TERMINAL_HEIGHT_PX);
    expect(useTerminalStore.getState().environments["env-2"]).toBeUndefined();
  });

  it("hydrates malformed stored tabs without dropping other environments", async () => {
    localStorage.setItem(
      "threadex-terminal-ui:v1",
      JSON.stringify({
        "env-bad": {
          open: true,
          heightPx: 320,
          tabs: {},
          activeTerminalId: "missing",
        },
        "env-good": {
          open: true,
          heightPx: 360,
          tabs: [{ id: "terminal-1", title: "Old title" }],
          activeTerminalId: "terminal-1",
        },
      }),
    );

    vi.resetModules();
    const terminalStoreModule = await import("./terminal-store");

    const badState = terminalStoreModule.selectEnvironmentTerminalUi("env-bad")(
      terminalStoreModule.useTerminalStore.getState(),
    );
    const goodState = terminalStoreModule.selectEnvironmentTerminalUi("env-good")(
      terminalStoreModule.useTerminalStore.getState(),
    );

    expect(badState).toEqual({
      open: false,
      heightPx: 320,
      tabs: [],
      activeTerminalId: null,
    });
    expect(goodState).toEqual({
      open: true,
      heightPx: 360,
      tabs: [{ id: "terminal-1", title: "Terminal 1" }],
      activeTerminalId: "terminal-1",
    });
  });
});
