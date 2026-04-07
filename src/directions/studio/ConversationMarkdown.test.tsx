import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationMarkdown } from "./ConversationMarkdown";

const openUrlMock = vi.fn();

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrlMock(...args),
}));

beforeEach(() => {
  openUrlMock.mockReset();
});

describe("ConversationMarkdown", () => {
  it("renders markdown links as external links and opens them with the desktop opener", async () => {
    render(
      <ConversationMarkdown
        markdown={"See [OpenAI](https://openai.com/docs) for the protocol details."}
      />,
    );

    const link = screen.getByRole("link", { name: "OpenAI" });
    expect(link).toHaveAttribute("href", "https://openai.com/docs");

    await userEvent.click(link);

    expect(openUrlMock).toHaveBeenCalledWith("https://openai.com/docs");
  });

  it("renders local markdown targets as compact file reference tokens", () => {
    const filePath =
      "/Users/paulbouzian/.threadex/worktrees/threadex-019d5b55/lively-dolphin/src/directions/studio/ConversationMarkdown.tsx";
    const { container } = render(
      <ConversationMarkdown
        markdown={`Updated [ConversationMarkdown.tsx](${filePath}) in this pass.`}
      />,
    );

    const token = screen.getByText("ConversationMarkdown.tsx");
    expect(token.tagName).toBe("SPAN");
    expect(token).toHaveClass("tx-markdown__file-ref");
    expect(token).toHaveAttribute("title", filePath);
    expect(token).toHaveAttribute("data-file-path", filePath);
    expect(token).not.toHaveAttribute("data-file-line");
    expect(token).not.toHaveAttribute("data-file-column");
    expect(
      screen.queryByRole("link", { name: "ConversationMarkdown.tsx" }),
    ).toBeNull();
    expect(container.textContent).toBe("Updated ConversationMarkdown.tsx in this pass.");
  });

  it.each([
    [
      "colon line reference",
      "src/directions/studio/ConversationMarkdown.tsx:42",
      "src/directions/studio/ConversationMarkdown.tsx",
      "42",
      null,
    ],
    [
      "colon line and column reference",
      "src/directions/studio/ConversationMarkdown.tsx:42:7",
      "src/directions/studio/ConversationMarkdown.tsx",
      "42",
      "7",
    ],
    [
      "hash line reference",
      "src/directions/studio/ConversationMarkdown.tsx#L42",
      "src/directions/studio/ConversationMarkdown.tsx",
      "42",
      null,
    ],
    [
      "hash line and column reference",
      "src/directions/studio/ConversationMarkdown.tsx#L42C7",
      "src/directions/studio/ConversationMarkdown.tsx",
      "42",
      "7",
    ],
  ])(
    "parses %s metadata from file references",
    (_name, rawTarget, expectedPath, expectedLine, expectedColumn) => {
      render(
        <ConversationMarkdown
          markdown={`Inspect [ConversationMarkdown.tsx](${rawTarget}) before shipping.`}
        />,
      );

      const token = screen.getByText("ConversationMarkdown.tsx");
      expect(token).toHaveAttribute("title", rawTarget);
      expect(token).toHaveAttribute("data-file-path", expectedPath);
      expect(token).toHaveAttribute("data-file-line", expectedLine);
      if (expectedColumn) {
        expect(token).toHaveAttribute("data-file-column", expectedColumn);
      } else {
        expect(token).not.toHaveAttribute("data-file-column");
      }
    },
  );

  it("leaves non-http, non-local markdown targets as plain text", () => {
    const { container } = render(
      <ConversationMarkdown markdown={"Ignore [ratio](1/2) and keep it literal."} />,
    );

    expect(screen.queryByRole("link", { name: "ratio" })).toBeNull();
    expect(container.textContent).toBe("Ignore [ratio](1/2) and keep it literal.");
  });
});
