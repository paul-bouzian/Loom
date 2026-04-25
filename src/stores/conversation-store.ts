import { create } from "zustand";

import * as bridge from "../lib/bridge";
import type {
  ApprovalResponseInput,
  ComposerMentionBindingInput,
  ConversationComposerDraft,
  ConversationComposerSettings,
  ConversationImageAttachment,
  ConversationMessageItem,
  EnvironmentCapabilitiesSnapshot,
  SubmitPlanDecisionInput,
  ThreadConversationSnapshot,
} from "../lib/types";
import {
  clearThreadDraftPersistence,
  clearDraftPersistenceControllers,
  draftForThread,
  hydrateDraftEntry,
  EMPTY_CONVERSATION_COMPOSER_DRAFT,
  normalizeDraft,
  persistenceModeForDraftChange,
  removeDraftEntry,
  sameDraft,
  scheduleDraftPersistence,
  setDraftEntry,
  type DraftPersistenceMode,
  type DraftUpdate,
} from "./conversation-drafts";
import {
  requestWorkspaceRefresh,
} from "./workspace-store";

type ConversationSet = (
  updater: (state: ConversationState) => Partial<ConversationState>,
) => void;

type ConversationGet = () => ConversationState;

type OpenThreadOptions = {
  skipIfLoaded?: boolean;
};

export type ThreadHydrationState = "cold" | "loading" | "ready" | "error";

export type PendingFirstMessage = {
  text: string;
  images: ConversationImageAttachment[];
  mentionBindings: ComposerMentionBindingInput[];
  composer: ConversationComposerSettings | null;
};

type ConversationState = {
  snapshotsByThreadId: Record<string, ThreadConversationSnapshot>;
  capabilitiesByEnvironmentId: Record<string, EnvironmentCapabilitiesSnapshot>;
  composerByThreadId: Record<string, ConversationComposerSettings>;
  draftByThreadId: Record<string, ConversationComposerDraft>;
  hydrationByThreadId: Record<string, ThreadHydrationState>;
  errorByThreadId: Record<string, string | null>;
  pendingFirstMessageByThreadId: Record<string, PendingFirstMessage>;
  listenerReady: boolean;

  initializeListener: () => Promise<void>;
  tryLoadEnvironmentCapabilities: (
    environmentId: string,
  ) => Promise<EnvironmentCapabilitiesSnapshot | null>;
  openThread: (threadId: string) => Promise<void>;
  refreshThread: (threadId: string) => Promise<void>;
  updateComposer: (
    threadId: string,
    patch: Partial<ConversationComposerSettings>,
  ) => void;
  updateDraft: (threadId: string, update: DraftUpdate) => void;
  replaceDraftLocally: (
    threadId: string,
    draft: ConversationComposerDraft | null,
  ) => void;
  resetDraft: (threadId: string) => void;
  sendMessage: (
    threadId: string,
    text: string,
    images?: ConversationImageAttachment[],
    mentionBindings?: ComposerMentionBindingInput[],
  ) => Promise<boolean>;
  interruptThread: (threadId: string) => Promise<void>;
  respondToApprovalRequest: (
    threadId: string,
    interactionId: string,
    response: ApprovalResponseInput,
  ) => Promise<void>;
  respondToUserInputRequest: (
    threadId: string,
    interactionId: string,
    answers: Record<string, string[]>,
  ) => Promise<void>;
  submitPlanDecision: (input: SubmitPlanDecisionInput) => Promise<boolean>;
  enqueuePendingFirstMessage: (
    threadId: string,
    payload: PendingFirstMessage,
  ) => void;
  consumePendingFirstMessage: (threadId: string) => PendingFirstMessage | null;
};

type ConversationStateData = Pick<
  ConversationState,
  | "snapshotsByThreadId"
  | "capabilitiesByEnvironmentId"
  | "composerByThreadId"
  | "draftByThreadId"
  | "hydrationByThreadId"
  | "errorByThreadId"
  | "pendingFirstMessageByThreadId"
  | "listenerReady"
>;

export const INITIAL_CONVERSATION_STATE: ConversationStateData = {
  snapshotsByThreadId: {},
  capabilitiesByEnvironmentId: {},
  composerByThreadId: {},
  draftByThreadId: {},
  hydrationByThreadId: {},
  errorByThreadId: {},
  pendingFirstMessageByThreadId: {},
  listenerReady: false,
};

