import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as bridge from "../../lib/bridge";
import { makeWorkspaceSnapshot } from "../../test/fixtures/conversation";
import {
  selectEnvironmentTerminalUi,
  useTerminalStore,
} from "../../stores/terminal-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { StudioMain } from "./StudioMain";

vi.mock("../../lib/bridge", () => ({
  closeEnvironmentTerminal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./ThreadTabs", () => ({
  ThreadTabs: () => <div data-testid="thread-tabs" />,
}));

vi.mock("./ThreadConversation", () => ({
  ThreadConversation: () => <div data-testid="thread-conversation" />,
}));

vi.mock("./StudioWelcome", () => ({
  StudioWelcome: () => <div data-testid="studio-welcome" />,
}));

vi.mock("./terminal/TerminalDock", () => ({
  TerminalDock: ({
    tabs,
    activeTerminalId,
    onCloseTerminal,
    onResizeStart,
  }: {
    tabs: Array<{ id: string; title: string }>;
    activeTerminalId: string | null;
    onCloseTerminal: (terminalId: string) => void;
    onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
  }) => (
    <div data-testid="terminal-dock">
      <div data-testid="terminal-resizer" onMouseDown={onResizeStart} />
      {tabs.map((tab) => (
        <div key={tab.id}>
          <span>
            {tab.title}:{tab.id === activeTerminalId ? "active" : "idle"}
          </span>
          <button type="button" onClick={() => onCloseTerminal(tab.id)}>
            close-{tab.title}
          </button>
        </div>
      ))}
    </div>
  ),
}));

const mockedBridge = vi.mocked(bridge);

describe("StudioMain", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    mockedBridge.closeEnvironmentTerminal.mockClear();
    mockedBridge.closeEnvironmentTerminal.mockResolvedValue(undefined);
    useTerminalStore.setState({ environments: {} });
    useWorkspaceStore.setState((state) => ({
      ...state,
      snapshot: makeWorkspaceSnapshot(),
      loadingState: "ready",
      selectedProjectId: "project-1",
      selectedEnvironmentId: "env-1",
      selectedThreadId: "thread-1",
    }));
  });

  it("renders a terminal toggle and creates the first terminal tab when opened", async () => {
    render(<StudioMain inspectorOpen onToggleInspector={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Show terminal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide inspector" }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Show terminal" }),
    );

    expect(screen.getByTestId("terminal-dock")).toBeInTheDocument();
    expect(screen.getByText(/Terminal 1:active/i)).toBeInTheDocument();
  });

  it("hides the terminal toggle when no environment is selected", () => {
    useWorkspaceStore.setState((state) => ({
      ...state,
      selectedEnvironmentId: null,
      selectedThreadId: null,
    }));

    render(<StudioMain inspectorOpen={false} onToggleInspector={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /terminal/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show inspector" }),
    ).toBeInTheDocument();
  });

  it("cleans up resize drag state on window blur", async () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 960,
        height: 640,
        top: 0,
        right: 960,
        bottom: 640,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);

    render(<StudioMain inspectorOpen={false} onToggleInspector={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Show terminal" }),
    );

    fireEvent.mouseDown(screen.getByTestId("terminal-resizer"), {
      clientY: 400,
    });
    expect(document.body.style.cursor).toBe("row-resize");
    expect(document.body.style.userSelect).toBe("none");

    window.dispatchEvent(new Event("blur"));
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 200 }));
    expect(
      selectEnvironmentTerminalUi("env-1")(useTerminalStore.getState())
        .heightPx,
    ).toBe(280);

    rectSpy.mockRestore();
  });

  it("keeps the terminal tab visible when backend close fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockedBridge.closeEnvironmentTerminal.mockRejectedValueOnce(
      new Error("close failed"),
    );

    render(<StudioMain inspectorOpen={false} onToggleInspector={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Show terminal" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "close-Terminal 1" }),
    );

    expect(mockedBridge.closeEnvironmentTerminal).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("terminal-dock")).toBeInTheDocument();
    expect(screen.getByText(/Terminal 1:active/i)).toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it("clamps restored terminal height when the workspace body is smaller", async () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 960,
        height: 300,
        top: 0,
        right: 960,
        bottom: 300,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);

    useTerminalStore.setState({
      environments: {
        "env-1": {
          open: true,
          heightPx: 280,
          tabs: [{ id: "terminal-1", title: "Terminal 1" }],
          activeTerminalId: "terminal-1",
        },
      },
    });

    render(<StudioMain inspectorOpen={false} onToggleInspector={vi.fn()} />);

    await waitFor(() => {
      expect(
        selectEnvironmentTerminalUi("env-1")(useTerminalStore.getState())
          .heightPx,
      ).toBe(195);
    });

    rectSpy.mockRestore();
  });
});
