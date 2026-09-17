import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { runTurn, type Run } from "./agent.js";
import { toolLabel } from "./labels.js";
import { createAsk, resolveAsk } from "./permissions.js";
import type { ClientFrame, ServerFrame } from "./frames.js";

// Chats with a turn in flight — also consulted by the delete endpoint.
export const busyChats = new Set<string>();
const activeRuns = new Map<string, Run>();
const clients = new Set<WebSocket>();

function send(ws: WebSocket, frame: ServerFrame) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

export function broadcast(frame: ServerFrame) {
  for (const c of clients) send(c, frame);
}

async function pump(ws: WebSocket, run: Run, initialChatId: string | null) {
  let chatId = initialChatId ?? "";
  // Accumulates streaming tool_use input JSON by content-block index.
  const toolBlocks = new Map<number, { id: string; name: string; json: string }>();

  try {
    for await (const msg of run.q) {
      switch (msg.type) {
        case "system": {
          if (msg.subtype === "init") {
            chatId = msg.session_id;
            busyChats.add(chatId);
            activeRuns.set(chatId, run);
            send(ws, { type: "chat.session", chatId, workspace: run.workspace.id });
          }
          break;
        }
        case "stream_event": {
          if (msg.parent_tool_use_id) break; // subagent internals: shown via their Task tool chip
          const e = msg.event;
          if (e.type === "content_block_start" && e.content_block.type === "tool_use") {
            const { id, name } = e.content_block;
            toolBlocks.set(e.index, { id, name, json: "" });
            send(ws, { type: "tool.start", chatId, toolId: id, name, label: toolLabel(name, undefined) });
          } else if (e.type === "content_block_delta") {
            if (e.delta.type === "text_delta") {
              send(ws, { type: "text.delta", chatId, text: e.delta.text });
            } else if (e.delta.type === "thinking_delta") {
              send(ws, { type: "thinking.delta", chatId, text: e.delta.thinking });
            } else if (e.delta.type === "input_json_delta") {
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
              send(ws, { type: "tool.end", chatId, toolId: tb.id, name: tb.name, label: toolLabel(tb.name, input), input });
              toolBlocks.delete(e.index);
            }
          }
          break;
        }
        case "assistant": {
          if (!msg.parent_tool_use_id) {
            send(ws, { type: "message.complete", chatId, content: msg.message.content });
          }
          break;
        }
        case "user": {
          if (msg.parent_tool_use_id) break;
          const content = (msg.message as { content?: unknown })?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block?.type === "tool_result") {
                send(ws, { type: "tool.result", chatId, toolId: block.tool_use_id, isError: block.is_error === true });
              }
            }
          }
          break;
        }
        case "result": {
          send(ws, {
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
    send(ws, { type: "chat.error", chatId: chatId || null, error: String(err instanceof Error ? err.message : err) });
  } finally {
    if (chatId) {
      busyChats.delete(chatId);
      activeRuns.delete(chatId);
    }
  }
}

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    clients.add(ws);
    let newChatPending = false;
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
        if (chatId && busyChats.has(chatId)) {
          send(ws, { type: "chat.error", chatId, error: "A response is already in progress for this chat." });
          return;
        }
        if (!chatId && newChatPending) {
          send(ws, { type: "chat.error", chatId: null, error: "Still starting the previous new chat." });
          return;
        }
        if (!chatId) newChatPending = true;
        // chatId is known once the init frame arrives; permission asks and
        // workspace switches reference it through this box.
        const box = { chatId: chatId ?? "" };
        let run: Run;
        try {
          run = runTurn(text, chatId, {
            workspaceId: workspace,
            voice: !!voice,
            ask: (toolName, label, input) =>
              createAsk(box.chatId, toolName, label, input, (ask) =>
                send(ws, { type: "permission.ask", id: ask.id, chatId: ask.chatId, toolName: ask.toolName, label: ask.label, input: ask.input }),
              ),
            hooks: {
              onSwitchWorkspace: (target, reason) => send(ws, { type: "workspace.switch", chatId: box.chatId, workspace: target, reason }),
            },
          });
        } catch (e) {
          if (!chatId) newChatPending = false;
          send(ws, { type: "chat.error", chatId, error: (e as Error).message });
          return;
        }
        const origSend = send;
        // Capture the session id for the box as soon as it is known.
        const tap = (f: ServerFrame) => {
          if (f.type === "chat.session") box.chatId = f.chatId;
          origSend(ws, f);
        };
        void pumpWith(tap, run, chatId).finally(() => {
          if (!chatId) newChatPending = false;
        });
      } else if (frame.type === "chat.interrupt") {
        const run = activeRuns.get(frame.chatId);
        if (run) run.q.interrupt().catch(() => run.abort.abort());
      } else if (frame.type === "permission.reply") {
        if (resolveAsk(frame.id, !!frame.allow)) broadcast({ type: "permission.resolved", id: frame.id, allow: !!frame.allow });
      }
    });
  });

  return wss;
}

// pump() above sends straight to the socket; this variant routes through a tap
// so callers can observe frames (used to learn the session id).
async function pumpWith(tap: (f: ServerFrame) => void, run: Run, initialChatId: string | null) {
  const fake = {
    readyState: WebSocket.OPEN,
    send: (s: string) => tap(JSON.parse(s) as ServerFrame),
  } as unknown as WebSocket;
  await pump(fake, run, initialChatId);
}
