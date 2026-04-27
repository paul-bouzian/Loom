import { beforeEach, describe, expect, it } from "vitest";

import type { ConversationStatus } from "../lib/types";
import { makeConversationSnapshot } from "../test/fixtures/conversation";
import {
  INITIAL_CONVERSATION_STATE,
  useConversationStore,
} from "./conversation-store";
import {
  resetThreadUnreadStoreForTest,
  selectThreadUnread,
  useThreadUnreadStore,
} from "./thread-unread-store";
import { useWorkspaceStore } from "./workspace-store";

const initialWorkspaceState = useWorkspaceStore.getInitialState();

beforeEach(() => {
  useWorkspaceStore.setState(initialWorkspaceState, true);
  useConversationStore.setState((state) => ({
    ...state,
    ...INITIAL_CONVERSATION_STATE,
  }));
  resetThreadUnreadStoreForTest();
});

describe("thread unread store", () => {
  it("does not mark initially hydrated completed snapshots as unread", () => {
    setThreadStatus("thread-1", "completed");

    expect(readUnread("thread-1")).toBe(false);
  });

  it("marks an invisible thread unread when active work completes", () => {
    setThreadStatus("thread-1", "running");
    setThreadStatus("thread-1", "completed");

    expect(readUnread("thread-1")).toBe(true);
  });

  it("does not mark a visible thread unread when active work completes", () => {
    showThread("thread-1");
    setThreadStatus("thread-1", "running");
    setThreadStatus("thread-1", "completed");

    expect(readUnread("thread-1")).toBe(false);
  });

  it("clears unread when a flagged thread becomes visible", () => {
    setThreadStatus("thread-1", "running");
    setThreadStatus("thread-1", "completed");

    showThread("thread-1");

    expect(readUnread("thread-1")).toBe(false);
  });
});

function setThreadStatus(threadId: string, status: ConversationStatus) {
  useConversationStore.setState((state) => ({
    ...state,
    snapshotsByThreadId: {
      ...state.snapshotsByThreadId,
      [threadId]: makeConversationSnapshot({ threadId, status }),
    },
  }));
}

function showThread(threadId: string) {
  useWorkspaceStore.setState((state) => ({
    ...state,
    layout: {
      ...state.layout,
      slots: {
        ...state.layout.slots,
        topLeft: {
          projectId: "project-1",
          environmentId: "env-1",
          threadId,
        },
      },
      focusedSlot: "topLeft",
    },
  }));
}

function readUnread(threadId: string) {
  return selectThreadUnread(threadId)(useThreadUnreadStore.getState());
}
