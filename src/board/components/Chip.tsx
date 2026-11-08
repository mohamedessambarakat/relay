import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";

export function Chip({ icon, children, className = "" }: { icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span
      title={typeof children === "string" ? children : undefined}
      className={`inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 max-w-[12rem] truncate text-xs text-muted ${className}`}
    >
      {icon && <Icon name={icon} className="size-3" />}
      {children}
    </span>
  );
}
