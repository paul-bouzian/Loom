import { useWorkspaceStore, selectSelectedEnvironment } from "../../stores/workspace-store";
import * as bridge from "../../lib/bridge";
import { CloseIcon, PlusIcon } from "../../shared/Icons";
import type { ThreadRecord } from "../../lib/types";
import "./ThreadTabs.css";

export function ThreadTabs() {
  const selectedEnvironment = useWorkspaceStore(selectSelectedEnvironment);
  const selectedThreadId = useWorkspaceStore((s) => s.selectedThreadId);
  const selectThread = useWorkspaceStore((s) => s.selectThread);
  const refreshSnapshot = useWorkspaceStore((s) => s.refreshSnapshot);

  if (!selectedEnvironment) return null;

  const activeThreads = selectedEnvironment.threads.filter(
    (t) => t.status === "active",
  );

  async function handleNewThread() {
    if (!selectedEnvironment) return;
    const thread = await bridge.createThread({ environmentId: selectedEnvironment.id });
    await refreshSnapshot();
    selectThread(thread.id);
  }

  async function handleArchiveThread(thread: ThreadRecord) {
    await bridge.archiveThread({ threadId: thread.id });
    if (selectedThreadId === thread.id) {
      const remaining = activeThreads.filter((t) => t.id !== thread.id);
      selectThread(remaining.length > 0 ? remaining[0].id : null);
    }
    await refreshSnapshot();
  }

  return (
    <div className="thread-tabs">
      <div className="thread-tabs__list">
        {activeThreads.map((thread) => (
          <div
            key={thread.id}
            className={`thread-tab ${selectedThreadId === thread.id ? "thread-tab--active" : ""}`}
          >
            <button
              type="button"
              className="thread-tab__select"
              title={thread.title}
              onClick={() => selectThread(thread.id)}
            >
              <span className="thread-tab__title">{thread.title}</span>
            </button>
            <button
              type="button"
              className="thread-tab__close"
              title={`Close ${thread.title}`}
              onClick={() => void handleArchiveThread(thread)}
            >
              <CloseIcon size={10} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="thread-tabs__new"
        title="New thread"
        onClick={() => void handleNewThread()}
      >
        <PlusIcon size={12} />
      </button>
    </div>
  );
}