let unlistenConversationEvents: null | (() => void) = null;
let listenerInitialization: Promise<void> | null = null;
let listenerGeneration = 0;
const inflightThreadLoads = new Map<string, Promise<boolean>>();
const inflightEnvironmentCapabilityLoads = new Map<
  string,
  Promise<EnvironmentCapabilitiesSnapshot | null>
>();
type PendingOptimisticUserMessage = {
  item: ConversationMessageItem;
  afterItemId: string | null;
  baseItemCount: number;
};
const pendingOptimisticUserMessages = new Map<
  string,
  PendingOptimisticUserMessage
>();

function refreshWorkspaceSnapshotNonBlocking() {
  requestWorkspaceRefresh();
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  ...INITIAL_CONVERSATION_STATE,

  initializeListener: async () => {
    if (get().listenerReady) return;
    if (listenerInitialization) {
      await listenerInitialization;
      return;
    }

    const generation = listenerGeneration;
    const initialization = bridge
      .listenToConversationEvents((payload) => {
        const snapshot = snapshotWithPendingOptimisticMessage(
          payload.threadId,
          payload.snapshot,
        );
        set((state) => ({
          snapshotsByThreadId: {
            ...state.snapshotsByThreadId,
            [payload.threadId]: snapshot,
          },
          capabilitiesByEnvironmentId: state.capabilitiesByEnvironmentId,
          composerByThreadId: state.composerByThreadId[payload.threadId]
            ? state.composerByThreadId
            : {
                ...state.composerByThreadId,
                [payload.threadId]: snapshot.composer,
              },
          hydrationByThreadId: {
            ...state.hydrationByThreadId,
            [payload.threadId]: "ready",
          },
          errorByThreadId: {
            ...state.errorByThreadId,
            [payload.threadId]: null,
          },
        }));
      })
      .then((unlisten) => {
        if (generation !== listenerGeneration) {
          unlisten();
          return;
        }
        unlistenConversationEvents = unlisten;
        set({ listenerReady: true });
      });
    listenerInitialization = initialization;

    try {
      await initialization;
    } finally {
      if (listenerInitialization === initialization) {
        listenerInitialization = null;
      }
    }
  },

  tryLoadEnvironmentCapabilities: async (environmentId) => {
    const trimmedEnvironmentId = environmentId.trim();
    if (!trimmedEnvironmentId) {
      return null;
    }

    const cached =
      get().capabilitiesByEnvironmentId[trimmedEnvironmentId] ?? null;
    if (cached) {
      return cached;
    }

    const inflight =
      inflightEnvironmentCapabilityLoads.get(trimmedEnvironmentId) ?? null;
    if (inflight) {
      return inflight;
    }

    const loadPromise = bridge
      .getEnvironmentCapabilities(trimmedEnvironmentId)
      .then((capabilities) => {
        set((state) => ({
          capabilitiesByEnvironmentId: {
            ...state.capabilitiesByEnvironmentId,
            [capabilities.environmentId]: capabilities,
          },
        }));
        return capabilities;
      })
      .catch(() => null);

    inflightEnvironmentCapabilityLoads.set(trimmedEnvironmentId, loadPromise);
    try {
      return await loadPromise;
    } finally {
      if (
        inflightEnvironmentCapabilityLoads.get(trimmedEnvironmentId) ===
        loadPromise
      ) {
        inflightEnvironmentCapabilityLoads.delete(trimmedEnvironmentId);
      }
    }
  },

  openThread: async (threadId) => {
    await openThreadWithOptions(get, set, threadId, {
      skipIfLoaded: true,
    });
  },

  refreshThread: async (threadId) => {
    try {
      const snapshot = snapshotWithPendingOptimisticMessage(
        threadId,
        await bridge.refreshThreadConversation(threadId),
      );
      set((state) => ({
        snapshotsByThreadId: {
          ...state.snapshotsByThreadId,
          [threadId]: snapshot,
        },
        hydrationByThreadId: {
          ...state.hydrationByThreadId,
          [threadId]: "ready",
        },
        errorByThreadId: { ...state.errorByThreadId, [threadId]: null },
      }));
    } catch (cause: unknown) {
      const message =
        cause instanceof Error ? cause.message : "Failed to refresh conversation";
      set((state) => ({
        errorByThreadId: { ...state.errorByThreadId, [threadId]: message },
      }));
    }
  },

  updateComposer: (threadId, patch) =>
    set((state) => {
      const baseComposer =
        state.composerByThreadId[threadId] ?? state.snapshotsByThreadId[threadId]?.composer;
      if (!baseComposer) {
        return state;
      }

      return {
        composerByThreadId: {
          ...state.composerByThreadId,
          [threadId]: {
            ...baseComposer,
            ...patch,
          },
        },
      };
    }),

  updateDraft: (threadId, update) => {
    let nextDraft: ConversationComposerDraft | null = null;
    let persistenceMode: DraftPersistenceMode | null = null;

    set((state) => {
      const currentDraft = draftForThread(state.draftByThreadId, threadId);
      const updatedDraft =
        typeof update === "function"
          ? normalizeDraft(update(normalizeDraft(currentDraft)))
          : normalizeDraft({
              ...currentDraft,
              ...update,
            });

      if (sameDraft(currentDraft, updatedDraft)) {
        return state;
      }

      nextDraft = updatedDraft;
      persistenceMode = persistenceModeForDraftChange(currentDraft, updatedDraft);
      return {
        draftByThreadId: setDraftEntry(state.draftByThreadId, threadId, updatedDraft),
      };
    });

    if (nextDraft && persistenceMode) {
      scheduleDraftPersistence(threadId, nextDraft, persistenceMode);
    }
  },

  replaceDraftLocally: (threadId, draft) =>
    set((state) => ({
      draftByThreadId: setDraftEntry(state.draftByThreadId, threadId, draft),
    })),

  resetDraft: (threadId) => {
    set((state) => ({
      draftByThreadId: setDraftEntry(state.draftByThreadId, threadId, null),
    }));
    scheduleDraftPersistence(
      threadId,
      EMPTY_CONVERSATION_COMPOSER_DRAFT,
      "immediate",
    );
  },

  sendMessage: async (threadId, text, images = [], mentionBindings = []) => {
    set((state) => ({
      errorByThreadId: { ...state.errorByThreadId, [threadId]: null },
    }));
    const composer =
      get().composerByThreadId[threadId] ??
      get().snapshotsByThreadId[threadId]?.composer;
    const previousSnapshot = get().snapshotsByThreadId[threadId];
    const optimisticMessage = previousSnapshot
      ? buildOptimisticUserMessageSnapshot(previousSnapshot, text, images)
      : null;

    if (optimisticMessage) {
      pendingOptimisticUserMessages.set(threadId, {
        item: optimisticMessage.item,
        afterItemId:
          previousSnapshot.items[previousSnapshot.items.length - 1]?.id ?? null,
        baseItemCount: previousSnapshot.items.length,
      });
      set((state) => ({
        snapshotsByThreadId: {
          ...state.snapshotsByThreadId,
          [threadId]: optimisticMessage.snapshot,
        },
      }));
    }

    try {
      const snapshot = await bridge.sendThreadMessage({
        threadId,
        text,
        composer,
        ...(images.length > 0 ? { images } : {}),
        ...(mentionBindings.length > 0 ? { mentionBindings } : {}),
      });
      const nextSnapshot = snapshotWithPendingOptimisticMessage(
        threadId,
        snapshot,
      );
      set((state) => {
        const existingSnapshot = state.snapshotsByThreadId[threadId];
        const shouldKeepExisting =
          existingSnapshot !== undefined &&
          existingSnapshot.items.length > nextSnapshot.items.length;
        const storedSnapshot = shouldKeepExisting
          ? existingSnapshot
          : nextSnapshot;
        return {
          snapshotsByThreadId: {
            ...state.snapshotsByThreadId,
            [threadId]: storedSnapshot,
          },
          composerByThreadId: {
            ...state.composerByThreadId,
            [threadId]: storedSnapshot.composer,
          },
          draftByThreadId: removeDraftEntry(state.draftByThreadId, threadId),
        };
      });
      clearThreadDraftPersistence(threadId);
      refreshWorkspaceSnapshotNonBlocking();
      return true;
    } catch (cause: unknown) {
      pendingOptimisticUserMessages.delete(threadId);
      const message =
        cause instanceof Error ? cause.message : "Failed to send message";
      set((state) => ({
        snapshotsByThreadId:
          optimisticMessage &&
          previousSnapshot &&
          snapshotContainsItem(
            state.snapshotsByThreadId[threadId],
            optimisticMessage.item.id,
          )
            ? {
                ...state.snapshotsByThreadId,
                [threadId]: previousSnapshot,
              }
            : state.snapshotsByThreadId,
        errorByThreadId: { ...state.errorByThreadId, [threadId]: message },
      }));
      return false;
    }
  },

  interruptThread: async (threadId) => {
    try {
      const snapshot = await bridge.interruptThreadTurn(threadId);
      set((state) => ({
        snapshotsByThreadId: {
          ...state.snapshotsByThreadId,
          [threadId]: snapshot,
        },
      }));
    } catch (cause: unknown) {
      const message =
        cause instanceof Error ? cause.message : "Failed to stop the active turn";
      set((state) => ({
        errorByThreadId: { ...state.errorByThreadId, [threadId]: message },
      }));
    }
  },

  respondToApprovalRequest: async (threadId, interactionId, response) => {
    set((state) => ({
      errorByThreadId: { ...state.errorByThreadId, [threadId]: null },
    }));
    try {
      const snapshot = await bridge.respondToApprovalRequest({
        threadId,
        interactionId,
        response,
      });
      set((state) => ({
        snapshotsByThreadId: {
          ...state.snapshotsByThreadId,
          [threadId]: snapshot,
        },
      }));
    } catch (cause: unknown) {
      const message =
        cause instanceof Error ? cause.message : "Failed to answer the approval request";
      set((state) => ({
        errorByThreadId: { ...state.errorByThreadId, [threadId]: message },
      }));
    }
  },

  respondToUserInputRequest: async (threadId, interactionId, answers) => {
    set((state) => ({
      errorByThreadId: { ...state.errorByThreadId, [threadId]: null },
    }));
    try {
      const snapshot = await bridge.respondToUserInputRequest({
        threadId,
        interactionId,
        answers,
      });
      set((state) => ({
        snapshotsByThreadId: {
          ...state.snapshotsByThreadId,
          [threadId]: snapshot,
        },
      }));
    } catch (cause: unknown) {
      const message =
        cause instanceof Error ? cause.message : "Failed to submit the requested answers";
      set((state) => ({
        errorByThreadId: { ...state.errorByThreadId, [threadId]: message },
      }));
    }
  },

  submitPlanDecision: async (input) => {
    set((state) => ({
      errorByThreadId: { ...state.errorByThreadId, [input.threadId]: null },
    }));
    try {
      const snapshot = await bridge.submitPlanDecision(input);
      set((state) => ({
        snapshotsByThreadId: {
          ...state.snapshotsByThreadId,
          [input.threadId]: snapshot,
        },
        composerByThreadId: {
          ...state.composerByThreadId,
          [input.threadId]: snapshot.composer,
        },
        draftByThreadId: removeDraftEntry(state.draftByThreadId, input.threadId),
      }));
      clearThreadDraftPersistence(input.threadId);
      refreshWorkspaceSnapshotNonBlocking();
      return true;
    } catch (cause: unknown) {
      const message =
        cause instanceof Error ? cause.message : "Failed to continue from the proposed plan";
      set((state) => ({
        errorByThreadId: { ...state.errorByThreadId, [input.threadId]: message },
      }));
      return false;
    }
  },

  enqueuePendingFirstMessage: (threadId, payload) =>
    set((state) => ({
      pendingFirstMessageByThreadId: {
        ...state.pendingFirstMessageByThreadId,
        [threadId]: payload,
      },
    })),

  consumePendingFirstMessage: (threadId) => {
    const pending = get().pendingFirstMessageByThreadId[threadId] ?? null;
    if (!pending) return null;
    set((state) => {
      if (!(threadId in state.pendingFirstMessageByThreadId)) return state;
      const next = { ...state.pendingFirstMessageByThreadId };
      delete next[threadId];
      return { pendingFirstMessageByThreadId: next };
    });
    return pending;
  },
}));

