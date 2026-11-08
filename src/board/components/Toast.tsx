import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

export type ToastKind = "error" | "success" | "info";
/** push(message) shows an error (the default); pass "success" or "info" for feedback after an action. */
type Push = (message: string, kind?: ToastKind) => void;
interface Item {
  id: number;
  message: string;
  kind: ToastKind;
}

const ToastContext = createContext<Push>(() => {});
export const useToast = () => useContext(ToastContext);

// Errors stay longer: keyboard users need time to reach them.
const DURATION: Record<ToastKind, number> = { error: 20_000, success: 4_000, info: 6_000 };
const STYLE: Record<ToastKind, { border: string; icon: "alert" | "check" | "info"; color: string }> = {
  error: { border: "border-blocked", icon: "alert", color: "text-blocked" },
  success: { border: "border-done", icon: "check", color: "text-done" },
  info: { border: "border-control", icon: "info", color: "text-muted" },
};

function ToastItem({ item, onDismiss }: { item: Item; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(onDismiss, DURATION[item.kind]);
    return () => window.clearTimeout(t);
  }, [paused, item.kind, onDismiss]);
  const s = STYLE[item.kind];
  return (
    <div
      role={item.kind === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`flex w-full items-start gap-2 rounded-ctl border ${s.border} bg-panel px-3 py-2 font-ui text-sm shadow-lg`}
    >
      <Icon name={s.icon} className={`mt-0.5 size-4 shrink-0 ${s.color}`} />
      <span className="min-w-0 flex-1 break-words">{item.message}</span>
      <button type="button" aria-label="Dismiss message" className="-m-1 rounded p-1.5 text-muted hover:text-text" onClick={onDismiss}>
        <Icon name="x" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const nextId = useRef(1);

  const push = useCallback<Push>((message, kind = "error") => {
    setItems((prev) => {
      // Background reloads can fail repeatedly; don't stack the same message.
      if (prev.some((p) => p.message === message && p.kind === kind)) return prev;
      return [...prev.slice(-3), { id: nextId.current++, message, kind }];
    });
  }, []);

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((i) => i.id !== id)), []);
  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 bottom-4 left-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:max-w-sm">
        {items.map((i) => (
          <ToastItem key={i.id} item={i} onDismiss={() => dismiss(i.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
