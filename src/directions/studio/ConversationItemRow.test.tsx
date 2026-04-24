import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ConversationMessageItem } from "../../lib/types";
import { ConversationItemRow } from "./ConversationItemRow";

describe("ConversationItemRow", () => {
  it("labels Claude assistant messages as Claude", () => {
    render(
      <ConversationItemRow
        provider="claude"
        item={messageItem({ id: "assistant-claude", text: "Bonjour" })}
      />,
    );

    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.queryByText("Codex")).toBeNull();
  });
});

function messageItem(
  overrides: Partial<ConversationMessageItem> = {},
): ConversationMessageItem {
  return {
    kind: "message",
    id: "assistant-1",
    turnId: "turn-1",
    role: "assistant",
    text: "Ready.",
    images: null,
    isStreaming: false,
    ...overrides,
  };
}
