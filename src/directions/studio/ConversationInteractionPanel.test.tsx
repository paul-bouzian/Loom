import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { makeUserInputRequest } from "../../test/fixtures/conversation";
import { ConversationInteractionPanel } from "./ConversationInteractionPanel";

describe("ConversationInteractionPanel", () => {
  it("does not replay an old submit shortcut onto the next interaction", async () => {
    const onSubmitAnswers = vi.fn(async () => undefined);
    const onRespondApproval = vi.fn(async () => undefined);
    const firstInteraction = makeUserInputRequest({
      id: "interaction-1",
      questions: [],
    });
    const { rerender } = render(
      <ConversationInteractionPanel
        interaction={firstInteraction}
        provider="codex"
        queueCount={1}
        submitShortcutKey={0}
        onRespondApproval={onRespondApproval}
        onSubmitAnswers={onSubmitAnswers}
      />,
    );

    rerender(
      <ConversationInteractionPanel
        interaction={firstInteraction}
        provider="codex"
        queueCount={1}
        submitShortcutKey={1}
        onRespondApproval={onRespondApproval}
        onSubmitAnswers={onSubmitAnswers}
      />,
    );

    await waitFor(() => {
      expect(onSubmitAnswers).toHaveBeenCalledTimes(1);
    });

    rerender(
      <ConversationInteractionPanel
        interaction={makeUserInputRequest({
          id: "interaction-2",
          questions: [],
        })}
        provider="codex"
        queueCount={1}
        submitShortcutKey={1}
        onRespondApproval={onRespondApproval}
        onSubmitAnswers={onSubmitAnswers}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSubmitAnswers).toHaveBeenCalledTimes(1);
  });

  it("submits free-text answers for questions that support other responses", async () => {
    const onSubmitAnswers = vi.fn(async () => undefined);
    const onRespondApproval = vi.fn(async () => undefined);
    render(
      <ConversationInteractionPanel
        interaction={makeUserInputRequest({
          questions: [
            {
              ...makeUserInputRequest().questions[0],
              id: "question-custom",
              isOther: true,
            },
          ],
        })}
        provider="claude"
        queueCount={1}
        submitShortcutKey={0}
        onRespondApproval={onRespondApproval}
        onSubmitAnswers={onSubmitAnswers}
      />,
    );

    await userEvent.type(
      screen.getByPlaceholderText("Or write a custom answer"),
      "Réponse personnalisée",
    );
    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }));

    await waitFor(() => {
      expect(onSubmitAnswers).toHaveBeenCalledWith({
        "question-custom": ["Réponse personnalisée"],
      });
    });
  });
});
