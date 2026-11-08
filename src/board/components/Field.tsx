import { useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";

export const controlClass =
  "w-full rounded-ctl border border-control bg-card px-2 py-1.5 text-text placeholder:text-muted disabled:opacity-50 font-chrome transition-colors";

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
  /** Return false (or reject) when the save failed; the draft then goes back to the server value. */
  onCommit: (next: string) => void | boolean | Promise<boolean | void>;
}

/** Keeps its own draft while typing and commits on blur; follows the server value except while focused. */
export function TextField({ value, onCommit, className = "", ...rest }: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [focused, setFocused] = useState(false);
  const base = useRef(value);
  if (value !== seen && !focused) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <input
      {...rest}
      className={`${controlClass} ${className}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        base.current = value;
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
        if (draft === base.current) {
          setDraft(value);
          return;
        }
        void (async () => {
          try {
            if ((await onCommit(draft)) === false) setDraft(value);
          } catch {
            setDraft(value);
          }
        })();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
