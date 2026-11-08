import { useEffect, useRef, useSyncExternalStore } from "react";
import type { BoardEvent } from "../shared/types.ts";

// "reconnect" is synthetic: the server sent "ready", so anything may have changed while we were away.
export type BoardMessage = BoardEvent | { type: "reconnect" };

const listeners = new Set<(m: BoardMessage) => void>();
const connectionListeners = new Set<() => void>();
let source: EventSource | null = null;
// Optimistic: the bar only appears after a real error, so first load doesn't flash it.
let connected = true;

const emit = (m: BoardMessage) => listeners.forEach((l) => l(m));

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  connectionListeners.forEach((l) => l());
}

function connect() {
  source = new EventSource("/api/events");
  // EventSource retries by itself after an error; we only mirror its state.
  source.addEventListener("open", () => setConnected(true));
  source.addEventListener("error", () => setConnected(false));
  source.addEventListener("ready", () => {
    setConnected(true);
    emit({ type: "reconnect" });
  });
  source.addEventListener("message", (e) => {
    try {
      emit(JSON.parse((e as MessageEvent<string>).data) as BoardEvent);
    } catch (err) {
      console.error("Bad event from Relay", err);
    }
  });
}

function subscribe(l: (m: BoardMessage) => void) {
  listeners.add(l);
  if (!source) connect();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) {
      source?.close();
      source = null;
      connected = true;
    }
  };
}

export function useBoardEvents(listener: (m: BoardMessage) => void) {
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  });
  useEffect(() => subscribe((m) => ref.current(m)), []);
}

/** False while the live connection to Relay is down (the browser keeps retrying). */
export function useConnected(): boolean {
  return useSyncExternalStore(
    (cb) => {
      connectionListeners.add(cb);
      return () => connectionListeners.delete(cb);
    },
    () => connected,
  );
}
