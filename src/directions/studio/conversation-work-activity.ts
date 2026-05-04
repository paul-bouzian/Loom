import type {
  ConversationItem,
  ConversationMessageItem,
  ConversationStatus,
  ConversationTaskSnapshot,
  ProposedPlanSnapshot,
  ThreadConversationSnapshot,
} from "../../lib/types";
import { OPTIMISTIC_FIRST_TURN_ID } from "../../lib/conversation-constants";
import { shouldRenderConversationItem } from "./conversation-item-visibility";

export type WorkActivityStatus =
  | "running"
  | "waiting"
  | "completed"
  | "interrupted"
  | "failed";

export type ConversationWorkActivityGroup = {
  id: string;
  turnId: string;
  items: ConversationItem[];
  counts: {
    updateCount: number;
    reasoningCount: number;
    toolCount: number;
    systemCount: number;
  };
  status: WorkActivityStatus;
  startedAt: number | null;
  finishedAt: number | null;
};

type WorkActivityTiming = {
  startedAt: number;
  finishedAt: number | null;
};

const TIMING_BY_GROUP: Map<string, WorkActivityTiming> = new Map();
const OPTIMISTIC_TIMING_KEY_BY_FINGERPRINT: Map<string, string> = new Map();
const TIMING_MAX_ENTRIES = 500;

function evictOldestTiming(): void {
  while (TIMING_BY_GROUP.size > TIMING_MAX_ENTRIES) {
    const oldest = TIMING_BY_GROUP.keys().next().value;
    if (oldest === undefined) break;
    TIMING_BY_GROUP.delete(oldest);
    for (const [fingerprint, timingKey] of OPTIMISTIC_TIMING_KEY_BY_FINGERPRINT) {
      if (timingKey === oldest) {
        OPTIMISTIC_TIMING_KEY_BY_FINGERPRINT.delete(fingerprint);
      }
    }
  }
}

function recordTiming(
  timingKey: string,
  status: WorkActivityStatus,
  fingerprint: string | null,
  isOptimisticTiming: boolean,
): WorkActivityTiming | null {
  const existing =
    TIMING_BY_GROUP.get(timingKey) ??
    (isOptimisticTiming ? null : migratedOptimisticTiming(timingKey, fingerprint));
  if (status === "running" || status === "waiting") {
    if (existing) {
      existing.finishedAt = null;
      return existing;
    }
    const created: WorkActivityTiming = {
      startedAt: Date.now(),
      finishedAt: null,
    };
    TIMING_BY_GROUP.set(timingKey, created);
    if (isOptimisticTiming && fingerprint) {
      clearOptimisticTimingForThread(fingerprint, timingKey);
      OPTIMISTIC_TIMING_KEY_BY_FINGERPRINT.set(fingerprint, timingKey);
    }
    evictOldestTiming();
    return created;
  }
  if (!existing) return null;
  if (existing.finishedAt === null) {
    existing.finishedAt = Date.now();
  }
  return existing;
}

function migratedOptimisticTiming(
  timingKey: string,
  fingerprint: string | null,
): WorkActivityTiming | null {
  if (!fingerprint) {
    return null;
  }
  const optimisticTimingKey =
    OPTIMISTIC_TIMING_KEY_BY_FINGERPRINT.get(fingerprint) ?? null;
  if (!optimisticTimingKey) {
    return null;
  }
  const optimisticTiming = TIMING_BY_GROUP.get(optimisticTimingKey) ?? null;
  if (!optimisticTiming) {
    OPTIMISTIC_TIMING_KEY_BY_FINGERPRINT.delete(fingerprint);
    return null;
  }
  TIMING_BY_GROUP.delete(optimisticTimingKey);
  TIMING_BY_GROUP.set(timingKey, optimisticTiming);
  OPTIMISTIC_TIMING_KEY_BY_FINGERPRINT.delete(fingerprint);
  return optimisticTiming;
}

