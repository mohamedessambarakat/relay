import { EventEmitter } from "node:events";
import type { BoardEvent } from "../shared/types.ts";

/** In-process bus; the SSE endpoint forwards every event to open boards. */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(event: BoardEvent) {
    this.emitter.emit("event", event);
  }

  subscribe(fn: (event: BoardEvent) => void): () => void {
    this.emitter.on("event", fn);
    return () => this.emitter.off("event", fn);
  }
}
