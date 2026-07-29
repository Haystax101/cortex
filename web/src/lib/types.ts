// Mirrors server/src/frames.ts and transcript.ts — keep in sync.

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

export type ChatMeta = {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
};

export type UIBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; toolId: string; name: string; label: string; isError?: boolean; running?: boolean };

export type UIMessage = {
  id: string;
  role: "user" | "assistant";
  blocks: UIBlock[];
};

export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  children?: TreeNode[];
};
