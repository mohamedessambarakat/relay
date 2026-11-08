import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";

export function Chip({ icon, children, className = "" }: { icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted ${className}`}>
      {icon && <Icon name={icon} className="size-3" />}
      {children}
    </span>
  );
}
