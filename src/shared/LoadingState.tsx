import "./LoadingState.css";

export function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loading-state__spinner" />
      <p className="loading-state__text">Loading workspace...</p>
    </div>
  );
}
