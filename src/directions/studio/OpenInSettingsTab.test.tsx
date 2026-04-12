import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as bridge from "../../lib/bridge";
import { makeGlobalSettings } from "../../test/fixtures/conversation";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { OpenInSettingsTab } from "./OpenInSettingsTab";
import { resetOpenAppIconCacheForTests } from "./useOpenAppIcons";

vi.mock("../../lib/bridge", () => ({
  getOpenAppIcon: vi.fn(),
}));

type UpdateGlobalSettingsResult = Awaited<
  Promise<{
    ok: boolean;
    refreshed: boolean;
    warningMessage: string | null;
    errorMessage: string | null;
    settings: ReturnType<typeof makeGlobalSettings> | null;
  }>
>;

describe("OpenInSettingsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOpenAppIconCacheForTests();
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    vi.mocked(bridge.getOpenAppIcon).mockResolvedValue(null);
    useWorkspaceStore.setState({
      updateGlobalSettings: vi.fn(async () => ({
        ok: true,
        refreshed: true,
        warningMessage: null,
        errorMessage: null,
        settings: makeGlobalSettings(),
      })),
    });
  });

  it("keeps Save disabled during an in-flight save when equivalent props refresh", async () => {
    const user = userEvent.setup();
    const settings = makeGlobalSettings();
    let resolveSave!: (value: UpdateGlobalSettingsResult) => void;
    const updateGlobalSettings = vi.fn(
      () =>
        new Promise<UpdateGlobalSettingsResult>((resolve) => {
          resolveSave = resolve;
        }),
    );
    useWorkspaceStore.setState({ updateGlobalSettings });

    const { rerender } = render(
      <OpenInSettingsTab
        targets={settings.openTargets}
        defaultTargetId={settings.defaultOpenTargetId}
      />,
    );

    const labelInput = screen.getAllByLabelText("Label")[0];
    await user.clear(labelInput);
    await user.type(labelInput, "Cursor Pro");
    await user.click(screen.getByRole("button", { name: "Save" }));

    rerender(
      <OpenInSettingsTab
        targets={settings.openTargets.map((target) => ({ ...target }))}
        defaultTargetId={settings.defaultOpenTargetId}
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    resolveSave({
      ok: true,
      refreshed: true,
      warningMessage: null,
      errorMessage: null,
      settings: makeGlobalSettings({
        openTargets: [
          {
            id: "cursor",
            label: "Cursor Pro",
            kind: "app",
            appName: "Cursor",
            args: [],
          },
          ...settings.openTargets.slice(1),
        ],
      }),
    });

    await waitFor(() => {
      expect(updateGlobalSettings).toHaveBeenCalledTimes(1);
    });
  });

  it("loads installed app icons for the curated targets and keeps Finder local", async () => {
    render(
      <OpenInSettingsTab
        targets={makeGlobalSettings().openTargets}
        defaultTargetId={makeGlobalSettings().defaultOpenTargetId}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByDisplayValue("Cursor").length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(bridge.getOpenAppIcon).toHaveBeenCalledWith("Cursor");
    });
    expect(bridge.getOpenAppIcon).toHaveBeenCalledWith("Zed");
    expect(bridge.getOpenAppIcon).toHaveBeenCalledTimes(2);
  });

  it("keeps edits local until Save is clicked", async () => {
    const user = userEvent.setup();
    const updateGlobalSettings = vi.fn(async () => ({
      ok: true,
      refreshed: true,
      warningMessage: null,
      errorMessage: null,
      settings: makeGlobalSettings(),
    }));
    useWorkspaceStore.setState({ updateGlobalSettings });

    render(
      <OpenInSettingsTab
        targets={makeGlobalSettings().openTargets}
        defaultTargetId={makeGlobalSettings().defaultOpenTargetId}
      />,
    );

    const labelInput = screen.getAllByLabelText("Label")[0];
    await user.clear(labelInput);
    await user.type(labelInput, "Cursor Pro");

    expect(updateGlobalSettings).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateGlobalSettings).toHaveBeenCalledTimes(1);
    });
    expect(updateGlobalSettings).toHaveBeenCalledWith({
      openTargets: [
        {
          id: "cursor",
          label: "Cursor Pro",
          kind: "app",
          appName: "Cursor",
          args: [],
        },
        {
          id: "zed",
          label: "Zed",
          kind: "app",
          appName: "Zed",
          args: [],
        },
        {
          id: "file-manager",
          label: "Finder",
          kind: "fileManager",
          appName: null,
          args: [],
        },
      ],
      defaultOpenTargetId: "file-manager",
    });
  });

  it("saves a changed default target", async () => {
    const user = userEvent.setup();
    const updateGlobalSettings = vi.fn(async () => ({
      ok: true,
      refreshed: true,
      warningMessage: null,
      errorMessage: null,
      settings: makeGlobalSettings({ defaultOpenTargetId: "zed" }),
    }));
    useWorkspaceStore.setState({ updateGlobalSettings });

    render(
      <OpenInSettingsTab
        targets={makeGlobalSettings().openTargets}
        defaultTargetId={makeGlobalSettings().defaultOpenTargetId}
      />,
    );

    await user.click(screen.getAllByRole("radio", { name: /Default/ })[1]);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateGlobalSettings).toHaveBeenCalledWith({
        openTargets: makeGlobalSettings().openTargets,
        defaultOpenTargetId: "zed",
      });
    });
  });

  it("keeps in-progress edits when props refresh with equivalent values", async () => {
    const user = userEvent.setup();
    const settings = makeGlobalSettings();
    const { rerender } = render(
      <OpenInSettingsTab
        targets={settings.openTargets}
        defaultTargetId={settings.defaultOpenTargetId}
      />,
    );

    const labelInput = screen.getAllByLabelText("Label")[0];
    await user.clear(labelInput);
    await user.type(labelInput, "Cursor Pro");

    rerender(
      <OpenInSettingsTab
        targets={settings.openTargets.map((target) => ({ ...target }))}
        defaultTargetId={settings.defaultOpenTargetId}
      />,
    );

    expect(screen.getAllByLabelText("Label")[0]).toHaveValue("Cursor Pro");
  });

  it("shows global validation errors before save is attempted", async () => {
    const user = userEvent.setup();
    render(
      <OpenInSettingsTab
        targets={makeGlobalSettings().openTargets}
        defaultTargetId={makeGlobalSettings().defaultOpenTargetId}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Remove Cursor/i }));
    await user.click(screen.getByRole("button", { name: /Remove Zed/i }));
    await user.click(screen.getByRole("button", { name: /Remove Finder/i }));

    expect(screen.getByText("Add at least one Open In target.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
