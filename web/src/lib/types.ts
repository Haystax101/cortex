// Mirrors server/src/frames.ts and transcript.ts — keep in sync.

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
  | { type: "briefing.ready"; chatId: string; date: string; text: string }
  | { type: "cx.start"; turnId: string; source: "george" | "update" }
  | { type: "cx.delta"; turnId: string; text: string }
  | { type: "cx.tool"; turnId: string; label: string }
  | { type: "cx.done"; turnId: string; silent: boolean; interrupted: boolean }
  | { type: "cx.error"; turnId: string; error: string }
  | { type: "cx.log"; entry: LogEntry }
  | { type: "task.update"; task: Task }
  | { type: "task.removed"; taskId: string }
  | { type: "ideas.update"; ideas: Idea[] }
  | { type: "workspaces.changed" };

export type ClientFrame =
  | { type: "chat.send"; chatId: string | null; text: string; workspace?: string; voice?: boolean }
  | { type: "chat.interrupt"; chatId: string }
  | { type: "permission.reply"; id: string; allow: boolean }
  | { type: "cx.say"; text: string; voice?: boolean }
  | { type: "cx.interrupt" };

// Conductor + board (mirrors server/src/conductor.ts, tasks.ts, ideas.ts)
export type LogEntry = { id: string; role: "george" | "cortex" | "update"; text: string; t: number; tools?: string[] };

export type TaskStatus = "queued" | "running" | "waiting" | "done" | "failed" | "stopped";

export type Task = {
  id: string;
  title: string;
  project: string;
  brief: string;
  where: "local" | "cloud";
  model: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  chatId?: string;
  cwd: string;
  baseCwd: string;
  branch?: string;
  baseRef?: string;
  activity: string;
  log: { t: number; text: string }[];
  result?: string;
  summary?: string;
  question?: string;
  commits?: number;
  diffStat?: string;
  costUsd: number;
  turns: number;
  cloudUrl?: string;
  error?: string;
  approvals: { id: string; label: string; command?: string }[];
};

export type Idea = { id: string; text: string; project?: string; createdAt: number; taskId?: string };

export type ConductorInfo = {
  model: string;
  configured: boolean;
  busy: boolean;
  log: LogEntry[];
  usage: { month: string; usd: number; turns: number };
  keyFile: string;
};

export type ChatMeta = {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  workspace: string;
};

export type Workspace = {
  id: string;
  name: string;
  color: string;
  blurb: string;
  mode: "bypass" | "guarded";
  cwd: string;
  available: boolean;
};

export type PermissionAsk = { id: string; chatId: string; toolName: string; label: string; input: unknown };

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

export type Settings = {
  ntfyTopic: string;
  voice: string;
  speakReplies: boolean;
  briefingHour: number;
  lastBriefingDate?: string;
  lastBriefingChatId?: string;
  maxParallel: number;
  cloudEnabled: boolean;
  announceUpdates: boolean;
};
