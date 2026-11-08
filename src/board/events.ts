import { useEffect, useRef } from "react";
import type { BoardEvent } from "../shared/types.ts";

// "reconnect" is synthetic: the server sent "ready", so anything may have changed while we were away.
export type BoardMessage = BoardEvent | { type: "reconnect" };

const listeners = new Set<(m: BoardMessage) => void>();
let source: EventSource | null = null;

const emit = (m: BoardMessage) => listeners.forEach((l) => l(m));

function connect() {
  source = new EventSource("/api/events");
  source.addEventListener("ready", () => emit({ type: "reconnect" }));
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