function clearOptimisticTimingForThread(
  fingerprint: string,
  currentTimingKey: string,
): void {
  const threadId = threadIdForFingerprint(fingerprint);
  if (!threadId) {
    return;
  }
  for (const [candidateFingerprint, candidateTimingKey] of [
    ...OPTIMISTIC_TIMING_KEY_BY_FINGERPRINT,
  ]) {
    if (
      candidateTimingKey !== currentTimingKey &&
      threadIdForFingerprint(candidateFingerprint) === threadId
    ) {
      TIMING_BY_GROUP.delete(candidateTimingKey);
      OPTIMISTIC_TIMING_KEY_BY_FINGERPRINT.delete(candidateFingerprint);
    }
  }
}

function threadIdForFingerprint(fingerprint: string): string | null {
  try {
    const parsed = JSON.parse(fingerprint);
    return typeof parsed?.[0] === "string" ? parsed[0] : null;
  } catch {
    return null;
  }
}

export type ConversationTimelineEntry =
  | {
      kind: "item";
      item: ConversationItem;
    }
  | {
      kind: "workActivity";
      group: ConversationWorkActivityGroup;
    };

type MutableGroup = {
  turnId: string;
  items: ConversationItem[];
};

export function hasRenderableTaskPlan(taskPlan?: ConversationTaskSnapshot | null) {
  return Boolean(
    taskPlan &&
      (taskPlan.steps.length > 0 ||
        taskPlan.markdown.trim().length > 0 ||
        taskPlan.explanation.trim().length > 0),
  );
}

export function shouldRenderProposedPlan(plan?: ProposedPlanSnapshot | null) {
  return Boolean(plan && (plan.isAwaitingDecision || plan.status === "streaming"));
}

export function buildConversationTimeline(
  snapshot: ThreadConversationSnapshot,
): ConversationTimelineEntry[] {
  const groupsByTurn = new Map<string, MutableGroup>();
  const actionTurnIds = collectActionTurnIds(snapshot);
  const assistantSuppressedTurnIds = collectAssistantSuppressedTurnIds(snapshot);
  const effectiveTurnIds = inferEffectiveTurnIds(snapshot);
  const actionAssistantMessageIds = collectAssistantMessageIdsForTurns(
    snapshot.items,
    effectiveTurnIds,
    assistantSuppressedTurnIds,
  );
  const latestWorkTurnId = findLatestWorkTurnId(snapshot, effectiveTurnIds);
  const finalAssistantMessageIds = collectFinalAssistantMessageIds(
    snapshot,
    snapshot.items,
    effectiveTurnIds,
    actionTurnIds,
  );

  for (const item of snapshot.items) {
    const turnId = effectiveTurnIds.get(item.id) ?? null;
    if (
      actionAssistantMessageIds.has(item.id) ||
      !turnId ||
      !shouldRenderConversationItem(item) ||
      !isGroupedWorkItem(item, turnId, finalAssistantMessageIds)
    ) {
      continue;
    }
    getOrCreateGroup(groupsByTurn, turnId).items.push(item);
  }

  if (snapshot.activeTurnId) {
    getOrCreateGroup(groupsByTurn, snapshot.activeTurnId);
  }

  const finalizedGroups = new Map<string, ConversationWorkActivityGroup>();
  for (const [turnId, group] of groupsByTurn) {
    finalizedGroups.set(turnId, finalizeGroup(group, snapshot, latestWorkTurnId));
  }

  const entries: ConversationTimelineEntry[] = [];
  const emittedGroupTurnIds = new Set<string>();

  for (const item of snapshot.items) {
    if (actionAssistantMessageIds.has(item.id)) {
      continue;
    }

    const turnId = effectiveTurnIds.get(item.id) ?? null;
    const group = turnId ? finalizedGroups.get(turnId) : null;

    if (group && isGroupedWorkItem(item, turnId, finalAssistantMessageIds)) {
      if (!emittedGroupTurnIds.has(turnId!)) {
        entries.push({ kind: "workActivity", group });
        emittedGroupTurnIds.add(turnId!);
      }
      continue;
    }

    if (group && finalAssistantMessageIds.has(item.id) && !emittedGroupTurnIds.has(turnId!)) {
      entries.push({ kind: "workActivity", group });
      emittedGroupTurnIds.add(turnId!);
    }

    entries.push({ kind: "item", item });
  }

  for (const [turnId, group] of finalizedGroups) {
    if (!emittedGroupTurnIds.has(turnId)) {
      entries.push({ kind: "workActivity", group });
    }
  }

  return entries;
}

