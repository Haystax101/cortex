import crypto from "node:crypto";

// Interactive permission prompts for guarded workspaces. The SDK's canUseTool
// callback parks here until the UI (or desk voice client) answers.

export type PermissionAsk = {
  id: string;
  chatId: string;
  toolName: string;
  label: string;
  input: unknown;
};

type Pending = {
  ask: PermissionAsk;
  resolve: (allow: boolean) => void;
  timer: NodeJS.Timeout;
};

const pending = new Map<string, Pending>();
const TIMEOUT_MS = 10 * 60 * 1000;

export function createAsk(
  chatId: string,
  toolName: string,
  label: string,
  input: unknown,
  notify: (ask: PermissionAsk) => void,
): Promise<boolean> {
  const id = crypto.randomUUID();
  const ask: PermissionAsk = { id, chatId, toolName, label, input };
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(false);
    }, TIMEOUT_MS);
    pending.set(id, { ask, resolve, timer });
    notify(ask);
  });
}

export function resolveAsk(id: string, allow: boolean): boolean {
  const p = pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(allow);
  return true;
}

export function pendingFor(chatId: string): PermissionAsk[] {
  return [...pending.values()].filter((p) => p.ask.chatId === chatId).map((p) => p.ask);
}

// Commands that change the world outside the working tree. Anything else in a
// guarded workspace runs without asking.
const RISKY = [
  /\bgit\s+push\b/,
  /\bgit\s+(reset|checkout)\s+.*--hard\b/,
  /\bgit\s+push\b.*--force\b|\bgit\s+push\s+-f\b/,
  /\bgit\s+(branch|tag)\s+-[dD]\b/,
  /\bgit\s+clean\s+-[a-zA-Z]*f/,
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r/,
  /\bnpm\s+publish\b/,
  /\bvercel\b/,
  /\bconvex\s+(deploy|env)\b/,
  /\beas\s+(submit|build|update)\b/,
  /\bgh\s+(repo\s+(create|delete|edit|archive)|pr\s+merge|release\s+create|secret\s+set)\b/,
  /\bdocker\s+push\b/,
  /\bkubectl\s+(apply|delete)\b/,
  /\bterraform\s+(apply|destroy)\b/,
  /\bstripe\b/,
  /\bsudo\b/,
  /\blaunchctl\b/,
  /\bkillall\b|\bpkill\b/,
  /\bcurl\b[^|]*-X\s*(POST|PUT|DELETE|PATCH)\b/i,
  /\bDROP\s+TABLE\b|\bTRUNCATE\b/i,
];

export function isRiskyCommand(cmd: string): boolean {
  return RISKY.some((re) => re.test(cmd));
}

// Tools that never need a prompt in guarded mode (reads, edits inside the tree, planning).
export const AUTO_ALLOWED = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "TodoWrite",
  "Task",
  "Skill",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);
