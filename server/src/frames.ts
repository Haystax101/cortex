// WebSocket frame types shared conceptually with web/src/lib/types.ts — keep in sync.

export type ClientFrame =
  | { type: "chat.send"; chatId: string | null; text: string }
  | { type: "chat.interrupt"; chatId: string };

export type ServerFrame =
  | { type: "chat.session"; chatId: string }
  | { type: "text.delta"; chatId: string; text: string }
  | { type: "thinking.delta"; chatId: string; text: string }
  | { type: "tool.start"; chatId: string; toolId: string; name: string; label: string }
  | { type: "tool.end"; chatId: string; toolId: string; name: string; label: string; input?: unknown }
  | { type: "tool.result"; chatId: string; toolId: string; isError: boolean }
  | { type: "message.complete"; chatId: string; content: unknown }
  | { type: "turn.done"; chatId: string; subtype: string; numTurns: number; costUsd?: number; durationMs: number }
  | { type: "chat.error"; chatId: string | null; error: string };
