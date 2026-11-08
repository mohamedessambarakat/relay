import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button.tsx";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
}
type Confirm = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm>(async () => false);
/** `if (await confirm({...})) doIt()` — resolves false on Cancel or Escape. Focus returns to where it was. */
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const confirm = useCallback<Confirm>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        returnTo.current = document.activeElement as HTMLElement | null;
        setReq({ ...opts, resolve });
      }),
    [],
  );

  useEffect(() => {
    if (req && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [req]);

  const finish = (ok: boolean) => {
    req?.resolve(ok);
    dialog.current?.close();
    setReq(null);
    const el = returnTo.current;
    if (el?.isConnected) el.focus();
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {req && (
        <dialog
          ref={dialog}
          aria-labelledby="confirm-title"
          aria-describedby={req.body ? "confirm-body" : undefined}
          onCancel={(e) => {
            e.preventDefault();
            finish(false);
          }}
          className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-ctl border border-control bg-panel p-5 text-text backdrop:bg-black/60"
        >
          <h2 id="confirm-title" className="font-ui text-base font-semibold">
            {req.title}
          </h2>
          {req.body && (
            <p id="confirm-body" className="mt-2 font-ui text-sm text-muted">
              {req.body}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button autoFocus onClick={() => finish(false)}>
              Cancel
            </Button>
            <Button variant={req.danger ? "danger" : "primary"} onClick={() => finish(true)}>
              {req.confirmLabel}
            </Button>
          </div>
        </dialog>
      )}
    </ConfirmContext.Provider>
  );
}
