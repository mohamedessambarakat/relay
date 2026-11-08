import { useState, type InputHTMLAttributes, type ReactNode } from "react";

export const controlClass =
  "w-full rounded-ctl border border-line bg-card px-2 py-1.5 text-text placeholder:text-muted disabled:opacity-50 font-chrome";

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur"> {
  value: string;
  onCommit: (next: string) => void;
}

/** Keeps its own draft while typing and commits on blur; follows the server value when that changes. */
export function TextField({ value, onCommit, className = "", ...rest }: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <input
      {...rest}
      className={`${controlClass} ${className}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
