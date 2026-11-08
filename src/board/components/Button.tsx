import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon.tsx";

type Variant = "default" | "primary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  default: "border-control bg-card hover:bg-card-hover text-text",
  primary: "border-transparent bg-accent text-accent-text font-semibold hover:brightness-110",
  danger: "border-blocked bg-transparent text-blocked hover:bg-blocked/10",
  ghost: "border-transparent bg-transparent text-muted hover:text-text hover:bg-card",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
}

/** Icon-only buttons must pass aria-label and no children. */
export function Button({ variant = "default", icon, children, className = "", type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      className={`transition-colors active:scale-[0.98] motion-safe:transition-transform inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl border px-3 py-1.5 disabled:opacity-50 ${VARIANTS[variant]} ${children ? "" : "px-1.5"} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}
