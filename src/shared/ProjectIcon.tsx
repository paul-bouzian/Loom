import { useEffect, useState } from "react";
import * as bridge from "../lib/bridge";
import "./ProjectIcon.css";

type Props = {
  name: string;
  rootPath?: string;
  size?: "sm" | "md" | "lg";
};

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

const iconCache = new Map<string, string>();

export function ProjectIcon({ name, rootPath, size = "md" }: Props) {
  const [iconSrc, setIconSrc] = useState<string | null>(readCachedIcon(rootPath));
  const [loaded, setLoaded] = useState(rootPath ? iconCache.has(rootPath) : true);

  useEffect(() => {
    const cachedIcon = readCachedIcon(rootPath);
    if (!rootPath || cachedIcon) {
      setIconSrc(cachedIcon);
      setLoaded(true);
      return;
    }

    let cancelled = false;
    bridge
      .getProjectIcon(rootPath)
      .then((path) => {
        if (cancelled) return;
        if (path) {
          iconCache.set(rootPath, path);
        }
        setIconSrc(path);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });

    return () => { cancelled = true; };
  }, [rootPath]);

  if (loaded && iconSrc) {
    return (
      <span className={`project-icon project-icon--${size} project-icon--img`}>
        <img
          src={iconSrc}
          alt={name}
          className="project-icon__img"
          onError={() => {
            if (rootPath) {
              iconCache.delete(rootPath);
            }
            setIconSrc(null);
          }}
        />
      </span>
    );
  }

  const initial = name.charAt(0).toUpperCase() || "P";
  const bg = hashColor(name);

  return (
    <span
      className={`project-icon project-icon--${size}`}
      style={{ background: bg }}
    >
      {initial}
    </span>
  );
}

function readCachedIcon(rootPath?: string) {
  return rootPath ? (iconCache.get(rootPath) ?? null) : null;
}
