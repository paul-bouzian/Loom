import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeEnvironment,
  makeProject,
  makeWorkspaceSnapshot,
} from "../../test/fixtures/conversation";
import { useTerminalStore } from "../../stores/terminal-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { StudioMain } from "./StudioMain";

let latestEnvironmentActionControlProps: {
  environmentId: string | null;
  projectId: string | null;
} | null = null;
let latestOpenEnvironmentControlProps: {
  environmentId: string | null;
} | null = null;

vi.mock("../../shared/EnvironmentKindBadge", () => ({
  EnvironmentKindBadge: () => <div data-testid="environment-kind-badge" />,
}));

vi.mock("../../shared/RuntimeIndicator", () => ({
  RuntimeIndicator: () => <div data-testid="runtime-indicator" />,
}));

vi.mock("../../shared/Icons", () => ({
  PanelLeftIcon: () => <span data-testid="icon-panel-left" />,
  PanelRightIcon: () => <span data-testid="icon-panel-right" />,
  TerminalIcon: () => <span data-testid="icon-terminal" />,
  GlobeIcon: () => <span data-testid="icon-globe" />,
  ThreadIcon: () => <span data-testid="icon-thread" />,
}));

vi.mock("./EnvironmentActionControl", () => ({
  EnvironmentActionControl: (props: {
    environmentId: string | null;
    projectId: string | null;
  }) => {
    latestEnvironmentActionControlProps = props;
    return <div data-testid="environment-action-control" />;
  },
}));

vi.mock("./OpenEnvironmentControl", () => ({
  OpenEnvironmentControl: (props: { environmentId: string | null }) => {
    latestOpenEnvironmentControlProps = props;
    return <div data-testid="open-environment-control" />;
  },
}));

vi.mock("./ThreadTabs", () => ({
  ThreadTabs: () => <div data-testid="thread-tabs" />,
}));

vi.mock("./ThreadConversation", () => ({
  ThreadConversation: () => <div data-testid="thread-conversation" />,
}));

vi.mock("./draft/ThreadDraftComposer", async () => {
  const React = await import("react");

  return {
    ThreadDraftComposer: ({
      draft,
    }: {
      draft: { kind: "chat" } | { kind: "project"; projectId: string };
    }) => {
      const instanceId = React.useRef(Math.random().toString(36).slice(2)).current;
      return (
        <div
          data-testid="thread-draft-composer"
          data-instance-id={instanceId}
          data-draft-kind={draft.kind}
          data-project-id={draft.kind === "project" ? draft.projectId : ""}
        />
      );
    },
  };
});

vi.mock("./StudioWelcome", () => ({
  StudioWelcome: () => <div data-testid="studio-welcome" />,
}));

