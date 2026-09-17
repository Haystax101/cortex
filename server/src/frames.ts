// WebSocket frame types — mirrored in web/src/lib/types.ts, keep in sync.

export type ClientFrame =
  | { type: "chat.send"; chatId: string | null; text: string; workspace?: string; voice?: boolean }
  | { type: "chat.interrupt"; chatId: string }
  | { type: "permission.reply"; id: string; allow: boolean };

export type ServerFrame =
  | { type: "chat.session"; chatId: string; workspace: string }
  | { type: "text.delta"; chatId: string; text: string }
  | { type: "thinking.delta"; chatId: string; text: string }
  | { type: "tool.start"; chatId: string; toolId: string; name: string; label: string }
  | { type: "tool.end"; chatId: string; toolId: string; name: string; label: string; input?: unknown }
  | { type: "tool.result"; chatId: string; toolId: string; isError: boolean }
  | { type: "message.complete"; chatId: string; content: unknown }
  | { type: "turn.done"; chatId: string; subtype: string; numTurns: number; costUsd?: number; durationMs: number }
  | { type: "chat.error"; chatId: string | null; error: string }
  | { type: "permission.ask"; id: string; chatId: string; toolName: string; label: string; input: unknown }
  | { type: "permission.resolved"; id: string; allow: boolean }
  | { type: "workspace.switch"; chatId: string; workspace: string; reason: string }
  | { type: "briefing.status"; running: boolean; date: string }
  | { type: "briefing.ready"; chatId: string; date: string; text: string };