export function selectPendingFirstMessage(threadId: string | null) {
  return (state: ConversationState) =>
    (threadId ? state.pendingFirstMessageByThreadId[threadId] : null) ?? null;
}

export function selectConversationSnapshot(threadId: string | null) {
  return (state: ConversationState) =>
    (threadId ? state.snapshotsByThreadId[threadId] : null) ?? null;
}

export function selectConversationComposer(threadId: string | null) {
  return (state: ConversationState) =>
    (threadId ? state.composerByThreadId[threadId] : null) ??
    (threadId ? state.snapshotsByThreadId[threadId]?.composer : null) ??
    null;
}

export function selectConversationDraft(threadId: string | null) {
  return (state: ConversationState) =>
    (threadId ? state.draftByThreadId[threadId] : null) ??
    EMPTY_CONVERSATION_COMPOSER_DRAFT;
}

export function selectConversationHydration(threadId: string | null) {
  return (state: ConversationState) =>
    (threadId ? state.hydrationByThreadId[threadId] : null) ?? "cold";
}

export function selectConversationCapabilities(environmentId: string | null) {
  return (state: ConversationState) =>
    (environmentId ? state.capabilitiesByEnvironmentId[environmentId] : null) ?? null;
}

export function selectConversationError(threadId: string | null) {
  return (state: ConversationState) =>
    (threadId ? state.errorByThreadId[threadId] : null) ?? null;
}

