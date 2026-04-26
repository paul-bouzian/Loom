import { describe, expect, it } from "vitest";

import { makeConversationSnapshot } from "../../test/fixtures/conversation";
import { buildConversationTimeline } from "./conversation-work-activity";

describe("buildConversationTimeline", () => {
  it("keeps handoff history outside the active work activity", () => {
    const entries = buildConversationTimeline(
      makeConversationSnapshot({
        status: "running",
        activeTurnId: "turn-paris",
        items: [
          {
            kind: "message",
            id: "handoff-user-bordeaux",
            role: "user",
            text: "Tu peux me donner la météo de Bordeaux ?",
            images: null,
            isStreaming: false,
          },
          {
            kind: "message",
            id: "handoff-assistant-bordeaux",
            role: "assistant",
            text: "Météo à Bordeaux : journée agréable.",
            images: null,
            isStreaming: false,
          },
          {
            kind: "message",
            id: "local-user-paris",
            role: "user",
            text: "Merci, et pour Paris ?",
            images: null,
            isStreaming: false,
          },
          {
            kind: "reasoning",
            id: "reason-paris",
            turnId: "turn-paris",
            summary: "Searching Paris weather",
            content: "Looking up Paris forecasts.",
            isStreaming: true,
          },
          {
            kind: "tool",
            id: "tool-paris",
            turnId: "turn-paris",
            toolType: "webSearch",
            title: "Web search",
            status: "completed",
            summary: "Paris weather",
            output: "Forecast data",
          },
          {
            kind: "message",
            id: "assistant-paris-draft",
            role: "assistant",
            text: "For Paris, tomorrow...",
            images: null,
            isStreaming: true,
          },
        ],
      }),
    );

    const itemIds = entries.flatMap((entry) =>
      entry.kind === "item" ? [entry.item.id] : [],
    );
    const [workActivity] = entries.flatMap((entry) =>
      entry.kind === "workActivity" ? [entry] : [],
    );

    expect(itemIds).toEqual([
      "handoff-user-bordeaux",
      "handoff-assistant-bordeaux",
      "local-user-paris",
      "assistant-paris-draft",
    ]);
    expect(workActivity?.kind).toBe("workActivity");
    expect(workActivity?.group.items.map((item) => item.id)).toEqual([
      "reason-paris",
      "tool-paris",
    ]);
  });

  it("keeps handoff history outside completed follow-up work activity", () => {
    const entries = buildConversationTimeline(
      makeConversationSnapshot({
        status: "completed",
        activeTurnId: null,
        items: [
          {
            kind: "message",
            id: "handoff-user-bordeaux",
            role: "user",
            text: "Tu peux me donner la météo de Bordeaux ?",
            images: null,
            isStreaming: false,
          },
          {
            kind: "message",
            id: "handoff-assistant-bordeaux",
            role: "assistant",
            text: "Météo à Bordeaux : journée agréable.",
            images: null,
            isStreaming: false,
          },
          {
            kind: "message",
            id: "user-paris",
            turnId: "turn-paris",
            role: "user",
            text: "Merci, et pour Paris ?",
            images: null,
            isStreaming: false,
          },
          {
            kind: "reasoning",
            id: "reason-paris",
            turnId: "turn-paris",
            summary: "Searching Paris weather",
            content: "Looking up Paris forecasts.",
            isStreaming: false,
          },
          {
            kind: "tool",
            id: "tool-paris",
            turnId: "turn-paris",
            toolType: "webSearch",
            title: "Web search",
            status: "completed",
            summary: "Paris weather",
            output: "Forecast data",
          },
          {
            kind: "message",
            id: "assistant-paris",
            turnId: "turn-paris",
            role: "assistant",
            text: "Pour Paris : temps sec.",
            images: null,
            isStreaming: false,
          },
        ],
      }),
    );

    const itemIds = entries.flatMap((entry) =>
      entry.kind === "item" ? [entry.item.id] : [],
    );
    const [workActivity] = entries.flatMap((entry) =>
      entry.kind === "workActivity" ? [entry] : [],
    );

    expect(itemIds).toEqual([
      "handoff-user-bordeaux",
      "handoff-assistant-bordeaux",
      "user-paris",
      "assistant-paris",
    ]);
    expect(workActivity?.kind).toBe("workActivity");
    expect(workActivity?.group.items.map((item) => item.id)).toEqual([
      "reason-paris",
      "tool-paris",
    ]);
  });

  it("keeps completed Claude plan follow-up activity visible after the final answer", () => {
    const entries = buildConversationTimeline(
      makeConversationSnapshot({
        provider: "claude",
        status: "completed",
        activeTurnId: null,
        items: [
          {
            kind: "message",
            id: "user-bordeaux",
            role: "user",
            text: "Fais un plan pour la météo de Bordeaux.",
            images: null,
            isStreaming: false,
          },
          {
            kind: "system",
            id: "system-plan-approved",
            turnId: null,
            tone: "info",
            title: "Plan approved",
            body: "Skein approved the current plan and switched the thread to Build mode.",
          },
          {
            kind: "reasoning",
            id: "claude-summary",
            turnId: "claude-turn-approved",
            summary: "Consulting weather sources.",
            content: "",
            isStreaming: false,
          },
          {
            kind: "tool",
            id: "claude-web",
            turnId: "claude-turn-approved",
            toolType: "WebSearch",
            title: "Web",
            status: "completed",
            summary: "Bordeaux weather",
            output: "Forecast details",
          },
          {
            kind: "message",
            id: "assistant-bordeaux",
            turnId: "claude-turn-approved",
            role: "assistant",
            text: "Météo à Bordeaux : temps sec.",
            images: null,
            isStreaming: false,
          },
        ],
      }),
    );

    const itemIds = entries.flatMap((entry) =>
      entry.kind === "item" ? [entry.item.id] : [],
    );
    const [workActivity] = entries.flatMap((entry) =>
      entry.kind === "workActivity" ? [entry] : [],
    );

    expect(itemIds).toEqual([
      "user-bordeaux",
      "system-plan-approved",
      "assistant-bordeaux",
    ]);
    expect(workActivity?.group.items.map((item) => item.id)).toEqual([
      "claude-summary",
      "claude-web",
    ]);
  });
});
