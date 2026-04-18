import type { EnvironmentRecord, ThreadConversationSnapshot, ThreadRecord } from "../../lib/types";
import { labelForConversationStatus } from "../../lib/conversation-status";
import { AlertIcon, CloseIcon, SpinnerIcon } from "../../shared/Icons";
import { Tooltip } from "../../shared/Tooltip";

type Props = {
  environment: EnvironmentRecord;
  thread: ThreadRecord;
  snapshot?: ThreadConversationSnapshot | null;
  connectionState?: "idle" | "connecting" | "error";
  onRetryConnection?: (() => void) | null;
  onClose?: (() => void) | null;
};

export function ConversationMeta({
  environment,
  thread,
  snapshot = null,
  connectionState = "idle",
  onRetryConnection = null,
  onClose = null,
}: Props) {
  return (
    <div className="tx-conversation__meta">
      <div>
        <h2 className="tx-conversation__title">{thread.title}</h2>
        <p className="tx-conversation__subtitle">{environment.name}</p>
      </div>
      <div className="tx-conversation__status-group">
        {snapshot ? renderStatusIcon(snapshot.status) : null}
        {connectionState === "connecting" ? (
          <span className="tx-pill tx-pill--neutral tx-pill--connecting">
            Connecting…
          </span>
        ) : null}
        {connectionState === "error" ? (
          onRetryConnection ? (
            <button
              type="button"
              className="tx-pill tx-pill--neutral tx-pill--action"
              onClick={onRetryConnection}
            >
              Reconnect
            </button>
          ) : (
            <span className="tx-pill tx-pill--failed">Reconnect needed</span>
          )
        ) : null}
        {snapshot?.tokenUsage ? (
          <span
            className="tx-pill tx-pill--neutral"
            title={`${snapshot.tokenUsage.total.totalTokens.toLocaleString()} tokens`}
          >
            {formatTokenCount(snapshot.tokenUsage.total.totalTokens)} tokens
          </span>
        ) : null}
      </div>
      {onClose ? (
        <Tooltip content="Close pane" side="bottom">
          <button
            type="button"
            aria-label="Close pane"
            className="tx-conversation__close"
            onClick={onClose}
          >
            <CloseIcon size={12} />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

function renderStatusIcon(status: ThreadConversationSnapshot["status"]) {
  if (status === "running") {
    return (
      <span
        className="tx-conversation__status-icon tx-conversation__status-icon--running"
        aria-label={labelForConversationStatus(status)}
        role="status"
      >
        <SpinnerIcon size={14} />
      </span>
    );
  }
  if (status === "waitingForExternalAction") {
    return (
      <span
        className="tx-conversation__status-icon tx-conversation__status-icon--waiting"
        aria-label={labelForConversationStatus(status)}
        role="status"
      >
        <AlertIcon size={14} />
      </span>
    );
  }
  return null;
}

function formatTokenCount(value: number): string {
  if (value < 1_000) return value.toString();
  if (value < 1_000_000) return `${trimDecimal(value / 1_000)}K`;
  if (value < 1_000_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  return `${trimDecimal(value / 1_000_000_000)}B`;
}

function trimDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}