export function teardownConversationListener() {
  listenerGeneration += 1;
  unlistenConversationEvents?.();
  unlistenConversationEvents = null;
  listenerInitialization = null;
  inflightThreadLoads.clear();
  inflightEnvironmentCapabilityLoads.clear();
  pendingOptimisticUserMessages.clear();
  clearDraftPersistenceControllers();
  useConversationStore.setState({ listenerReady: false });
}

async function openThreadWithOptions(
  get: ConversationGet,
  set: ConversationSet,
  threadId: string,
  options: OpenThreadOptions,
): Promise<boolean> {
  if (options.skipIfLoaded && restoreHydratedThreadIfPresent(get, set, threadId)) {
    return false;
  }

  const inflight = inflightThreadLoads.get(threadId);
  if (inflight) {
    return inflight;
  }

  const loadPromise = (async () => {
    if (options.skipIfLoaded && restoreHydratedThreadIfPresent(get, set, threadId)) {
      return false;
    }

    set((state) => ({
      hydrationByThreadId: {
        ...state.hydrationByThreadId,
        [threadId]: "loading",
      },
      errorByThreadId: { ...state.errorByThreadId, [threadId]: null },
    }));

    try {
      const response = await bridge.openThreadConversation(threadId);
      set((state) => {
        // The bridge call can race with live snapshot events and in-flight
        // optimistic updates (the listener and `sendMessage` both write to
        // `snapshotsByThreadId`). If the store already holds a snapshot with
        // more items than the one the bridge just returned, keep the newer
        // one — otherwise we'd overwrite an optimistic user message with an
        // empty snapshot the backend fetched before the send landed.
        const existingSnapshot = state.snapshotsByThreadId[threadId];
        const shouldKeepExisting =
          existingSnapshot !== undefined &&
          existingSnapshot.items.length > response.snapshot.items.length;
        const nextSnapshot = shouldKeepExisting
          ? existingSnapshot
          : response.snapshot;
        const reconciledSnapshot = snapshotWithPendingOptimisticMessage(
          threadId,
          nextSnapshot,
        );
        return {
          snapshotsByThreadId: {
            ...state.snapshotsByThreadId,
            [threadId]: reconciledSnapshot,
          },
          capabilitiesByEnvironmentId: {
            ...state.capabilitiesByEnvironmentId,
            [response.capabilities.environmentId]: response.capabilities,
          },
          // Preserve composer settings the caller may have seeded (e.g. the
          // draft composer's model / effort / fast-mode choice before the
          // thread was created).
          composerByThreadId: state.composerByThreadId[threadId]
            ? state.composerByThreadId
            : {
                ...state.composerByThreadId,
                [threadId]: reconciledSnapshot.composer,
              },
          draftByThreadId: hydrateDraftEntry(
            state.draftByThreadId,
            threadId,
            response.composerDraft,
          ),
          hydrationByThreadId: {
            ...state.hydrationByThreadId,
            [threadId]: "ready",
          },
        };
      });

      return true;
    } catch (cause: unknown) {
      const message =
        cause instanceof Error ? cause.message : "Failed to open conversation";
      set((state) => ({
        hydrationByThreadId: {
          ...state.hydrationByThreadId,
          [threadId]: "error",
        },
        errorByThreadId: { ...state.errorByThreadId, [threadId]: message },
      }));
      return false;
    }
  })();

  inflightThreadLoads.set(threadId, loadPromise);
  try {
    return await loadPromise;
  } finally {
    if (inflightThreadLoads.get(threadId) === loadPromise) {
      inflightThreadLoads.delete(threadId);
    }
  }
}

