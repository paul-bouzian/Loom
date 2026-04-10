import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { useFirstPromptRenameStore } from "../../stores/first-prompt-rename-store";
import { FirstPromptRenameFailureNotice } from "./FirstPromptRenameFailureNotice";

describe("FirstPromptRenameFailureNotice", () => {
  beforeEach(() => {
    useFirstPromptRenameStore.setState({
      latestFailure: null,
      listenerReady: false,
    });
  });

  it("renders and dismisses the rename failure details", async () => {
    useFirstPromptRenameStore.setState({
      latestFailure: {
        projectId: "project-1",
        environmentId: "env-1",
        threadId: "thread-1",
        environmentName: "snowy-toad",
        branchName: "snowy-toad",
        message: "Codex timed out while generating a first prompt name.",
      },
    });

    render(<FirstPromptRenameFailureNotice />);

    expect(
      screen.getByRole("heading", {
        name: "Couldn't rename branch and worktree",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("snowy-toad / snowy-toad")).toBeInTheDocument();
    expect(
      screen.getByText("Codex timed out while generating a first prompt name."),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss rename failure notice" }),
    );

    expect(useFirstPromptRenameStore.getState().latestFailure).toBeNull();
  });
});
