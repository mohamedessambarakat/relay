import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, isAbort } from "./api.ts";
import { useToast } from "./components/Toast.tsx";

interface ResourceState<T> {
  key: unknown;
  data?: T;
  error?: string;
}

/** Loads data for `key`; a new key resets to loading and aborts the old request so stale responses are ignored. */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, key: string | number) {
  const toast = useToast();
  const [state, setState] = useState<ResourceState<T>>({ key });
  const [tick, setTick] = useState(0);
  if (state.key !== key) setState({ key });

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    const ac = new AbortController();
    loadRef.current(ac.signal).then(
      (data) => setState((s) => (s.key === key ? { key, data } : s)),
      (e: unknown) => {
        if (isAbort(e)) return;
        const message = errorMessage(e);
        // A failed background refresh keeps the data on screen and tells the user instead.
        setState((s) => (s.key === key && s.data === undefined ? { ...s, error: message } : s));
        toast(message);
      },
    );
    return () => ac.abort();
  }, [key, tick, toast]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const retry = useCallback(() => {
    setState((s) => ({ key: s.key, data: s.data }));
    setTick((t) => t + 1);
  }, []);
  const setData = useCallback(
    (update: (prev: T | undefined) => T | undefined) =>
      setState((s) => {
        const data = update(s.data);
        return data === undefined ? s : { ...s, data };
      }),
    [],
  );

  return { data: state.data, error: state.error, loading: state.data === undefined && state.error === undefined, reload, retry, setData };
}

export function useDebouncedCallback(fn: () => void, ms: number) {
  const ref = useRef(fn);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => ref.current(), ms);
  }, [ms]);
}

/** Current time, refreshed every `ms`, for "Running · 8m" labels. */
export function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export function formatElapsed(fromIso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000));
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
