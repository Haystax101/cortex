import { EventEmitter } from "node:events";
import type { ServerFrame } from "./frames.js";

// In-process event bus. Workers publish here; the WebSocket layer broadcasts
// frames to every client and the conductor listens for things worth saying.

export type WorkerEvent =
  | { kind: "finished"; taskId: string }
  | { kind: "question"; taskId: string }
  | { kind: "failed"; taskId: string }
  | { kind: "approval"; taskId: string; approvalId: string };

class Bus extends EventEmitter {
  frame(f: ServerFrame) {
    this.emit("frame", f);
  }
  worker(e: WorkerEvent) {
    this.emit("worker", e);
  }
}

export const bus = new Bus();
bus.setMaxListeners(50);