function buildOptimisticUserMessageSnapshot(
  snapshot: ThreadConversationSnapshot,
  text: string,
  images: ConversationImageAttachment[],
): {
  item: ConversationMessageItem;
  snapshot: ThreadConversationSnapshot;
} | null {
  if (text.length === 0 && images.length === 0) {
    return null;
  }

  const messageItem: ConversationMessageItem = {
    kind: "message",
    id: `optimistic-user-${crypto.randomUUID()}`,
    role: "user",
    text,
    images: images.length > 0 ? images : null,
    isStreaming: false,
  };

  return {
    item: messageItem,
    snapshot: {
      ...snapshot,
      items: [...snapshot.items, messageItem],
      error: null,
    },
  };
}

function snapshotWithPendingOptimisticMessage(
  threadId: string,
  snapshot: ThreadConversationSnapshot,
): ThreadConversationSnapshot {
  const pending = pendingOptimisticUserMessages.get(threadId);
  if (!pending) {
    return snapshot;
  }

  if (hasConfirmedUserMessage(snapshot, pending)) {
    pendingOptimisticUserMessages.delete(threadId);
    if (!snapshotContainsItem(snapshot, pending.item.id)) {
      return snapshot;
    }
    return {
      ...snapshot,
      items: snapshot.items.filter((item) => item.id !== pending.item.id),
    };
  }

  if (snapshotContainsItem(snapshot, pending.item.id)) {
    return snapshot;
  }

  const afterIndex = pending.afterItemId
    ? snapshot.items.findIndex((item) => item.id === pending.afterItemId)
    : -1;
  const insertAt =
    afterIndex >= 0
      ? afterIndex + 1
      : Math.min(pending.baseItemCount, snapshot.items.length);

  return {
    ...snapshot,
    items: [
      ...snapshot.items.slice(0, insertAt),
      pending.item,
      ...snapshot.items.slice(insertAt),
    ],
    error: null,
  };
}

