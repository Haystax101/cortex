import {
  query,
  type Query,
  type Options,
  type PermissionResult,
  type PreToolUseHookInput,
  type HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { BRAIN_DIR, FAST_MODEL } from "./config.js";
import { getWorkspace, type Workspace } from "./workspaces.js";
import { AUTO_ALLOWED, isRiskyCommand } from "./permissions.js";
import { makeCortexTools, CORTEX_TOOL_NAMES, type ToolHooks } from "./tools.js";
import { toolLabel } from "./labels.js";

export type Run = { q: Query; abort: AbortController; workspace: Workspace };

export type TurnOptions = {
  workspaceId?: string | null;
  /** Spoken conversation: keep replies short and skip heavy markdown. */
  voice?: boolean;
  model?: string;
  /** Guarded workspaces call this for risky commands; resolve true to allow. */
  ask?: (toolName: string, label: string, input: unknown) => Promise<boolean>;
  hooks?: ToolHooks;
  abort?: AbortController;
};

const BASE_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "Bash",
  "TodoWrite",
  "Task",
  "Skill",
  ...CORTEX_TOOL_NAMES,
];

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function systemAppend(ws: Workspace): string {
  const now = new Date();
  const when = `${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  const parts: string[] = [];
  parts.push(
    `You are Cortex, George's personal AI brain. This session started ${when} (local time); the conversation may continue for hours, so check the clock with Bash if timing matters. Today's journal is ${BRAIN_DIR}/journal/${today()}.md.`,
  );
  if (ws.id === "brain") {
    parts.push("You are in the brain workspace: follow CLAUDE.md in this folder for the journal, memory, calendar, briefing and GTOD protocols.");
  } else {
    parts.push(
      `You are working inside George's ${ws.name} repo at ${ws.cwd}. Follow that repo's CLAUDE.md and conventions. ` +
        `George's brain at ${BRAIN_DIR} is attached: read ${BRAIN_DIR}/projects/ for the project file that matches this workspace before starting, ` +
        `and when something meaningful is finished append a one-line entry to today's journal and tick it in the project file. ` +
        `Edit code freely, run tests and builds, but never push, deploy, publish, or run anything destructive unless George says so in this conversation (a prompt will appear for those).`,
    );
  }
  parts.push(
    "Messages that arrive by voice are marked [Spoken message]: answer those in plain spoken sentences, briefly, with no markdown. Typed messages are shown in a chat UI: conversational and readable, not a terminal dump.",
  );
  return parts.join("\n\n");
}

// Builds the SDK options for a workspace. Shared by single-shot runs and live sessions.
export function buildOptions(ws: Workspace, chatId: string | null, opts: TurnOptions): Options {
  const guarded = ws.mode === "guarded";
  const cortexTools = makeCortexTools(opts.hooks ?? {});
  const abort = opts.abort ?? new AbortController();

  const canUseTool = async (toolName: string, input: Record<string, unknown>): Promise<PermissionResult> => {
    if (AUTO_ALLOWED.has(toolName) || toolName.startsWith("mcp__")) return { behavior: "allow", updatedInput: input };
    if (toolName === "Bash") {
      const cmd = String(input.command ?? "");
      if (!isRiskyCommand(cmd)) return { behavior: "allow", updatedInput: input };
      if (!opts.ask) return { behavior: "deny", message: "Risky command blocked: no one is available to approve it." };
      const ok = await opts.ask(toolName, toolLabel(toolName, input), input);
      return ok
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: "George declined this command. Do not retry it; explain what you would have done and continue otherwise." };
    }
    return { behavior: "allow", updatedInput: input };
  };

  // Allowlisted tools skip canUseTool, but PreToolUse hooks always fire, so
  // risky Bash in a guarded workspace is gated here.
  const guardHook = async (input: unknown): Promise<HookJSONOutput> => {
    const hi = input as PreToolUseHookInput;
    if (hi.tool_name !== "Bash") return {};
    const ti = (hi.tool_input ?? {}) as Record<string, unknown>;
    const cmd = String(ti.command ?? "");
    if (!isRiskyCommand(cmd)) return {};
    const deny = (why: string): HookJSONOutput => ({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why },
    });
    if (!opts.ask) return deny("Risky command blocked: nobody is available to approve it. Explain what you would have run and continue without it.");
    const ok = await opts.ask("Bash", toolLabel("Bash", ti), ti);
    if (ok) return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "George approved it." } };
    return deny("George declined this command. Do not retry it; say what you would have done and continue otherwise.");
  };

  return {
    cwd: ws.cwd,
    ...(chatId ? { resume: chatId } : {}),
    model: opts.model ?? (opts.voice && ws.id === "brain" ? FAST_MODEL : ws.model),
    ...(opts.voice ? { effort: "low" as const } : {}),
    systemPrompt: { type: "preset", preset: "claude_code", append: systemAppend(ws) },
    settingSources: ["project"],
    skills: "all",
    allowedTools: BASE_TOOLS,
    mcpServers: { cortex: cortexTools },
    ...(ws.id === "brain" ? {} : { additionalDirectories: [BRAIN_DIR] }),
    ...(guarded
      ? {
          permissionMode: "acceptEdits" as const,
          canUseTool,
          hooks: { PreToolUse: [{ matcher: "Bash", hooks: [guardHook], timeout: 660 }] },
        }
      : { permissionMode: "bypassPermissions" as const, allowDangerouslySkipPermissions: true }),
    includePartialMessages: true,
    abortController: abort,
    stderr: (data: string) => {
      if (process.env.CORTEX_DEBUG) console.error("[claude]", data);
    },
  };
}

// Single-shot turn (used by headless jobs such as the briefing).
export function runTurn(text: string, chatId: string | null, opts: TurnOptions = {}): Run {
  const ws = getWorkspace(opts.workspaceId);
  const abort = opts.abort ?? new AbortController();
  const hint = opts.voice ? "[Spoken message. Reply will be read aloud: plain sentences, no markdown or lists.]\n\n" : "";
  const q = query({ prompt: hint + text, options: buildOptions(ws, chatId, { ...opts, abort }) });
  return { q, abort, workspace: ws };
}

// Runs a turn to completion with no client attached (briefing, scheduled jobs).
export async function runHeadless(
  text: string,
  opts: TurnOptions & { chatId?: string | null } = {},
): Promise<{ chatId: string; text: string; costUsd?: number }> {
  const run = runTurn(text, opts.chatId ?? null, opts);
  let chatId = opts.chatId ?? "";
  let out = "";
  let costUsd: number | undefined;
  for await (const msg of run.q) {
    if (msg.type === "system" && msg.subtype === "init") chatId = msg.session_id;
    else if (msg.type === "assistant" && !msg.parent_tool_use_id) {
      const content = msg.message.content as Array<{ type: string; text?: string }>;
      for (const b of content) if (b.type === "text" && b.text) out += (out ? "\n" : "") + b.text;
    } else if (msg.type === "result") {
      costUsd = msg.total_cost_usd || undefined;
    }
  }
  return { chatId, text: out.trim(), costUsd };
}