export function collectStructuredActionAssistantMessageIds(
  snapshot: ThreadConversationSnapshot,
) {
  const effectiveTurnIds = inferEffectiveTurnIds(snapshot);
  const actionTurnIds = collectAssistantSuppressedTurnIds(snapshot);
  return collectAssistantMessageIdsForTurns(
    snapshot.items,
    effectiveTurnIds,
    actionTurnIds,
  );
}

function collectActionTurnIds(snapshot: ThreadConversationSnapshot) {
  const turnIds = new Set<string>();

  if (shouldRenderProposedPlan(snapshot.proposedPlan)) {
    turnIds.add(snapshot.proposedPlan!.turnId);
  }

  for (const interaction of snapshot.pendingInteractions) {
    if (interaction.turnId) {
      turnIds.add(interaction.turnId);
    }
  }

  return turnIds;
}

function collectAssistantSuppressedTurnIds(snapshot: ThreadConversationSnapshot) {
  const turnIds = new Set<string>();

  if (shouldRenderProposedPlan(snapshot.proposedPlan)) {
    turnIds.add(snapshot.proposedPlan!.turnId);
  }

  for (const interaction of snapshot.pendingInteractions) {
    if (interaction.kind === "userInput" && interaction.turnId) {
      turnIds.add(interaction.turnId);
    }
  }

  return turnIds;
}

function collectFinalAssistantMessageIds(
  snapshot: ThreadConversationSnapshot,
  items: ConversationItem[],
  effectiveTurnIds: Map<string, string>,
  actionTurnIds: Set<string>,
) {
  const lastAssistantMessageIdByTurn = new Map<string, string>();
  const suppressedFinalTurnIds = new Set(actionTurnIds);
  if (snapshot.activeTurnId && snapshot.status === "running") {
    suppressedFinalTurnIds.add(snapshot.activeTurnId);
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const turnId = effectiveTurnIds.get(item.id);
    if (
      !turnId ||
      suppressedFinalTurnIds.has(turnId) ||
      lastAssistantMessageIdByTurn.has(turnId)
    ) {
      continue;
    }
    if (item.kind === "message" && item.role === "assistant") {
      lastAssistantMessageIdByTurn.set(turnId, item.id);
    }
  }

  const ids = new Set<string>();
  for (const itemId of lastAssistantMessageIdByTurn.values()) {
    ids.add(itemId);
  }

  return ids;
}

function collectAssistantMessageIdsForTurns(
  items: ConversationItem[],
  effectiveTurnIds: Map<string, string>,
  targetTurnIds: Set<string>,
) {
  const lastAssistantMessageIdByTurn = new Map<string, string>();

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const turnId = effectiveTurnIds.get(item.id);
    if (
      !turnId ||
      !targetTurnIds.has(turnId) ||
      lastAssistantMessageIdByTurn.has(turnId)
    ) {
      continue;
    }
    if (item.kind === "message" && item.role === "assistant") {
      lastAssistantMessageIdByTurn.set(turnId, item.id);
    }
  }

  return new Set(lastAssistantMessageIdByTurn.values());
}

function isGroupedWorkItem(
  item: ConversationItem,
  turnId: string | null,
  finalAssistantMessageIds: Set<string>,
) {
  if (!turnId) {
    return false;
  }
  if (item.kind === "message" && item.role === "user") {
    return false;
  }
  return !finalAssistantMessageIds.has(item.id);
}

