import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

type Push = (message: string) => void;
interface Item {
  id: number;
  message: string;
}

const ToastContext = createContext<Push>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Set<number>());

  const push = useCallback<Push>((message) => {
    const id = nextId.current++;
    setItems((prev) => [...prev.slice(-3), { id, message }]);
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      setItems((prev) => prev.filter((i) => i.id !== id));
    }, 8000);
    timers.current.add(t);
  }, []);

  useEffect(() => {
    const set = timers.current;
    return () => set.forEach((t) => window.clearTimeout(t));
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div role="alert" className="fixed right-4 bottom-4 left-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:max-w-sm">
        {items.map((i) => (
          <div key={i.id} className="flex w-full items-start gap-2 rounded-ctl border border-blocked bg-panel px-3 py-2 text-sm shadow-lg">
            <Icon name="alert" className="mt-0.5 size-4 text-blocked" />
            <span className="min-w-0 flex-1 break-words">{i.message}</span>
            <button
              type="button"
              aria-label="Dismiss message"
              className="text-muted hover:text-text"
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== i.id))}
            >
              <Icon name="x" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
