import { useEffect } from "react";
import { useWorkspaceStore } from "./stores/workspace-store";
import { LoadingState } from "./shared/LoadingState";
import { StudioShell } from "./directions/studio/StudioShell";
import "./App.css";

function App() {
  const initialize = useWorkspaceStore((s) => s.initialize);
  const loadingState = useWorkspaceStore((s) => s.loadingState);
  const error = useWorkspaceStore((s) => s.error);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  if (loadingState === "idle" || loadingState === "loading") {
    return (
      <div className="app-loading">
        <LoadingState />
      </div>
    );
  }

  if (loadingState === "error") {
    return (
      <div className="app-error">
        <h2>Failed to load workspace</h2>
        <p>{error}</p>
        <button className="app-error__retry" onClick={() => void initialize()}>
          Retry
        </button>
      </div>
    );
  }

  return <StudioShell />;
}

export default App;
