import type { ReactNode } from "react";
import "./EmptyState.css";

type Props = {
  icon?: ReactNode;
  heading: string;
  body?: string;
  action?: ReactNode;
};

export function EmptyState({ icon, heading, body, action }: Props) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <h3 className="empty-state__heading">{heading}</h3>
      {body && <p className="empty-state__body">{body}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
