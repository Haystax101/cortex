import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { runTurn, type Run } from "./agent.js";
import { toolLabel } from "./labels.js";
import type { ClientFrame, ServerFrame } from "./frames.js";

// Chats with a turn in flight — also consulted by the delete endpoint.
export const busyChats = new Set<string>();
const activeRuns = new Map<string, Run>();

function send(ws: WebSocket, frame: ServerFrame) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
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
            send(ws, { type: "chat.session", chatId });
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
              send(ws, {
                type: "tool.end",
                chatId,
                toolId: tb.id,
                name: tb.name,
                label: toolLabel(tb.name, input),
                input,
              });
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
                send(ws, {
                  type: "tool.result",
                  chatId,
                  toolId: block.tool_use_id,
                  isError: block.is_error === true,
                });
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
    let newChatPending = false;

    ws.on("message", (raw) => {
      let frame: ClientFrame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (frame.type === "chat.send") {
        const { chatId, text } = frame;
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
        const run = runTurn(text, chatId);
        void pump(ws, run, chatId).finally(() => {
          if (!chatId) newChatPending = false;
        });
      } else if (frame.type === "chat.interrupt") {
        const run = activeRuns.get(frame.chatId);
        if (run) {
          run.q.interrupt().catch(() => run.abort.abort());
        }
      }
    });
  });

  return wss;
}
