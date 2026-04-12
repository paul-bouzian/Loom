import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeGlobalSettings } from "../../test/fixtures/conversation";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { OpenInSettingsTab } from "./OpenInSettingsTab";

type UpdateGlobalSettingsResult = {
  ok: boolean;
  refreshed: boolean;
  warningMessage: string | null;
  errorMessage: string | null;
  settings: ReturnType<typeof makeGlobalSettings> | null;
};

describe("OpenInSettingsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
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

    await user.click(screen.getByRole("button", { name: /Move Cursor down/i }));
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
          settings.openTargets[1]!,
          settings.openTargets[0]!,
          ...settings.openTargets.slice(2),
        ],
      }),
    });

    await waitFor(() => {
      expect(updateGlobalSettings).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps reordering local until Save is clicked", async () => {
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

    await user.click(screen.getByRole("button", { name: /Move Cursor down/i }));

    expect(updateGlobalSettings).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateGlobalSettings).toHaveBeenCalledWith({
        openTargets: [
          makeGlobalSettings().openTargets[1],
          makeGlobalSettings().openTargets[0],
          ...makeGlobalSettings().openTargets.slice(2),
        ],
        defaultOpenTargetId: "file-manager",
      });
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

    await user.click(screen.getAllByRole("radio", { name: /Default/ })[1]!);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateGlobalSettings).toHaveBeenCalledWith({
        openTargets: makeGlobalSettings().openTargets,
        defaultOpenTargetId: "zed",
      });
    });
  });

  it("keeps in-progress ordering when props refresh with equivalent values", async () => {
    const user = userEvent.setup();
    const settings = makeGlobalSettings();
    const { rerender } = render(
      <OpenInSettingsTab
        targets={settings.openTargets}
        defaultTargetId={settings.defaultOpenTargetId}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Move Cursor down/i }));

    rerender(
      <OpenInSettingsTab
        targets={settings.openTargets.map((target) => ({ ...target }))}
        defaultTargetId={settings.defaultOpenTargetId}
      />,
    );

    const moveCursorUpButtons = screen.getAllByRole("button", { name: /Move Cursor up/i });
    expect(moveCursorUpButtons[0]).toBeEnabled();
  });
});
