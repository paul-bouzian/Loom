import {
  useWorkspaceStore,
  selectProjects,
  selectSelectedProject,
  selectSelectedEnvironment,
  selectSelectedThread,
} from "../../stores/workspace-store";
import { RuntimeIndicator } from "../../shared/RuntimeIndicator";
import "./StudioStatusBar.css";

export function StudioStatusBar() {
  const projects = useWorkspaceStore(selectProjects);
  const bootstrapStatus = useWorkspaceStore((s) => s.bootstrapStatus);
  const selectedProject = useWorkspaceStore(selectSelectedProject);
  const selectedEnvironment = useWorkspaceStore(selectSelectedEnvironment);
  const selectedThread = useWorkspaceStore(selectSelectedThread);

  const runningEnvironments = projects.flatMap((p) =>
    p.environments.filter((e) => e.runtime.state === "running"),
  );

  const breadcrumb = [
    selectedProject?.name,
    selectedEnvironment?.name,
    selectedThread?.title,
  ]
    .filter(Boolean)
    .join(" / ");

  return (
    <div className="studio-statusbar">
      <div className="studio-statusbar__left">
        {runningEnvironments.length > 0 ? (
          <span className="studio-statusbar__runtimes">
            {runningEnvironments.map((env) => (
              <span key={env.id} className="studio-statusbar__runtime-item">
                <RuntimeIndicator state={env.runtime.state} />
                <span>{env.name}</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="studio-statusbar__idle">No runtimes active</span>
        )}
      </div>
      <div className="studio-statusbar__center">
        {bootstrapStatus && (
          <span className="studio-statusbar__version">
            ThreadEx {bootstrapStatus.appVersion}
          </span>
        )}
      </div>
      <div className="studio-statusbar__right">
        {breadcrumb && (
          <span className="studio-statusbar__breadcrumb">{breadcrumb}</span>
        )}
      </div>
    </div>
  );
}
