import type { EnvironmentRecord, ThreadConversationSnapshot, ThreadRecord } from "../../lib/types";

type Props = {
  environment: EnvironmentRecord;
  snapshot: ThreadConversationSnapshot;
  thread: ThreadRecord;
};

export function ConversationMeta({ environment, snapshot, thread }: Props) {
  return (
    <div className="tx-conversation__meta">
      <div>
        <h2 className="tx-conversation__title">{thread.title}</h2>
        <p className="tx-conversation__subtitle">
          {environment.name}
          {snapshot.codexThreadId ? <> · {snapshot.codexThreadId}</> : null}
        </p>
      </div>
      <div className="tx-conversation__status-group">
        <span className={`tx-pill tx-pill--${snapshot.status}`}>
          {labelForStatus(snapshot.status)}
        </span>
        {snapshot.tokenUsage ? (
          <span className="tx-pill tx-pill--neutral">
            {snapshot.tokenUsage.total.totalTokens.toLocaleString()} tokens
          </span>
        ) : null}
      </div>
    </div>
  );
}

function labelForStatus(status: string) {
  if (status === "waitingForExternalAction") return "Waiting";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