function hasConfirmedUserMessage(
  snapshot: ThreadConversationSnapshot,
  pending: PendingOptimisticUserMessage,
): boolean {
  const anchorIndex = pending.afterItemId
    ? snapshot.items.findIndex((item) => item.id === pending.afterItemId)
    : -1;
  const searchStart = anchorIndex >= 0
    ? anchorIndex + 1
    : Math.min(pending.baseItemCount, snapshot.items.length);
  return snapshot.items.slice(searchStart).some(
    (item) =>
      item.kind === "message" &&
      item.id !== pending.item.id &&
      item.role === "user" &&
      item.text === pending.item.text &&
      sameImageAttachments(item.images ?? null, pending.item.images ?? null),
  );
}

function sameImageAttachments(
  left: ConversationImageAttachment[] | null,
  right: ConversationImageAttachment[] | null,
): boolean {
  if (!left?.length && !right?.length) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => {
    const other = right[index];
    if (!other) {
      return false;
    }
    if (item.type !== other.type) {
      // Local uploads can be rewritten to provider-hosted image URLs by the runtime.
      return true;
    }
    if (item.type === "image" && other.type === "image") {
      return item.url === other.url;
    }
    return item.type === "localImage" && other.type === "localImage"
      ? item.path === other.path
      : false;
  });
}

function snapshotContainsItem(
  snapshot: ThreadConversationSnapshot | undefined,
  itemId: string,
): boolean {
  return snapshot?.items.some((item) => item.id === itemId) ?? false;
}

function restoreHydratedThreadIfPresent(
  get: ConversationGet,
  set: ConversationSet,
  threadId: string,
) {
  const state = get();
  const snapshot = state.snapshotsByThreadId[threadId];
  if (!snapshot || !state.capabilitiesByEnvironmentId[snapshot.environmentId]) {
    return false;
  }

  if (
    state.hydrationByThreadId[threadId] !== "ready" ||
    state.errorByThreadId[threadId] !== null
  ) {
    set((currentState) => ({
      hydrationByThreadId: {
        ...currentState.hydrationByThreadId,
        [threadId]: "ready",
      },
      errorByThreadId: {
        ...currentState.errorByThreadId,
        [threadId]: null,
      },
    }));
  }

  return true;
}
