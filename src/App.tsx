import "./App.css";
import { useEffect, useState } from "react";
import { getBootstrapStatus, type BootstrapStatus } from "./lib/bootstrap";

function App() {
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getBootstrapStatus()
      .then(setStatus)
      .catch((cause: unknown) => {
        const message =
          cause instanceof Error ? cause.message : "Unknown desktop error";
        setError(message);
      });
  }, []);

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="rail__brand">
          <span className="rail__mark">TX</span>
          <div>
            <p className="eyebrow">Bootstrap</p>
            <h1>ThreadEx</h1>
          </div>
        </div>
        <div className="rail__section">
          <p className="eyebrow">Scope</p>
          <ul className="stack-list">
            <li>Codex only</li>
            <li>macOS only</li>
            <li>App-server first</li>
            <li>Local-first</li>
          </ul>
        </div>
      </aside>

      <main className="content">
        <section className="hero">
          <p className="eyebrow">Foundation ready</p>
          <h2>Base desktop shell initialized.</h2>
          <p className="hero__copy">
            The repository now contains the desktop shell, Rust backend entry
            point, typed frontend, linting, and the first desktop-safe modules
            needed to start modeling the real application.
          </p>
        </section>

        <section className="grid">
          <article className="panel">
            <p className="eyebrow">Frontend</p>
            <ul className="stack-list">
              <li>React 19</li>
              <li>TypeScript</li>
              <li>Vite 7</li>
              <li>ESLint 9</li>
            </ul>
          </article>

          <article className="panel">
            <p className="eyebrow">Desktop</p>
            <ul className="stack-list">
              <li>Tauri v2</li>
              <li>Rust 1.94</li>
              <li>Dialog, Store, Notifications</li>
              <li>Ready for process supervision</li>
            </ul>
          </article>

          <article className="panel panel--wide">
            <p className="eyebrow">Runtime status</p>
            {status ? (
              <dl className="status-grid">
                <div>
                  <dt>App</dt>
                  <dd>{status.appName}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{status.appVersion}</dd>
                </div>
                <div>
                  <dt>Platform</dt>
                  <dd>{status.platform}</dd>
                </div>
                <div>
                  <dt>Rust backend</dt>
                  <dd>{status.backend}</dd>
                </div>
              </dl>
            ) : (
              <p className="status-empty">
                {error ?? "Waiting for the desktop bridge to respond..."}
              </p>
            )}
          </article>
        </section>
      </main>
    </div>
  );
}

export default App;
