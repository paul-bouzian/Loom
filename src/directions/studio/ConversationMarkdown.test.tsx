import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { openExternalMock } from "../../test/desktop-mock";
import { ConversationMarkdown } from "./ConversationMarkdown";

const clipboardWriteTextMock = vi.fn();

beforeEach(() => {
  clipboardWriteTextMock.mockReset();
  clipboardWriteTextMock.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (...args: unknown[]) => clipboardWriteTextMock(...args),
    },
  });
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

    expect(openExternalMock).toHaveBeenCalledWith("https://openai.com/docs");
  });

  it("preserves markdown link titles while normalizing valid destinations", async () => {
    render(
      <ConversationMarkdown
        markdown={'See [OpenAI](https://openai.com/docs "API docs") before shipping.'}
      />,
    );

    const link = screen.getByRole("link", { name: "OpenAI" });
    expect(link).toHaveAttribute("href", "https://openai.com/docs");
    expect(link).toHaveAttribute("title", "API docs");

    await userEvent.click(link);

    expect(openExternalMock).toHaveBeenCalledWith("https://openai.com/docs");
  });

  it("renders local markdown targets as compact file reference tokens", () => {
    const filePath =
      "/Users/tester/.skein/worktrees/skein-019d5b55/lively-dolphin/src/directions/studio/ConversationMarkdown.tsx";
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

  it("preserves file reference links that include markdown titles", () => {
    render(
      <ConversationMarkdown
        markdown={'Updated [ConversationMarkdown.tsx](src/ConversationMarkdown.tsx:42 "Open file").'}
      />,
    );

    const token = screen.getByText("ConversationMarkdown.tsx");
    expect(token).toHaveClass("tx-markdown__file-ref");
    expect(token).toHaveAttribute("title", "src/ConversationMarkdown.tsx:42");
    expect(token).toHaveAttribute("data-file-path", "src/ConversationMarkdown.tsx");
    expect(token).toHaveAttribute("data-file-line", "42");
  });

  it("renders inline markdown inside file reference labels", () => {
    const filePath =
      "/Users/tester/.skein/worktrees/skein-019d5b55/lively-dolphin/src/directions/studio/ThreadConversation.tsx";

    render(
      <ConversationMarkdown
        markdown={`Updated [**ThreadConversation.tsx**](${filePath}) in this pass.`}
      />,
    );

    const token = screen.getByTitle(filePath);
    expect(token).toHaveClass("tx-markdown__file-ref");
    expect(screen.getByText("ThreadConversation.tsx").tagName).toBe("STRONG");
  });

  it("opens file references through the provided handler", async () => {
    const onFileReferenceClick = vi.fn();

    render(
      <ConversationMarkdown
        markdown={"Updated [ConversationMarkdown.tsx](src/ConversationMarkdown.tsx:42:7)."}
        onFileReferenceClick={onFileReferenceClick}
      />,
    );

    const token = screen.getByRole("button", {
      name: "Open ConversationMarkdown.tsx",
    });
    expect(token).toHaveClass("tx-markdown__file-ref");
    expect(token).toHaveAttribute("data-file-path", "src/ConversationMarkdown.tsx");
    expect(token).toHaveAttribute("data-file-line", "42");
    expect(token).toHaveAttribute("data-file-column", "7");

    await userEvent.click(token);

    expect(onFileReferenceClick).toHaveBeenCalledWith({
      rawTarget: "src/ConversationMarkdown.tsx:42:7",
      filePath: "src/ConversationMarkdown.tsx",
      line: 42,
      column: 7,
    });
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
    [
      "root-level file reference",
      "README.md#L8",
      "README.md",
      "8",
      null,
    ],
    [
      "non-whitelisted relative folder reference",
      "lib/utils.ts",
      "lib/utils.ts",
      null,
      null,
    ],
    [
      "parenthesized relative path reference",
      "src/app/(auth)/page.tsx:42",
      "src/app/(auth)/page.tsx",
      "42",
      null,
    ],
    [
      "windows absolute path reference",
      "C:\\repo\\src\\App.tsx:42",
      "C:\\repo\\src\\App.tsx",
      "42",
      null,
    ],
    [
      "common extensionless root file reference",
      "Dockerfile",
      "Dockerfile",
      null,
      null,
    ],
    [
      "common extensionless nested file reference",
      "infra/Makefile:9",
      "infra/Makefile",
      "9",
      null,
    ],
    [
      "common extensionless license reference",
      "LICENSE",
      "LICENSE",
      null,
      null,
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
      if (expectedLine) {
        expect(token).toHaveAttribute("data-file-line", expectedLine);
      } else {
        expect(token).not.toHaveAttribute("data-file-line");
      }
      if (expectedColumn) {
        expect(token).toHaveAttribute("data-file-column", expectedColumn);
      } else {
        expect(token).not.toHaveAttribute("data-file-column");
      }
    },
  );

  it("keeps parenthesized markdown targets intact until the matching closing parenthesis", () => {
    render(
      <ConversationMarkdown
        markdown={"Inspect [page.tsx](src/app/(auth)/page.tsx:42) before shipping."}
      />,
    );

    const token = screen.getByText("page.tsx");
    expect(token).toHaveAttribute("title", "src/app/(auth)/page.tsx:42");
    expect(token).toHaveAttribute("data-file-path", "src/app/(auth)/page.tsx");
    expect(token).toHaveAttribute("data-file-line", "42");
  });

  it("keeps windows paths with parenthesized folders intact while scanning markdown targets", () => {
    render(
      <ConversationMarkdown
        markdown={"Inspect [page.tsx](C:\\repo\\(auth)\\page.tsx:42) before shipping."}
      />,
    );

    const token = screen.getByText("page.tsx");
    expect(token).toHaveAttribute("title", "C:\\repo\\(auth)\\page.tsx:42");
    expect(token).toHaveAttribute("data-file-path", "C:\\repo\\(auth)\\page.tsx");
    expect(token).toHaveAttribute("data-file-line", "42");
  });

  it("keeps titled windows paths with parenthesized folders intact", () => {
    render(
      <ConversationMarkdown
        markdown={'Inspect [page.tsx](C:\\repo\\(auth)\\page.tsx:42 "Open file").'}
      />,
    );

    const token = screen.getByText("page.tsx");
    expect(token).toHaveAttribute("title", "C:\\repo\\(auth)\\page.tsx:42");
    expect(token).toHaveAttribute("data-file-path", "C:\\repo\\(auth)\\page.tsx");
    expect(token).toHaveAttribute("data-file-line", "42");
  });

  it.each([
    "www.example.com",
    "www.example.com:443",
    "Section 1.2",
    "v1.2.3",
  ])("leaves ambiguous dotted target %s as plain text", (rawTarget) => {
    const { container } = render(
      <ConversationMarkdown markdown={`Inspect [literal](${rawTarget}) before shipping.`} />,
    );

    expect(container.querySelector(".tx-markdown__file-ref")).toBeNull();
    expect(screen.queryByRole("link", { name: "literal" })).toBeNull();
    expect(container.textContent).toBe(`Inspect [literal](${rawTarget}) before shipping.`);
  });

  it("leaves non-http, non-local markdown targets as plain text", () => {
    const { container } = render(
      <ConversationMarkdown markdown={"Ignore [ratio](1/2) and keep it literal."} />,
    );

    expect(screen.queryByRole("link", { name: "ratio" })).toBeNull();
    expect(container.textContent).toBe("Ignore [ratio](1/2) and keep it literal.");
  });

  it("renders GFM tables instead of collapsing table rows into a paragraph", () => {
    const { container } = render(
      <ConversationMarkdown
        markdown={[
          "Comparison:",
          "",
          "| CV | OFF | ON | Delta | Statut |",
          "| --- | ---: | ---: | ---: | --- |",
          "| Abdu Yener | 91% | 87% | -4 | succeeded |",
          "| Alessandro Amoretti | 79% | 85% | +6 | succeeded |",
        ].join("\n")}
      />,
    );

    const table = container.querySelector(".tx-markdown__table");
    expect(table).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "CV" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Alessandro Amoretti" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "+6" })).toHaveStyle({ textAlign: "right" });
    expect(container.textContent).not.toContain("| --- |");
  });

  it("renders GFM task lists, strikethrough and footnotes", () => {
    const { container } = render(
      <ConversationMarkdown
        markdown={
          "- [x] Parsed tables\n- [ ] Review ~~legacy parser~~ output\n\nFootnote marker.[^1]\n\n[^1]: Verified through GFM."
        }
      />,
    );

    const checkboxes = container.querySelectorAll(".tx-markdown__task-checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
    expect(screen.getByText("legacy parser").tagName).toBe("DEL");
    expect(container.querySelector(".contains-task-list")).not.toBeNull();
    expect(container.querySelector(".task-list-item")).not.toBeNull();
    expect(container.querySelector(".footnotes")).not.toBeNull();
    expect(container.querySelector("[data-footnote-ref]")).not.toBeNull();
    expect(container.querySelector("[data-footnote-backref]")).not.toBeNull();
    expect(screen.getByText("Verified through GFM.")).toBeInTheDocument();
  });

  it("renders math while preserving literal dollars in prose", () => {
    const { container } = render(
      <ConversationMarkdown markdown={"Budget $400 and formula $x+1$.\n\n$$E=mc^2$$"} />,
    );

    expect(container.textContent).toContain("Budget $400");
    expect(container.querySelectorAll(".katex")).not.toHaveLength(0);
    expect(container.textContent).toContain("x+1");
    expect(container.textContent).toContain("E=mc");
  });

  it("does not render markdown images as remote image elements", () => {
    const { container } = render(
      <ConversationMarkdown markdown={"![diagram](https://example.com/diagram.png)"} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("[image: diagram]")).toHaveClass(
      "tx-markdown__image-placeholder",
    );
  });

  it("exposes a copy action for fenced code blocks", async () => {
    render(
      <ConversationMarkdown markdown={"```ts\nconst value = 1;\n```"} />,
    );

    expect(screen.getByText("ts")).toHaveClass("tx-markdown__code-language-label");
    await userEvent.click(screen.getByRole("button", { name: "Copy code" }));

    expect(clipboardWriteTextMock).toHaveBeenCalledWith("const value = 1;");
  });

  it("leaves markdown-looking content untouched inside indented fenced code blocks", () => {
    const { container } = render(
      <ConversationMarkdown
        markdown={[
          "- Debug output:",
          "  ```md",
          "  [literal](www.example.com:443)",
          "  Budget $400 and `inline`",
          "  ```",
        ].join("\n")}
      />,
    );

    const codeBlock = container.querySelector(".tx-markdown__code-block code");
    expect(codeBlock).toHaveTextContent("[literal](www.example.com:443)");
    expect(codeBlock).toHaveTextContent("Budget $400 and `inline`");
  });

  it("ignores code-copy completion after the code block unmounts", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let resolveClipboard: () => void = () => {};
      clipboardWriteTextMock.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveClipboard = resolve;
        }),
      );

      const { unmount } = render(
        <ConversationMarkdown markdown={"```ts\nconst value = 1;\n```"} />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Copy code" }));
      unmount();
      resolveClipboard();
      await Promise.resolve();

      expect(clipboardWriteTextMock).toHaveBeenCalledWith("const value = 1;");
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
