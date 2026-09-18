import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { toolLabel } from "./labels.js";
import { createAsk, resolveAsk } from "./permissions.js";
import { getLive, openSession, register, unregister, type LiveSession } from "./sessions.js";
import type { ClientFrame, ServerFrame } from "./frames.js";

// Chats with a turn in flight — also consulted by the delete endpoint.
export const busyChats = new Set<string>();
const clients = new Set<WebSocket>();

function send(ws: WebSocket, frame: ServerFrame) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

export function broadcast(frame: ServerFrame) {
  for (const c of clients) send(c, frame);
}

// Consumes a live session's message stream for its whole lifetime. Frames go
// to whichever socket sent the most recent turn (session.sink).
async function pumpSession(session: LiveSession) {
  const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
  const out = (f: ServerFrame) => session.sink(f);
  try {
    for await (const msg of session.q) {
      const chatId = session.chatId;
      switch (msg.type) {
        case "system": {
          if (msg.subtype === "init") {
            if (!session.chatId) {
              session.chatId = msg.session_id;
              register(session);
            }
            busyChats.add(session.chatId);
            out({ type: "chat.session", chatId: session.chatId, workspace: session.workspace.id });
          }
          break;
        }
        case "stream_event": {
          if (msg.parent_tool_use_id) break;
          const e = msg.event;
          if (e.type === "content_block_start" && e.content_block.type === "tool_use") {
            const { id, name } = e.content_block;
            toolBlocks.set(e.index, { id, name, json: "" });
            out({ type: "tool.start", chatId, toolId: id, name, label: toolLabel(name, undefined) });
          } else if (e.type === "content_block_delta") {
            if (e.delta.type === "text_delta") out({ type: "text.delta", chatId, text: e.delta.text });
            else if (e.delta.type === "thinking_delta") out({ type: "thinking.delta", chatId, text: e.delta.thinking });
            else if (e.delta.type === "input_json_delta") {
              const tb = toolBlocks.get(e.index);
              if (tb) tb.json += e.delta.partial_json;
            }
          } else if (e.type === "content_block_stop") {
            const tb = toolBlocks.get(e.index);
            if (tb) {
              let input: unknown;
              try {
                input = JSON.parse(tb.json || "{}");
              } catch {
                input = undefined;
              }
              out({ type: "tool.end", chatId, toolId: tb.id, name: tb.name, label: toolLabel(tb.name, input), input });
              toolBlocks.delete(e.index);
            }
          }
          break;
        }
        case "assistant": {
          if (!msg.parent_tool_use_id) out({ type: "message.complete", chatId, content: msg.message.content });
          break;
        }
        case "user": {
          if (msg.parent_tool_use_id) break;
          const content = (msg.message as { content?: unknown })?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block?.type === "tool_result") out({ type: "tool.result", chatId, toolId: block.tool_use_id, isError: block.is_error === true });
            }
          }
          break;
        }
        case "result": {
          session.busy = false;
          busyChats.delete(chatId);
          out({
            type: "turn.done",
            chatId,
            subtype: msg.subtype,
            numTurns: msg.num_turns,
            costUsd: msg.total_cost_usd || undefined,
            durationMs: msg.duration_ms,
          });
          break;
        }
      }
    }
  } catch (err) {
    out({ type: "chat.error", chatId: session.chatId || null, error: String(err instanceof Error ? err.message : err) });
  } finally {
    session.busy = false;
    if (session.chatId) busyChats.delete(session.chatId);
    session.close();
    unregister(session);
  }
}

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    clients.add(ws);
    let pendingNew: LiveSession | null = null; // new chat awaiting its session id
    ws.on("close", () => clients.delete(ws));

    ws.on("message", (raw) => {
      let frame: ClientFrame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (frame.type === "chat.send") {
        const { chatId, text, workspace, voice } = frame;
        if (typeof text !== "string" || !text.trim()) return;

        let session: LiveSession | undefined = chatId ? getLive(chatId) : undefined;
        if (session?.busy || (chatId && busyChats.has(chatId))) {
          send(ws, { type: "chat.error", chatId, error: "A response is already in progress for this chat." });
          return;
        }
        if (!chatId && pendingNew && !pendingNew.chatId && !pendingNew.closed) {
          send(ws, { type: "chat.error", chatId: null, error: "Still starting the previous new chat." });
          return;
        }
        if (session && workspace && session.workspace.id !== workspace) {
          // Same chat id can't move between repos; start fresh in the new workspace.
          session = undefined;
        }
        if (!session) {
          try {
            session = openSession(workspace, chatId, { voice: !!voice });
          } catch (e) {
            send(ws, { type: "chat.error", chatId, error: (e as Error).message });
            return;
          }
          if (!chatId) pendingNew = session;
          void pumpSession(session);
        }
        const s = session;
        s.sink = (f) => send(ws, f);
        s.askImpl = (toolName, label, input) =>
          createAsk(s.chatId, toolName, label, input, (ask) =>
            send(ws, { type: "permission.ask", id: ask.id, chatId: ask.chatId, toolName: ask.toolName, label: ask.label, input: ask.input }),
          );
        if (s.chatId) busyChats.add(s.chatId);
        void s.send(text, { voice: !!voice });
      } else if (frame.type === "chat.interrupt") {
        getLive(frame.chatId)?.interrupt();
      } else if (frame.type === "permission.reply") {
        if (resolveAsk(frame.id, !!frame.allow)) broadcast({ type: "permission.resolved", id: frame.id, allow: !!frame.allow });
      }
    });
  });

  return wss;
}