function inferEffectiveTurnIds(snapshot: ThreadConversationSnapshot) {
  const turnIds = new Map<string, string>();
  const previousTurnIds: Array<string | null> = [];
  const nextTurnIds: Array<string | null> = new Array(snapshot.items.length).fill(null);
  let previousTurnId: string | null = null;

  snapshot.items.forEach((item, index) => {
    if (item.kind === "message" && item.role === "user") {
      previousTurnId = item.turnId ?? null;
      if (item.turnId) {
        turnIds.set(item.id, item.turnId);
      }
    } else if (item.turnId) {
      previousTurnId = item.turnId;
      turnIds.set(item.id, item.turnId);
    }
    previousTurnIds[index] = previousTurnId;
  });

  let nextTurnId: string | null = null;
  for (let index = snapshot.items.length - 1; index >= 0; index -= 1) {
    const item = snapshot.items[index];
    if (item.kind === "message" && item.role === "user") {
      nextTurnIds[index] = item.turnId ?? nextTurnId;
      nextTurnId = null;
      continue;
    }
    if (item.turnId) {
      nextTurnId = item.turnId;
    }
    nextTurnIds[index] = nextTurnId;
  }

  const activeTurnAnchorIndex = findActiveTurnAnchorIndex(snapshot);

  snapshot.items.forEach((item, index) => {
    if (
      turnIds.has(item.id) ||
      item.kind === "system" ||
      (item.kind === "message" && item.role === "user")
    ) {
      return;
    }

    const isBeforeActiveTurn =
      activeTurnAnchorIndex !== null && index <= activeTurnAnchorIndex;
    const inferredTurnId =
      (isBeforeActiveTurn ? null : nextTurnIds[index]) ??
      inferActiveTurnId(snapshot, index, activeTurnAnchorIndex) ??
      previousTurnIds[index] ??
      (isBeforeActiveTurn ? null : snapshot.activeTurnId) ??
      (isBeforeActiveTurn ? null : snapshot.taskPlan?.turnId) ??
      null;

    if (inferredTurnId) {
      turnIds.set(item.id, inferredTurnId);
    }
  });

  return turnIds;
}

function findActiveTurnAnchorIndex(snapshot: ThreadConversationSnapshot) {
  if (!snapshot.activeTurnId) {
    return null;
  }

  for (let index = 0; index < snapshot.items.length; index += 1) {
    if (snapshot.items[index]?.turnId === snapshot.activeTurnId) {
      for (let userIndex = index; userIndex >= 0; userIndex -= 1) {
        const item = snapshot.items[userIndex];
        if (item?.kind === "message" && item.role === "user") {
          return userIndex;
        }
      }
      return index;
    }
  }

  for (let index = snapshot.items.length - 1; index >= 0; index -= 1) {
    const item = snapshot.items[index];
    if (
      item?.kind === "message" &&
      item.role === "user" &&
      !item.turnId
    ) {
      return index;
    }
  }

  return null;
}

function inferActiveTurnId(
  snapshot: ThreadConversationSnapshot,
  index: number,
  activeTurnAnchorIndex: number | null,
) {
  if (!snapshot.activeTurnId) {
    return null;
  }

  if (activeTurnAnchorIndex === null) {
    return snapshot.activeTurnId;
  }

  return index > activeTurnAnchorIndex ? snapshot.activeTurnId : null;
}

function findLatestWorkTurnId(
  snapshot: ThreadConversationSnapshot,
  effectiveTurnIds: Map<string, string>,
) {
  if (snapshot.activeTurnId) {
    return snapshot.activeTurnId;
  }

  for (let index = snapshot.pendingInteractions.length - 1; index >= 0; index -= 1) {
    const turnId = snapshot.pendingInteractions[index]?.turnId;
    if (turnId) {
      return turnId;
    }
  }

  if (shouldRenderProposedPlan(snapshot.proposedPlan)) {
    return snapshot.proposedPlan!.turnId;
  }

  if (snapshot.taskPlan) {
    return snapshot.taskPlan.turnId;
  }

  for (let index = snapshot.items.length - 1; index >= 0; index -= 1) {
    const item = snapshot.items[index];
    if (
      !shouldRenderConversationItem(item) ||
      (item.kind === "message" && item.role === "user")
    ) {
      continue;
    }

    const turnId = effectiveTurnIds.get(item.id);
    if (turnId) {
      return turnId;
    }
  }

  return null;
}

