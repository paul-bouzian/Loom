import { create } from "zustand";

import { useConversationStore } from "./conversation-store";
import {
  selectThreadInFocusedPane,
  useWorkspaceStore,
} from "./workspace-store";

type ThreadUnreadState = {
  unreadByThreadId: Record<string, true>;
  markRead: (threadId: string) => void;
};

export const useThreadUnreadStore = create<ThreadUnreadState>((set) => ({
  unreadByThreadId: {},
  markRead: (threadId: string) =>
    set((state) => {
      if (!state.unreadByThreadId[threadId]) return state;
      const rest = { ...state.unreadByThreadId };
      delete rest[threadId];
      return { unreadByThreadId: rest };
    }),
}));

export function selectThreadUnread(threadId: string) {
  return (state: ThreadUnreadState) =>
    Boolean(state.unreadByThreadId[threadId]);
}

// Watch conversation snapshots for transitions into `completed`. When a thread
// just finished while it isn't in the focused pane, flag it as unread so the
// sidebar nudges the user. Focusing the thread clears the flag automatically.
const previousStatuses = new Map<string, string | null>();
for (const [threadId, snapshot] of Object.entries(
  useConversationStore.getState().snapshotsByThreadId,
)) {
  previousStatuses.set(threadId, snapshot?.status ?? null);
}

useConversationStore.subscribe((state) => {
  const seen = new Set<string>();
  for (const [threadId, snapshot] of Object.entries(state.snapshotsByThreadId)) {
    seen.add(threadId);
    const nextStatus = snapshot?.status ?? null;
    const prevStatus = previousStatuses.get(threadId) ?? null;
    previousStatuses.set(threadId, nextStatus);
    const justCompleted =
      nextStatus === "completed" && prevStatus !== "completed";
    if (!justCompleted) continue;
    const focused = selectThreadInFocusedPane(threadId)(
      useWorkspaceStore.getState(),
    );
    if (focused) continue;
    useThreadUnreadStore.setState((current) => {
      if (current.unreadByThreadId[threadId]) return current;
      return {
        unreadByThreadId: { ...current.unreadByThreadId, [threadId]: true },
      };
    });
  }
  for (const threadId of previousStatuses.keys()) {
    if (!seen.has(threadId)) previousStatuses.delete(threadId);
  }
});

// Clear the unread flag as soon as the focused thread changes.
let previousFocusedThreadId = resolveFocusedThreadId(
  useWorkspaceStore.getState(),
);
useWorkspaceStore.subscribe((state) => {
  const focusedThreadId = resolveFocusedThreadId(state);
  if (focusedThreadId === previousFocusedThreadId) return;
  previousFocusedThreadId = focusedThreadId;
  if (focusedThreadId) {
    useThreadUnreadStore.getState().markRead(focusedThreadId);
  }
});

function resolveFocusedThreadId(
  state: ReturnType<typeof useWorkspaceStore.getState>,
): string | null {
  const focused = state.layout.focusedSlot;
  if (!focused) return null;
  return state.layout.slots[focused]?.threadId ?? null;
}
