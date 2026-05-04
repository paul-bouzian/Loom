import { describe, expect, it, vi } from "vitest";

import { OPTIMISTIC_FIRST_TURN_ID } from "../../lib/conversation-constants";
import type { ConversationImageAttachment } from "../../lib/types";
import { makeConversationSnapshot } from "../../test/fixtures/conversation";
import { buildConversationTimeline } from "./conversation-work-activity";

describe("buildConversationTimeline", () => {
  it("tracks optimistic first-message timing independently per thread", () => {
    const dateNow = vi.spyOn(Date, "now");
    const firstStartedAt = new Date("2026-05-01T10:00:00Z").getTime();
    const secondStartedAt = new Date("2026-05-01T13:17:00Z").getTime();
    const thirdStartedAt = new Date("2026-05-01T15:44:00Z").getTime();
    try {
      dateNow.mockReturnValue(firstStartedAt);
      const firstGroup = optimisticWorkActivityGroup({
        threadId: "thread-optimistic-timing-old",
        messageId: "optimistic-user-old",
        text: "Start old thread",
      });

      dateNow.mockReturnValue(secondStartedAt);
      const secondGroup = optimisticWorkActivityGroup({
        threadId: "thread-optimistic-timing-new",
        messageId: "optimistic-user-new",
        text: "Start new thread",
      });

      expect(firstGroup.startedAt).not.toBeNull();
      expect(secondGroup.startedAt).not.toBeNull();
      expect(secondGroup.startedAt).toBeGreaterThan(firstGroup.startedAt!);
      expect(secondGroup.startedAt).toBe(secondStartedAt);

      dateNow.mockReturnValue(thirdStartedAt);
      const sameThreadNextGroup = optimisticWorkActivityGroup({
        threadId: "thread-optimistic-timing-new",
        messageId: "optimistic-user-new-retry",
        text: "Start new thread again",
      });

      expect(sameThreadNextGroup.startedAt).toBe(thirdStartedAt);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("preserves optimistic timing when the provider confirms the active turn", () => {
    const dateNow = vi.spyOn(Date, "now");
    const optimisticStartedAt = new Date("2026-05-01T10:00:00Z").getTime();
    const providerStartedAt = new Date("2026-05-01T10:00:07Z").getTime();
    try {
      dateNow.mockReturnValue(optimisticStartedAt);
      const optimisticGroup = optimisticWorkActivityGroup({
        threadId: "thread-confirmed-timing",
        messageId: "optimistic-user-confirmed",
        text: "Build the dashboard",
      });

      dateNow.mockReturnValue(providerStartedAt);
      const confirmedGroup = onlyWorkActivityGroup(
        buildConversationTimeline(
          makeConversationSnapshot({
            threadId: "thread-confirmed-timing",
            status: "running",
            activeTurnId: "turn-confirmed",
            items: [
              {
                kind: "message",
                id: "user-confirmed",
                role: "user",
                text: "Build the dashboard",
                images: null,
                isStreaming: false,
              },
            ],
          }),
        ),
      );

      expect(optimisticGroup.startedAt).toBe(optimisticStartedAt);
      expect(confirmedGroup.turnId).toBe("turn-confirmed");
      expect(confirmedGroup.startedAt).toBe(optimisticStartedAt);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("starts fresh timing for a later optimistic send with the same text", () => {
    const dateNow = vi.spyOn(Date, "now");
    const firstStartedAt = new Date("2026-05-01T10:00:00Z").getTime();
    const secondStartedAt = new Date("2026-05-01T10:02:00Z").getTime();
    try {
      dateNow.mockReturnValue(firstStartedAt);
      const firstGroup = optimisticWorkActivityGroup({
        threadId: "thread-repeated-optimistic-text",
        messageId: "optimistic-user-repeat-old",
        text: "Try again",
      });

      dateNow.mockReturnValue(secondStartedAt);
      const secondGroup = optimisticWorkActivityGroup({
        threadId: "thread-repeated-optimistic-text",
        messageId: "optimistic-user-repeat-new",
        text: "Try again",
      });

      expect(firstGroup.startedAt).toBe(firstStartedAt);
      expect(secondGroup.startedAt).toBe(secondStartedAt);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("preserves optimistic timing when local images are rewritten to hosted URLs", () => {
    const dateNow = vi.spyOn(Date, "now");
    const optimisticStartedAt = new Date("2026-05-01T10:00:00Z").getTime();
    const providerStartedAt = new Date("2026-05-01T10:00:04Z").getTime();
    try {
      dateNow.mockReturnValue(optimisticStartedAt);
      optimisticWorkActivityGroup({
        threadId: "thread-image-rewrite-timing",
        messageId: "optimistic-user-image",
        text: "Use this screenshot",
        images: [{ type: "localImage", path: "/tmp/screenshot.png" }],
      });

      dateNow.mockReturnValue(providerStartedAt);
      const confirmedGroup = onlyWorkActivityGroup(
        buildConversationTimeline(
          makeConversationSnapshot({
            threadId: "thread-image-rewrite-timing",
            status: "running",
            activeTurnId: "turn-image-rewrite",
            items: [
              {
                kind: "message",
                id: "user-image-confirmed",
                turnId: "turn-image-rewrite",
                role: "user",
                text: "Use this screenshot",
                images: [{ type: "image", url: "https://provider.example/screenshot.png" }],
                isStreaming: false,
              },
            ],
          }),
        ),
      );

      expect(confirmedGroup.startedAt).toBe(optimisticStartedAt);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("does not let historical matching turns consume optimistic timing", () => {
    const dateNow = vi.spyOn(Date, "now");
    const optimisticStartedAt = new Date("2026-05-01T10:00:00Z").getTime();
    const providerStartedAt = new Date("2026-05-01T10:00:08Z").getTime();
    try {
      dateNow.mockReturnValue(optimisticStartedAt);
      optimisticWorkActivityGroup({
        threadId: "thread-repeated-confirmed-text",
        messageId: "optimistic-user-latest",
        text: "Try again",
      });

      dateNow.mockReturnValue(providerStartedAt);
      const entries = buildConversationTimeline(
        makeConversationSnapshot({
          threadId: "thread-repeated-confirmed-text",
          status: "running",
          activeTurnId: "turn-latest",
          items: [
            {
              kind: "message",
              id: "user-old",
              turnId: "turn-old",
              role: "user",
              text: "Try again",
              images: null,
              isStreaming: false,
            },
            {
              kind: "reasoning",
              id: "reason-old",
              turnId: "turn-old",
              summary: "Old reasoning",
              content: "",
              isStreaming: false,
            },
            {
              kind: "message",
              id: "assistant-old",
              turnId: "turn-old",
              role: "assistant",
              text: "Earlier answer.",
              images: null,
              isStreaming: false,
            },
            {
              kind: "message",
              id: "user-latest",
              turnId: "turn-latest",
              role: "user",
              text: "Try again",
              images: null,
              isStreaming: false,
            },
          ],
        }),
      );

      const workGroups = entries.flatMap((entry) =>
        entry.kind === "workActivity" ? [entry.group] : [],
      );
      const oldGroup = workGroups.find((group) => group.turnId === "turn-old");
      const latestGroup = workGroups.find((group) => group.turnId === "turn-latest");

      expect(oldGroup?.startedAt).toBeNull();
      expect(latestGroup?.startedAt).toBe(optimisticStartedAt);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("keeps live assistant updates inside the active work activity", () => {
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
    ]);
    expect(workActivity?.kind).toBe("workActivity");
    expect(workActivity?.group.items.map((item) => item.id)).toEqual([
      "reason-paris",
      "tool-paris",
      "assistant-paris-draft",
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

function onlyWorkActivityGroup(
  entries: ReturnType<typeof buildConversationTimeline>,
) {
  const group = entries.find((entry) => entry.kind === "workActivity");
  if (!group || group.kind !== "workActivity") {
    throw new Error("Expected a work activity group.");
  }
  return group.group;
}

function optimisticWorkActivityGroup({
  threadId,
  messageId,
  text,
  images = null,
}: {
  threadId: string;
  messageId: string;
  text: string;
  images?: ConversationImageAttachment[] | null;
}) {
  return onlyWorkActivityGroup(
    buildConversationTimeline(
      makeConversationSnapshot({
        threadId,
        status: "running",
        activeTurnId: OPTIMISTIC_FIRST_TURN_ID,
        items: [
          {
            kind: "message",
            id: messageId,
            role: "user",
            text,
            images,
            isStreaming: false,
          },
        ],
      }),
    ),
  );
}
