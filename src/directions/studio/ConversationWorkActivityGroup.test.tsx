import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ConversationItem } from "../../lib/types";
import { ConversationWorkActivityGroup } from "./ConversationWorkActivityGroup";
import type { ConversationWorkActivityGroup as ConversationWorkActivityGroupData } from "./conversation-work-activity";

const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDivElement.prototype,
  "scrollHeight",
);
const originalClientHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDivElement.prototype,
  "clientHeight",
);

let workActivityScrollHeight = 1200;
let workActivityClientHeight = 300;

beforeEach(() => {
  workActivityScrollHeight = 1200;
  workActivityClientHeight = 300;

  Object.defineProperty(HTMLDivElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return this.classList.contains("tx-work-activity__body")
        ? workActivityScrollHeight
        : 0;
    },
  });

  Object.defineProperty(HTMLDivElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return this.classList.contains("tx-work-activity__body")
        ? workActivityClientHeight
        : 0;
    },
  });
});

afterEach(() => {
  restoreDescriptor(
    HTMLDivElement.prototype,
    "scrollHeight",
    originalScrollHeightDescriptor,
  );
  restoreDescriptor(
    HTMLDivElement.prototype,
    "clientHeight",
    originalClientHeightDescriptor,
  );
});

describe("ConversationWorkActivityGroup", () => {
  it("opens work activity details at the bottom of the internal scroll area", async () => {
    const { container } = render(
      <ConversationWorkActivityGroup group={makeGroup({ itemCount: 6 })} />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Show work activity details" }),
    );

    expect(getWorkActivityBody(container).scrollTop).toBe(workActivityScrollHeight);
  });

  it("keeps following new work activity while the user stays near the bottom", async () => {
    const { container, rerender } = render(
      <ConversationWorkActivityGroup group={makeGroup({ itemCount: 6 })} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Show work activity details" }),
    );

    workActivityScrollHeight = 1600;
    rerender(<ConversationWorkActivityGroup group={makeGroup({ itemCount: 8 })} />);

    expect(getWorkActivityBody(container).scrollTop).toBe(workActivityScrollHeight);
  });

  it("does not force the bottom after the user scrolls up", async () => {
    const { container, rerender } = render(
      <ConversationWorkActivityGroup group={makeGroup({ itemCount: 6 })} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Show work activity details" }),
    );

    const body = getWorkActivityBody(container);
    body.scrollTop = 100;
    fireEvent.scroll(body);

    workActivityScrollHeight = 1600;
    rerender(<ConversationWorkActivityGroup group={makeGroup({ itemCount: 8 })} />);

    expect(body.scrollTop).toBe(100);
  });
});

function getWorkActivityBody(container: HTMLElement) {
  const body = container.querySelector(".tx-work-activity__body");
  if (!(body instanceof HTMLDivElement)) {
    throw new Error("Expected the work activity body to render.");
  }
  return body;
}

function makeGroup({
  itemCount,
}: {
  itemCount: number;
}): ConversationWorkActivityGroupData {
  const items = Array.from({ length: itemCount }, (_, index): ConversationItem => ({
    kind: "message",
    id: `update-${index}`,
    turnId: "turn-work-activity",
    role: "assistant",
    text: `Update ${index + 1}`,
    images: null,
    isStreaming: index === itemCount - 1,
  }));

  return {
    id: "work-turn-work-activity",
    turnId: "turn-work-activity",
    items,
    taskPlan: null,
    subagents: [],
    counts: {
      updateCount: itemCount,
      reasoningCount: 0,
      toolCount: 0,
      systemCount: 0,
      subagentCount: 0,
    },
    status: "running",
  };
}

function restoreDescriptor<T extends object, K extends keyof T>(
  target: T,
  property: K,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
    return;
  }

  delete target[property];
}