vi.mock("./TerminalPanel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));

function makeTerminalTab(id: string, ptyId: string, title: string) {
  return {
    id,
    ptyId,
    title,
    cwd: `/tmp/${title}`,
    exited: false,
    kind: "shell" as const,
  };
}

beforeEach(() => {
  latestEnvironmentActionControlProps = null;
  latestOpenEnvironmentControlProps = null;
  const snapshot = makeWorkspaceSnapshot({
    projects: [
      makeProject({
        environments: [
          makeEnvironment({
            id: "env-1",
            path: "/tmp/env-1",
            threads: [],
          }),
          makeEnvironment({
            id: "env-2",
            path: "/tmp/env-2",
            threads: [],
            isDefault: false,
          }),
        ],
      }),
    ],
  });

  useWorkspaceStore.setState((state) => ({
    ...state,
    snapshot,
    bootstrapStatus: null,
    loadingState: "ready",
    error: null,
    layout: {
      slots: {
        topLeft: null,
        topRight: null,
        bottomLeft: null,
        bottomRight: null,
      },
      focusedSlot: null,
      rowRatio: 0.5,
      colRatio: 0.5,
    },
    draftBySlot: {},
    selectedProjectId: "project-1",
    selectedEnvironmentId: "env-1",
    selectedThreadId: null,
  }));

  useTerminalStore.setState({
    knownEnvironmentIds: ["env-1", "env-2"],
    byEnv: {
      "env-1": {
        tabs: [makeTerminalTab("t1", "pty-1", "env-1")],
        activeTabId: "t1",
        visible: true,
        height: 280,
      },
      "env-2": {
        tabs: [],
        activeTabId: null,
        visible: false,
        height: 280,
      },
    },
  });
});

describe("StudioMain", () => {
  it("wraps the default workspace overview in the canonical pane scroll container", () => {
    const { container } = render(
      <StudioMain
        theme="dark"
        projectsSidebarOpen={false}
        inspectorOpen={false}
        browserOpen={false}
        composerFocusKey={0}
        approveOrSubmitKey={0}
        onToggleProjectsSidebar={() => {}}
        onToggleInspector={() => {}}
        onToggleBrowser={() => {}}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Workspace" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".studio-main__pane-scroll")).not.toBeNull();
  });

  it("uses the overview instead of onboarding when the workspace only has chats", () => {
    useWorkspaceStore.setState((state) => ({
      ...state,
      snapshot: makeWorkspaceSnapshot({
        projects: [],
      }),
      layout: {
        slots: {
          topLeft: null,
          topRight: null,
          bottomLeft: null,
          bottomRight: null,
        },
        focusedSlot: null,
        rowRatio: 0.5,
        colRatio: 0.5,
      },
      draftBySlot: {},
      selectedProjectId: null,
      selectedEnvironmentId: null,
      selectedThreadId: null,
    }));

    render(
      <StudioMain
        theme="dark"
        projectsSidebarOpen={false}
        inspectorOpen={false}
        browserOpen={false}
        composerFocusKey={0}
        approveOrSubmitKey={0}
        onToggleProjectsSidebar={() => {}}
        onToggleInspector={() => {}}
        onToggleBrowser={() => {}}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Workspace" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("studio-welcome")).toBeNull();
  });

  it("falls back to the workspace overview when a selected environment has no active thread", () => {
    act(() => {
      useWorkspaceStore.getState().selectEnvironment("env-1");
    });

    render(
      <StudioMain
        theme="dark"
        projectsSidebarOpen={false}
        inspectorOpen={false}
        browserOpen={false}
        composerFocusKey={0}
        approveOrSubmitKey={0}
        onToggleProjectsSidebar={() => {}}
        onToggleInspector={() => {}}
        onToggleBrowser={() => {}}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Start a new thread to begin working"),
    ).toBeNull();
  });

  it("treats the local environment as selected while a draft pane is focused", () => {
    useWorkspaceStore.setState((state) => ({
      ...state,
      layout: {
        slots: {
          topLeft: null,
          topRight: null,
          bottomLeft: null,
          bottomRight: null,
        },
        focusedSlot: null,
        rowRatio: 0.5,
        colRatio: 0.5,
      },
      draftBySlot: {},
      selectedProjectId: null,
      selectedEnvironmentId: null,
      selectedThreadId: null,
    }));
    useWorkspaceStore.getState().openThreadDraft("project-1");
    useTerminalStore.setState((state) => ({
      ...state,
      byEnv: {
        ...state.byEnv,
        "env-1": {
          ...state.byEnv["env-1"],
          visible: false,
        },
      },
    }));

    render(
      <StudioMain
        theme="dark"
        projectsSidebarOpen={false}
        inspectorOpen={false}
        browserOpen={false}
        composerFocusKey={0}
        approveOrSubmitKey={0}
        onToggleProjectsSidebar={() => {}}
        onToggleInspector={() => {}}
        onToggleBrowser={() => {}}
      />,
    );

    expect(useWorkspaceStore.getState().selectedEnvironmentId).toBeNull();
    expect(latestEnvironmentActionControlProps).toMatchObject({
      environmentId: "env-1",
      projectId: "project-1",
    });
    expect(latestOpenEnvironmentControlProps).toMatchObject({
      environmentId: "env-1",
    });
    expect(
      screen.getByRole("button", { name: "Show terminal" }),
    ).not.toBeDisabled();
  });

  it("keeps the same draft composer instance when the draft destination changes", () => {
    useWorkspaceStore.setState((state) => ({
      ...state,
      layout: {
        slots: {
          topLeft: {
            projectId: "skein-chat-workspace",
            environmentId: null,
            threadId: null,
          },
          topRight: null,
          bottomLeft: null,
          bottomRight: null,
        },
        focusedSlot: "topLeft",
        rowRatio: 0.5,
        colRatio: 0.5,
      },
      draftBySlot: {
        topLeft: { kind: "chat" },
      },
      selectedProjectId: "skein-chat-workspace",
      selectedEnvironmentId: null,
      selectedThreadId: null,
    }));

    render(
      <StudioMain
        theme="dark"
        projectsSidebarOpen={false}
        inspectorOpen={false}
        browserOpen={false}
        composerFocusKey={0}
        approveOrSubmitKey={0}
        onToggleProjectsSidebar={() => {}}
        onToggleInspector={() => {}}
        onToggleBrowser={() => {}}
      />,
    );

    const initialComposer = screen.getByTestId("thread-draft-composer");
    const initialInstanceId = initialComposer.getAttribute("data-instance-id");

    act(() => {
      useWorkspaceStore.getState().updateThreadDraftTarget("topLeft", {
        kind: "project",
        projectId: "project-1",
      });
    });

    const updatedComposer = screen.getByTestId("thread-draft-composer");
    expect(updatedComposer.getAttribute("data-instance-id")).toBe(initialInstanceId);
    expect(updatedComposer.getAttribute("data-draft-kind")).toBe("project");
    expect(updatedComposer.getAttribute("data-project-id")).toBe("project-1");
  });

  it("renders the browser toggle button between terminal and inspector", () => {
    const { container } = render(
      <StudioMain
        theme="dark"
        projectsSidebarOpen={false}
        inspectorOpen={false}
        browserOpen={false}
        composerFocusKey={0}
        approveOrSubmitKey={0}
        onToggleProjectsSidebar={() => {}}
        onToggleInspector={() => {}}
        onToggleBrowser={() => {}}
      />,
    );

    const actions = container.querySelector(".studio-main__toolbar-actions");
    expect(actions).not.toBeNull();
    const toggleButtons = actions!.querySelectorAll(
      ".studio-main__toggle-terminal, .studio-main__toggle-browser, .studio-main__toggle-inspector",
    );
    const classLists = Array.from(toggleButtons).map(
      (button) => button.className,
    );
    expect(classLists[0]).toContain("studio-main__toggle-terminal");
    expect(classLists[1]).toContain("studio-main__toggle-browser");
    expect(classLists[2]).toContain("studio-main__toggle-inspector");
  });

  it("shows the overview instead of project onboarding in a chat-only workspace", () => {
    useWorkspaceStore.setState((state) => ({
      ...state,
      snapshot: makeWorkspaceSnapshot({
        projects: [],
      }),
      layout: {
        slots: {
          topLeft: {
            projectId: "skein-chat-workspace",
            environmentId: null,
            threadId: null,
          },
          topRight: null,
          bottomLeft: null,
          bottomRight: null,
        },
        focusedSlot: "topLeft",
        rowRatio: 0.5,
        colRatio: 0.5,
      },
      draftBySlot: {},
      selectedProjectId: "skein-chat-workspace",
      selectedEnvironmentId: null,
      selectedThreadId: null,
    }));

    render(
      <StudioMain
        theme="dark"
        projectsSidebarOpen={false}
        inspectorOpen={false}
        browserOpen={false}
        composerFocusKey={0}
        approveOrSubmitKey={0}
        onToggleProjectsSidebar={() => {}}
        onToggleInspector={() => {}}
        onToggleBrowser={() => {}}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Workspace" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("studio-welcome")).toBeNull();
  });

  it("keeps TerminalPanel mounted when another environment still has tabs", () => {
    const { container } = render(
      <StudioMain
        theme="dark"
        projectsSidebarOpen={false}
        inspectorOpen={false}
        browserOpen={false}
        composerFocusKey={0}
        approveOrSubmitKey={0}
        onToggleProjectsSidebar={() => {}}
        onToggleInspector={() => {}}
        onToggleBrowser={() => {}}
      />,
    );

    expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
    expect(container.querySelector(".studio-main__terminal--hidden")).toBeNull();

    act(() => {
      useWorkspaceStore.setState({
        selectedEnvironmentId: "env-2",
        selectedThreadId: null,
      });
    });

    expect(screen.getByTestId("terminal-panel")).toBeInTheDocument();
    expect(container.querySelector(".studio-main__terminal--hidden")).not.toBeNull();
  });
});
