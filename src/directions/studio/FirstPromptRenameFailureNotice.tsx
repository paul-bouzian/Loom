import { useFirstPromptRenameStore } from "../../stores/first-prompt-rename-store";
import { CloseIcon } from "../../shared/Icons";
import "./AppUpdateNotice.css";
import "./FirstPromptRenameFailureNotice.css";

export function FirstPromptRenameFailureNotice() {
  const latestFailure = useFirstPromptRenameStore(
    (state) => state.latestFailure,
  );
  const dismissLatestFailure = useFirstPromptRenameStore(
    (state) => state.dismissLatestFailure,
  );

  if (!latestFailure) {
    return null;
  }

  const meta = latestFailure.branchName
    ? `${latestFailure.environmentName} / ${latestFailure.branchName}`
    : latestFailure.environmentName;

  return (
    <aside
      className="tx-update-notice tx-rename-failure-notice"
      aria-live="polite"
    >
      <div className="tx-update-notice__header">
        <div>
          <p className="tx-update-notice__eyebrow">Workspace naming</p>
          <h3 className="tx-update-notice__title">
            Couldn't rename branch and worktree
          </h3>
          <p className="tx-update-notice__meta">{meta}</p>
        </div>
        <button
          type="button"
          className="tx-update-notice__dismiss"
          onClick={dismissLatestFailure}
          title="Dismiss rename failure notice"
        >
          <CloseIcon size={12} />
        </button>
      </div>

      <p className="tx-update-notice__error">{latestFailure.message}</p>
    </aside>
  );
}
