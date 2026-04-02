import type { ReactNode } from "react";
import { FolderIcon, SearchIcon, SettingsIcon, SunIcon, MoonIcon } from "../../shared/Icons";
import type { RailSection } from "./StudioShell";
import "./IconRail.css";

type Props = {
  activeSection: RailSection;
  onSectionChange: (s: RailSection) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
};

const topItems: { key: RailSection; icon: ReactNode; title: string }[] = [
  { key: "projects", icon: <FolderIcon size={18} />, title: "Projects" },
  { key: "search", icon: <SearchIcon size={18} />, title: "Search" },
];

export function IconRail({
  activeSection,
  onSectionChange,
  sidebarOpen,
  onToggleSidebar,
  theme,
  onToggleTheme,
}: Props) {
  function handleClick(key: RailSection) {
    if (activeSection === key && sidebarOpen) {
      onToggleSidebar();
    } else {
      onSectionChange(key);
      if (!sidebarOpen) onToggleSidebar();
    }
  }

  return (
    <nav className="icon-rail">
      <div className="icon-rail__top">
        {topItems.map((item) => (
          <button
            key={item.key}
            className={`icon-rail__btn ${activeSection === item.key && sidebarOpen ? "icon-rail__btn--active" : ""}`}
            title={item.title}
            onClick={() => handleClick(item.key)}
          >
            <span className="icon-rail__icon">{item.icon}</span>
          </button>
        ))}
      </div>
      <div className="icon-rail__bottom">
        <button
          className={`icon-rail__btn ${activeSection === "settings" && sidebarOpen ? "icon-rail__btn--active" : ""}`}
          title="Settings"
          onClick={() => handleClick("settings")}
        >
          <span className="icon-rail__icon"><SettingsIcon size={18} /></span>
        </button>
        <button
          className="icon-rail__btn"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onClick={onToggleTheme}
        >
          <span className="icon-rail__icon">
            {theme === "dark" ? <SunIcon size={18} /> : <MoonIcon size={18} />}
          </span>
        </button>
      </div>
    </nav>
  );
}
