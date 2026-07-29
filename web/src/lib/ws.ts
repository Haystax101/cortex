import type { ServerFrame } from "./types";

type FrameHandler = (frame: ServerFrame) => void;
type StatusHandler = (connected: boolean) => void;

// Singleton WebSocket with auto-reconnect. Frames route to the store.
class WsClient {
  private ws: WebSocket | null = null;
  private onFrame: FrameHandler = () => {};
  private onStatus: StatusHandler = () => {};
  private retryMs = 1000;
  private closed = false;

  connect(onFrame: FrameHandler, onStatus: StatusHandler) {
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.open();
  }

  private open() {
    if (this.closed) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      this.retryMs = 1000;
      this.onStatus(true);
    };
    this.ws.onmessage = (ev) => {
      try {
        this.onFrame(JSON.parse(ev.data));
      } catch {
        // ignore malformed frames
      }
    };
    this.ws.onclose = () => {
      this.onStatus(false);
      setTimeout(() => this.open(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 1.6, 8000);
    };
    this.ws.onerror = () => this.ws?.close();
  }

  send(frame: { type: "chat.send"; chatId: string | null; text: string } | { type: "chat.interrupt"; chatId: string }) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
      return true;
    }
    return false;
  }
}

export const wsClient = new WsClient();