function getOrCreateGroup(groupsByTurn: Map<string, MutableGroup>, turnId: string) {
  let group = groupsByTurn.get(turnId);
  if (group) {
    return group;
  }

  group = {
    turnId,
    items: [],
  };
  groupsByTurn.set(turnId, group);
  return group;
}

function finalizeGroup(
  group: MutableGroup,
  snapshot: ThreadConversationSnapshot,
  latestWorkTurnId: string | null,
): ConversationWorkActivityGroup {
  const renderableItems = group.items.filter(shouldRenderConversationItem);
  const counts = {
    updateCount: renderableItems.filter((item) => item.kind === "message").length,
    reasoningCount: renderableItems.filter((item) => item.kind === "reasoning").length,
    toolCount: renderableItems.filter((item) => item.kind === "tool").length,
    systemCount: renderableItems.filter((item) => item.kind === "system").length,
  };

  const status = statusForGroup(group.turnId, snapshot, latestWorkTurnId);
  const timingFingerprint = timingFingerprintForGroup(group.turnId, snapshot);
  const timing = recordTiming(
    timingKeyForGroup(group.turnId, snapshot),
    status,
    timingFingerprint,
    group.turnId === OPTIMISTIC_FIRST_TURN_ID,
  );

  return {
    id: `work-${group.turnId}`,
    turnId: group.turnId,
    items: renderableItems,
    counts,
    status,
    startedAt: timing?.startedAt ?? null,
    finishedAt: timing?.finishedAt ?? null,
  };
}

function timingFingerprintForGroup(
  turnId: string,
  snapshot: ThreadConversationSnapshot,
): string | null {
  const userMessage =
    turnId === OPTIMISTIC_FIRST_TURN_ID
      ? userMessageAtActiveTurnAnchor(snapshot)
      : firstUserMessageForTurn(snapshot, turnId);
  if (!userMessage) return null;
  return JSON.stringify([
    snapshot.threadId,
    userMessage.text,
    userMessage.images?.length ?? 0,
  ]);
}

function userMessageAtActiveTurnAnchor(
  snapshot: ThreadConversationSnapshot,
): ConversationMessageItem | null {
  const anchorIndex = findActiveTurnAnchorIndex(snapshot);
  const item = anchorIndex === null ? null : (snapshot.items[anchorIndex] ?? null);
  return item?.kind === "message" && item.role === "user" ? item : null;
}

function firstUserMessageForTurn(
  snapshot: ThreadConversationSnapshot,
  turnId: string,
): ConversationMessageItem | null {
  if (snapshot.activeTurnId === turnId) {
    const activeAnchor = userMessageAtActiveTurnAnchor(snapshot);
    if (activeAnchor) {
      return activeAnchor;
    }
  }
  for (const item of snapshot.items) {
    if (
      item.kind === "message" &&
      item.role === "user" &&
      item.turnId === turnId
    ) {
      return item;
    }
  }
  return null;
}

function timingKeyForGroup(
  turnId: string,
  snapshot: ThreadConversationSnapshot,
): string {
  const keyParts = [snapshot.threadId, turnId];
  if (turnId === OPTIMISTIC_FIRST_TURN_ID) {
    const anchorIndex = findActiveTurnAnchorIndex(snapshot);
    const anchorId =
      anchorIndex === null ? null : (snapshot.items[anchorIndex]?.id ?? null);
    if (anchorId) {
      keyParts.push(anchorId);
    }
  }
  return JSON.stringify(keyParts);
}

function statusForGroup(
  turnId: string,
  snapshot: ThreadConversationSnapshot,
  latestWorkTurnId: string | null,
): WorkActivityStatus {
  if (snapshot.activeTurnId === turnId) {
    return statusFromConversationStatus(snapshot.status);
  }

  if (turnId === latestWorkTurnId && snapshot.status !== "idle") {
    return statusFromConversationStatus(snapshot.status);
  }

  return "completed";
}

function statusFromConversationStatus(status: ConversationStatus): WorkActivityStatus {
  switch (status) {
    case "running":
      return "running";
    case "waitingForExternalAction":
      return "waiting";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      return "completed";
  }
}
