import type { OpenTarget } from "../../lib/types";

export type DraftOpenTarget = {
  draftKey: string;
  target: OpenTarget;
};

export type DraftIssues = {
  global: string | null;
};

export type OpenInDraftState = {
  targets: DraftOpenTarget[];
  defaultDraftKey: string | null;
};

let nextDraftId = 0;

export function buildDraftState(targets: OpenTarget[], defaultTargetId: string) {
  const nextTargets = buildDraftTargets(targets);
  return {
    targets: nextTargets,
    defaultDraftKey: resolveDefaultDraftKey(nextTargets, defaultTargetId),
  };
}

export function validateDraftTargets(
  targets: DraftOpenTarget[],
  defaultDraftKey: string | null,
): DraftIssues {
  if (targets.length === 0) {
    return { global: "At least one Open In target is required." };
  }

  if (!defaultDraftKey || !targets.some((target) => target.draftKey === defaultDraftKey)) {
    return { global: "Choose a default target." };
  }

  return { global: null };
}

export function matchesPersistedTargets(
  draftTargets: DraftOpenTarget[],
  defaultDraftKey: string | null,
  targets: OpenTarget[],
  defaultTargetId: string,
) {
  if (draftTargets.length !== targets.length) {
    return false;
  }

  const defaultTarget = draftTargets.find((target) => target.draftKey === defaultDraftKey);
  if (!defaultTarget || defaultTarget.target.id !== defaultTargetId) {
    return false;
  }

  return draftTargets.every((target, index) => {
    const persisted = targets[index];
    return persisted ? openTargetsEqual(target.target, persisted) : false;
  });
}

export function persistedOpenInSettingsEqual(
  leftTargets: OpenTarget[],
  leftDefaultTargetId: string,
  rightTargets: OpenTarget[],
  rightDefaultTargetId: string,
) {
  return (
    leftDefaultTargetId === rightDefaultTargetId &&
    leftTargets.length === rightTargets.length &&
    leftTargets.every((target, index) => {
      const otherTarget = rightTargets[index];
      return otherTarget ? openTargetsEqual(target, otherTarget) : false;
    })
  );
}

export function persistDraftTargets(state: OpenInDraftState) {
  const defaultTarget = state.targets.find(
    (target) => target.draftKey === state.defaultDraftKey,
  );
  if (!defaultTarget) {
    return null;
  }

  return {
    openTargets: state.targets.map(({ target }) => cloneOpenTarget(target)),
    defaultOpenTargetId: defaultTarget.target.id,
  };
}

export function moveDraftTarget(
  targets: DraftOpenTarget[],
  draftKey: string,
  direction: -1 | 1,
) {
  const index = targets.findIndex((target) => target.draftKey === draftKey);
  const nextIndex = index + direction;
  if (index === -1 || nextIndex < 0 || nextIndex >= targets.length) {
    return targets;
  }

  const nextTargets = targets.slice();
  const [target] = nextTargets.splice(index, 1);
  if (!target) {
    return targets;
  }
  nextTargets.splice(nextIndex, 0, target);
  return nextTargets;
}

function openTargetsEqual(left: OpenTarget, right: OpenTarget) {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.kind === right.kind &&
    (left.appName ?? null) === (right.appName ?? null)
  );
}

function buildDraftTargets(targets: OpenTarget[]) {
  return targets.map((target) => ({
    draftKey: nextOpenTargetDraftKey(),
    target: cloneOpenTarget(target),
  }));
}

function resolveDefaultDraftKey(
  targets: DraftOpenTarget[],
  defaultTargetId: string,
) {
  if (targets.length === 0) {
    return null;
  }

  const matched = targets.find((target) => target.target.id === defaultTargetId);
  return matched ? matched.draftKey : targets[0]?.draftKey ?? null;
}

function cloneOpenTarget(target: OpenTarget): OpenTarget {
  return { ...target };
}

function nextOpenTargetDraftKey() {
  nextDraftId += 1;
  return `open-target-draft-${nextDraftId}`;
}
