import { useEffect, useState } from "react";
import { IconRail } from "./IconRail";
import { TreeSidebar } from "./TreeSidebar";
import { StudioMain } from "./StudioMain";
import { InspectorPanel } from "./InspectorPanel";
import { StudioStatusBar } from "./StudioStatusBar";
import "./StudioShell.css";

export type RailSection = "projects" | "search" | "settings";
export type Theme = "dark" | "light";

function readTheme(): Theme {
  try {
    const v = localStorage.getItem("threadex-theme");
    if (v === "light") return "light";
  } catch { /* ignore */ }
  return "dark";
}

export function StudioShell() {
  const [activeSection, setActiveSection] = useState<RailSection>("projects");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("threadex-theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  return (
    <div className="studio-shell">
      <IconRail
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      {sidebarOpen && <TreeSidebar activeSection={activeSection} />}
      <StudioMain
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
      />
      {inspectorOpen && <InspectorPanel />}
      <StudioStatusBar />
    </div>
  );
}
