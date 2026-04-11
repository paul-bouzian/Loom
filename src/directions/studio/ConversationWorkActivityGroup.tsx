import { type UIEvent, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { SubagentThreadSnapshot } from "../../lib/types";
import { ChevronRightIcon } from "../../shared/Icons";
import { ConversationItemRow } from "./ConversationItemRow";
import { ConversationTaskCard } from "./ConversationTaskCard";
import type {
  ConversationWorkActivityGroup as ConversationWorkActivityGroupData,
  WorkActivityStatus,
} from "./conversation-work-activity";

type Props = {
  group: ConversationWorkActivityGroupData;
};

const WORK_ACTIVITY_BOTTOM_THRESHOLD_PX = 24;

export function ConversationWorkActivityGroup({ group }: Props) {
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowBottomRef = useRef(true);
  const summary = useMemo(() => buildSummary(group), [group]);

  useLayoutEffect(() => {
    if (!expanded || !shouldFollowBottomRef.current) {
      return;
    }

    const body = bodyRef.current;
    if (!body) {
      return;
    }

    scrollToBottom(body);
  }, [expanded, group]);

  function toggleExpanded() {
    setExpanded((value) => {
      const nextExpanded = !value;
      if (nextExpanded) {
        shouldFollowBottomRef.current = true;
      }
      return nextExpanded;
    });
  }

  function handleBodyScroll(event: UIEvent<HTMLDivElement>) {
    shouldFollowBottomRef.current = isNearBottom(event.currentTarget);
  }

  return (
    <section className="tx-work-activity">
      <button
        type="button"
        className="tx-work-activity__toggle"
        aria-expanded={expanded}
        aria-label={expanded ? "Hide work activity details" : "Show work activity details"}
        onClick={toggleExpanded}
      >
        <div className="tx-work-activity__header">
          <span className="tx-item__header-main">
            <ChevronRightIcon
              size={12}
              className={`tx-item__chevron ${expanded ? "tx-item__chevron--expanded" : ""}`}
            />
            Work activity
          </span>
          <span className={`tx-pill tx-pill--${group.status}`}>
            {labelForStatus(group.status)}
          </span>
        </div>
        {summary ? <p className="tx-work-activity__summary">{summary}</p> : null}
      </button>
      {expanded ? (
        <div
          ref={bodyRef}
          className="tx-work-activity__body"
          onScroll={handleBodyScroll}
        >
          {group.taskPlan ? <ConversationTaskCard taskPlan={group.taskPlan} compact /> : null}
          {group.subagents.length > 0 ? (
            <div className="tx-work-activity__subagents">
              <div className="tx-item__header">Subagents</div>
              <div className="tx-work-activity__subagent-list">
                {group.subagents.map((subagent) => (
                  <div key={subagent.threadId} className="tx-work-activity__subagent">
                    <div className="tx-work-activity__subagent-copy">
                      <span className="tx-work-activity__subagent-name">
                        {labelForSubagent(subagent)}
                      </span>
                      {subagent.role ? (
                        <span className="tx-work-activity__subagent-role">{subagent.role}</span>
                      ) : null}
                    </div>
                    <span className={`tx-pill tx-pill--${toneForSubagent(subagent.status)}`}>
                      {labelForSubagentStatus(subagent.status)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {group.items.map((item) => (
            <ConversationItemRow key={item.id} item={item} compact />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function isNearBottom(element: HTMLElement) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    WORK_ACTIVITY_BOTTOM_THRESHOLD_PX
  );
}

function scrollToBottom(element: HTMLElement) {
  element.scrollTop = element.scrollHeight;
}

function buildSummary(group: ConversationWorkActivityGroupData) {
  const parts = [
    formatCount(group.counts.updateCount + group.counts.systemCount, "update", "updates"),
    formatCount(group.counts.reasoningCount, "thinking", "thinking"),
    formatCount(group.counts.toolCount, "tool call", "tool calls"),
    formatCount(group.counts.subagentCount, "subagent", "subagents"),
  ].filter(Boolean);

  if (parts.length === 0 && group.taskPlan) {
    return "Task tracker";
  }

  return parts.join(" · ");
}

function formatCount(value: number, singular: string, plural: string) {
  if (value <= 0) {
    return "";
  }
  return `${value} ${value === 1 ? singular : plural}`;
}

function labelForStatus(status: WorkActivityStatus) {
  switch (status) {
    case "waiting":
      return "Waiting";
    case "interrupted":
      return "Interrupted";
    case "failed":
      return "Failed";
    case "completed":
      return "Completed";
    default:
      return "Running";
  }
}

function labelForSubagent(subagent: SubagentThreadSnapshot) {
  return subagent.nickname ?? subagent.role ?? subagent.threadId.slice(0, 8);
}

function labelForSubagentStatus(status: SubagentThreadSnapshot["status"]) {
  if (status === "running") return "Running";
  if (status === "failed") return "Failed";
  return "Completed";
}

function toneForSubagent(status: SubagentThreadSnapshot["status"]) {
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  return "completed";
}
