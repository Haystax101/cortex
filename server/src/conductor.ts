import Anthropic from "@anthropic-ai/sdk";
import { Router } from "express";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bus, type WorkerEvent } from "./bus.js";
import { BRAIN_DIR } from "./config.js";
import { addIdea, linkIdea, listIdeas } from "./ideas.js";
import { resolveAsk } from "./permissions.js";
import { loadSettings } from "./settings.js";
import {
  boardSummary,
  createTask,
  discardTask,
  getTask,
  markTask,
  mergeTask,
  messageTask,
  stopTask,
} from "./tasks.js";
import { sendNtfy } from "./tools.js";
import { createProject, WORKSPACES, workspaceExists } from "./workspaces.js";

// The conductor: the one voice George talks to. A small, fast model on the
// Claude API (Haiku, billed to the monthly API credits) with a short prompt and
// a handful of tools. It never does the heavy lifting itself; it talks,
// brainstorms, and dispatches background workers (Claude Code on the
// subscription, see tasks.ts), then tells George what they came back with.

export const CONDUCTOR_MODEL = process.env.CORTEX_CONDUCTOR_MODEL ?? "claude-haiku-5-5";
// USD per million tokens, for the running monthly estimate shown in the UI.
const PRICE = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 };

const DIR = path.join(os.homedir(), ".cortex");
const KEY_FILE = path.join(DIR, "anthropic-key");
const HISTORY_FILE = path.join(DIR, "conductor.json");
const USAGE_FILE = path.join(DIR, "conductor-usage.json");
const MAX_MESSAGES = 90;
const KEEP_MESSAGES = 50;

// ---------------------------------------------------------------- API key

// Deliberately not ANTHROPIC_API_KEY: that variable would make the Claude Code
// engine bill the API. The key lives in a 600-mode file or CORTEX_ANTHROPIC_KEY.
function apiKey(): string | null {
  if (process.env.CORTEX_ANTHROPIC_KEY) return process.env.CORTEX_ANTHROPIC_KEY.trim();
  try {
    return fs.readFileSync(KEY_FILE, "utf8").trim() || null;
  } catch {
    return null;
  }
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  const key = apiKey();
  if (!key) throw new Error(`No conductor API key. Save it to ${KEY_FILE} (chmod 600) or set CORTEX_ANTHROPIC_KEY.`);
  if (!client || client.apiKey !== key) client = new Anthropic({ apiKey: key, maxRetries: 2 });
  return client;
}

export function conductorConfigured() {
  return !!apiKey();
}

// ---------------------------------------------------------------- state

export type LogEntry = { id: string; role: "george" | "cortex" | "update"; text: string; t: number; tools?: string[] };

type Stored = { messages: Anthropic.MessageParam[]; log: LogEntry[] };

function loadState(): Stored {
  try {
    const s = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) as Stored;
    return { messages: s.messages ?? [], log: s.log ?? [] };
  } catch {
    return { messages: [], log: [] };
  }
}

const state = loadState();

function persist() {
  fs.mkdirSync(DIR, { recursive: true });
  state.log = state.log.slice(-250);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(state));
}

// Keep the conversation bounded. Cut only at a plain-text user message so no
// tool_result is ever orphaned from its tool_use. Cutting in big steps keeps
// the cached prefix stable between trims.
function trim() {
  const m = state.messages;
  if (m.length <= MAX_MESSAGES) return;
  for (let i = m.length - KEEP_MESSAGES; i < m.length; i++) {
    const msg = m[i];
    const plain = msg.role === "user" && (typeof msg.content === "string" || msg.content.every((b) => b.type === "text"));
    if (plain) {
      state.messages = m.slice(i);
      return;
    }
  }
}

type Usage = { month: string; usd: number; turns: number };
function recordUsage(u: Anthropic.Usage) {
  const month = new Date().toISOString().slice(0, 7);
  let cur: Usage = { month, usd: 0, turns: 0 };
  try {
    const s = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) as Usage;
    if (s.month === month) cur = s;
  } catch {
    // new month
  }
  cur.usd +=
    ((u.input_tokens ?? 0) * PRICE.input +
      (u.output_tokens ?? 0) * PRICE.output +
      (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite) /
    1e6;
  cur.turns += 1;
  fs.writeFileSync(USAGE_FILE, JSON.stringify(cur));
}

export function usageThisMonth(): Usage {
  try {
    const s = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) as Usage;
    if (s.month === new Date().toISOString().slice(0, 7)) return s;
  } catch {
    // none yet
  }
  return { month: new Date().toISOString().slice(0, 7), usd: 0, turns: 0 };
}

// ---------------------------------------------------------------- prompt

const SYSTEM = `You are Cortex, George Hastings's always-on assistant and the voice of his whole workflow. George talks to you, mostly out loud, all day. You are the conductor: you keep the conversation fast and sharp, and you hand real work to background workers. Workers are full Claude Code agents running on his machine in his project repos (or in the cloud); they take minutes, you take seconds.

How you talk
- Your replies are spoken aloud. Plain sentences, no markdown, no lists, no code, no URLs. Usually one to three sentences. Longer only when George is brainstorming with you and wants you to think out loud, and even then keep it conversational.
- Be direct and warm, like a sharp chief of staff. No filler, no "great question".
- When you call a tool that takes action, say a few words first ("On it." / "Starting that now.") so George hears something straight away.

What you do yourself
- Brainstorm, challenge ideas, help him decide, plan, prioritise. You can think; you just don't do long research or code.
- Capture ideas with capture_idea whenever George floats something worth keeping, without making a fuss about it.
- Quick lookups in his brain (markdown notes in ~/brain) with search_brain / read_brain.
- Report on workers: the board is in each message's context; use task_status for details.

What you delegate (start_task)
- Anything that edits code, runs builds or tests, researches properly, reads lots of files, or touches the calendar, journal or memory. Calendar, journal, memory and planning tasks go to project "brain" (they run on a faster model and finish quickly).
- Write the brief as a complete, self-contained instruction: the goal, the context George gave you, constraints, and what "done" looks like. The worker can't hear the conversation; the brief is all it gets.
- Default to local. Use where="cloud" only if George asks for the cloud (cloud runs against the pushed GitHub branch, keeps going with the laptop shut).
- Use model "sonnet" for small, mechanical jobs (renames, test fixes, small copy changes); leave it unset for real engineering, which runs on Opus.
- Several workers can run at once. Start them in parallel when George lists several things.
- When a worker has a QUESTION, put it to George plainly and pass his answer back with message_task. You can steer a running worker the same way.

Approvals and risky actions
- Workers ask before pushing, deploying, publishing or anything destructive. Read the command to George in plain words and only answer_approval with allow=true when he clearly says yes to that specific thing.
- Never merge or discard a task's branch, create a project, or use the cloud unless George asked for exactly that.

Updates
- Messages wrapped in <worker_update> are automatic notifications, not George speaking. Tell him in one or two sentences what happened and what, if anything, he needs to decide. If it's not worth interrupting him for, reply with exactly: (silent)`;

function contextBlock(): string {
  const now = new Date();
  const when = now.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const projects = WORKSPACES.filter(workspaceExists).map((w) => w.id).join(", ");
  return `<context>\nNow: ${when}\nProjects: ${projects}\nBoard:\n${boardSummary()}\n</context>`;
}

// ---------------------------------------------------------------- tools

const TOOLS: Anthropic.Tool[] = [
  {
    name: "start_task",
    description: "Start a background worker (a full Claude Code agent) on one of George's projects. Returns the task id. Use for anything beyond a quick answer.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project id from the context's Projects list, e.g. vantaphai, gtod, cortex, brain" },
        title: { type: "string", description: "Short card title, 3-7 words" },
        brief: { type: "string", description: "Complete self-contained instruction for the worker" },
        where: { type: "string", enum: ["local", "cloud"], description: "Default local" },
        model: { type: "string", enum: ["opus", "sonnet"], description: "Omit for real engineering (Opus); sonnet for small mechanical jobs" },
        idea_id: { type: "string", description: "If this task comes from a captured idea, its id" },
      },
      required: ["project", "title", "brief"],
    },
  },
  {
    name: "task_status",
    description: "Detail on one task (its latest activity, summary, question, branch, changes), or the whole board when task_id is omitted.",
    input_schema: { type: "object", properties: { task_id: { type: "string", description: "Task id or its first 6 characters" } } },
  },
  {
    name: "message_task",
    description: "Send George's answer, feedback or new instructions to a task. Resumes it if it had finished.",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "string" }, message: { type: "string" } },
      required: ["task_id", "message"],
    },
  },
  {
    name: "stop_task",
    description: "Stop a running task.",
    input_schema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] },
  },
  {
    name: "answer_approval",
    description: "Approve or deny a worker's pending risky command (push, deploy, delete...). Only allow when George clearly said yes to it.",
    input_schema: {
      type: "object",
      properties: { approval_id: { type: "string" }, allow: { type: "boolean" } },
      required: ["approval_id", "allow"],
    },
  },
  {
    name: "finish_task",
    description: "Wrap up a task's branch: merge it into George's checkout, discard it (delete worktree and branch), or just mark it done. Only when George explicitly asks.",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "string" }, action: { type: "string", enum: ["merge", "discard", "mark_done"] } },
      required: ["task_id", "action"],
    },
  },
  {
    name: "create_project",
    description: "Register a new project (creates ~/workspace/<slug> with git, or uses an existing folder) so tasks can run in it. Only when George asks to start a new project.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        blurb: { type: "string", description: "One line on what it is" },
        path: { type: "string", description: "Existing folder to use, if George named one" },
      },
      required: ["name", "blurb"],
    },
  },
  {
    name: "capture_idea",
    description: "Save an idea George floated to the ideas list on his board.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "The idea in one or two sentences" }, project: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "list_ideas",
    description: "The captured ideas, newest first.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_brain",
    description: "Case-insensitive text search across George's brain notes (~/brain markdown). Returns matching lines with file paths.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "read_brain",
    description: "Read a file from George's brain by path relative to ~/brain, e.g. projects/vantaphai.md or journal/2026-11-04.md.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "notify",
    description: "Push a notification to George's phone. Only for things he asked to be pinged about or that are time-critical.",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, message: { type: "string" } },
      required: ["title", "message"],
    },
  },
];

const TOOL_LABEL: Record<string, string> = {
  start_task: "Starting a worker",
  task_status: "Checking the board",
  message_task: "Messaging a worker",
  stop_task: "Stopping a worker",
  answer_approval: "Answering an approval",
  finish_task: "Wrapping up a task",
  create_project: "Creating a project",
  capture_idea: "Saving the idea",
  list_ideas: "Reading ideas",
  search_brain: "Searching your brain",
  read_brain: "Reading your brain",
  notify: "Sending a notification",
};

function brainPath(rel: string): string {
  const p = path.resolve(BRAIN_DIR, rel.replace(/^~\/brain\/?/, "").replace(/^\/+/, ""));
  if (!p.startsWith(path.resolve(BRAIN_DIR))) throw new Error("path is outside the brain");
  return p;
}

function grepBrain(q: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "grep",
      ["-rniI", "--include=*.md", "-m", "3", "--", q, "."],
      { cwd: BRAIN_DIR, maxBuffer: 2 * 1024 * 1024, timeout: 8000 },
      (_err, stdout) => {
        const lines = stdout.split("\n").filter(Boolean).slice(0, 40);
        resolve(lines.length ? lines.map((l) => l.slice(0, 240)).join("\n") : "No matches.");
      },
    );
  });
}

async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (name) {
    case "start_task": {
      if (!s("project") || !s("brief")) throw new Error("project and brief are required");
      const t = await createTask({
        project: s("project"),
        title: s("title") || s("brief").slice(0, 50),
        brief: s("brief"),
        where: s("where") === "cloud" ? "cloud" : "local",
        model: s("model") === "sonnet" ? "sonnet" : s("model") === "opus" ? "opus" : undefined,
      });
      if (s("idea_id")) linkIdea(s("idea_id"), t.id);
      return `Started task ${t.id.slice(0, 6)} "${t.title}" in ${t.project} (${t.status}, ${t.where}, model ${t.model}).`;
    }
    case "task_status": {
      if (!s("task_id")) return boardSummary(25);
      const t = getTask(s("task_id"));
      if (!t) return "No such task.";
      return JSON.stringify({
        id: t.id.slice(0, 6),
        title: t.title,
        project: t.project,
        status: t.status,
        activity: t.activity,
        recent: t.log.slice(-6).map((l) => l.text),
        summary: t.summary,
        question: t.question,
        branch: t.branch,
        commits: t.commits,
        changes: t.diffStat,
        approvals: t.approvals,
        cloudUrl: t.cloudUrl,
        error: t.error,
        result: t.result?.slice(0, 1500),
      });
    }
    case "message_task": {
      const t = messageTask(s("task_id"), s("message"));
      return `Sent to ${t.title}; it's working again.`;
    }
    case "stop_task":
      return `Stopped ${stopTask(s("task_id")).title}.`;
    case "answer_approval": {
      const ok = resolveAsk(s("approval_id"), input.allow === true);
      if (ok) bus.frame({ type: "permission.resolved", id: s("approval_id"), allow: input.allow === true });
      return ok ? (input.allow === true ? "Approved." : "Denied.") : "That approval is no longer pending.";
    }
    case "finish_task": {
      const a = s("action");
      if (a === "merge") return await mergeTask(s("task_id"));
      if (a === "discard") return await discardTask(s("task_id"));
      return `Marked ${markTask(s("task_id"), "done").title} done.`;
    }
    case "create_project": {
      const { workspace, created } = createProject(s("name"), s("blurb"), s("path") || undefined);
      if (created) await new Promise((r) => execFile("git", ["init", "-q", workspace.cwd], () => r(null)));
      const brainFile = path.join(BRAIN_DIR, "projects", `${workspace.id}.md`);
      if (!fs.existsSync(brainFile)) {
        fs.mkdirSync(path.dirname(brainFile), { recursive: true });
        fs.writeFileSync(brainFile, `# ${workspace.name}\n\n${s("blurb")}\n\nFolder: ${workspace.cwd}\nStarted: ${new Date().toISOString().slice(0, 10)}\n\n## Status\n\n- [ ] \n`);
      }
      bus.frame({ type: "workspaces.changed" });
      return `Project ${workspace.id} ready at ${workspace.cwd}${created ? " (new folder, git initialised)" : ""}.`;
    }
    case "capture_idea": {
      const i = addIdea(s("text"), s("project") || undefined);
      return `Saved idea ${i.id}.`;
    }
    case "list_ideas":
      return (
        listIdeas()
          .slice(0, 30)
          .map((i) => `${i.id}${i.project ? ` [${i.project}]` : ""}${i.taskId ? " (task started)" : ""}: ${i.text}`)
          .join("\n") || "No ideas captured yet."
      );
    case "search_brain":
      return grepBrain(s("query"));
    case "read_brain": {
      const text = fs.readFileSync(brainPath(s("path")), "utf8");
      return text.length > 12000 ? text.slice(0, 12000) + "\n…(truncated)" : text;
    }
    case "notify":
      return (await sendNtfy(s("title"), s("message"))) ? "sent" : "not sent";
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

// ---------------------------------------------------------------- turns

type Source = "george" | "update";
type Current = { id: string; abort: AbortController; done: Promise<void>; source: Source };
let current: Current | null = null;
const pendingUpdates: string[] = [];

function emitLog(e: LogEntry) {
  state.log.push(e);
  bus.frame({ type: "cx.log", entry: e });
}

async function runTurn(id: string, source: Source, userText: string, abort: AbortController) {
  const api = getClient();
  state.messages.push({ role: "user", content: [{ type: "text", text: `${contextBlock()}\n\n${userText}` }] });
  let spoken = "";
  let partial = ""; // text of the step currently streaming, kept if George cuts in
  const tools: string[] = [];
  const stream = source === "george"; // updates are buffered so "(silent)" never reaches the speaker
  bus.frame({ type: "cx.start", turnId: id, source });
  try {
    for (let step = 0; step < 8; step++) {
      const s = api.messages.stream(
        {
          model: CONDUCTOR_MODEL,
          max_tokens: 2048,
          system: [{ type: "text", text: SYSTEM }],
          tools: TOOLS,
          messages: state.messages,
          thinking: { type: "disabled" },
          output_config: { effort: "low" },
          cache_control: { type: "ephemeral" },
        },
        { signal: abort.signal },
      );
      let stepText = "";
      partial = "";
      for await (const ev of s) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          stepText += ev.delta.text;
          partial = stepText;
          if (stream) bus.frame({ type: "cx.delta", turnId: id, text: ev.delta.text });
        }
      }
      const msg = await s.finalMessage();
      partial = "";
      recordUsage(msg.usage);
      spoken += (spoken && stepText ? " " : "") + stepText;
      state.messages.push({ role: "assistant", content: msg.content });
      if (msg.stop_reason === "refusal") {
        const t = " I can't help with that one.";
        spoken += t;
        if (stream) bus.frame({ type: "cx.delta", turnId: id, text: t });
        break;
      }
      if (msg.stop_reason !== "tool_use") break;
      const calls = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (stream && stepText && !/\s$/.test(stepText)) bus.frame({ type: "cx.delta", turnId: id, text: " " });
      const results = await Promise.all(
        calls.map(async (c): Promise<Anthropic.ToolResultBlockParam> => {
          const label = TOOL_LABEL[c.name] ?? c.name;
          tools.push(label);
          bus.frame({ type: "cx.tool", turnId: id, label });
          try {
            const out = await runTool(c.name, (c.input ?? {}) as Record<string, unknown>);
            return { type: "tool_result", tool_use_id: c.id, content: out };
          } catch (e) {
            return { type: "tool_result", tool_use_id: c.id, content: `Error: ${(e as Error).message}`, is_error: true };
          }
        }),
      );
      state.messages.push({ role: "user", content: results });
    }
  } catch (err) {
    if (abort.signal.aborted) {
      // George talked over it. Keep what was said so the conversation stays honest.
      spoken = [spoken, partial].filter((x) => x.trim()).join(" ");
      const last = state.messages[state.messages.length - 1];
      if (last?.role === "user" && spoken.trim()) state.messages.push({ role: "assistant", content: `${partial.trim() || spoken.trim()} [George interrupted]` });
    } else {
      const m = err instanceof Anthropic.APIError ? `${err.status ?? ""} ${err.message}` : String((err as Error).message ?? err);
      bus.frame({ type: "cx.error", turnId: id, error: m });
    }
  } finally {
    const text = spoken.trim();
    const silent = source === "update" && (/^\(silent\)\.?$/i.test(text) || !text);
    if (source === "update" && !silent) bus.frame({ type: "cx.delta", turnId: id, text });
    if (!silent) emitLog({ id, role: source === "update" ? "update" : "cortex", text: text.replace(/\s*\(silent\)\s*$/i, ""), t: Date.now(), tools });
    bus.frame({ type: "cx.done", turnId: id, silent, interrupted: abort.signal.aborted });
    trim();
    persist();
  }
}

function start(source: Source, text: string) {
  const id = crypto.randomUUID();
  const abort = new AbortController();
  const c: Current = { id, abort, source, done: Promise.resolve() };
  c.done = runTurn(id, source, text, abort).finally(() => {
    if (current === c) current = null;
    drainUpdates();
  });
  current = c;
}

// George speaks: cut off whatever the conductor is saying and answer him.
export async function say(text: string, voice: boolean) {
  const clean = text.trim();
  if (!clean) return;
  if (current) {
    current.abort.abort();
    await current.done.catch(() => {});
  }
  emitLog({ id: crypto.randomUUID(), role: "george", text: clean, t: Date.now() });
  start("george", voice ? clean : `[typed] ${clean}`);
}

export function interrupt() {
  current?.abort.abort();
}

function drainUpdates() {
  if (current || !pendingUpdates.length) return;
  const batch = pendingUpdates.splice(0, pendingUpdates.length);
  start("update", `<worker_update>\n${batch.join("\n")}\n</worker_update>`);
}

function describe(e: WorkerEvent): string | null {
  const t = getTask(e.taskId);
  if (!t) return null;
  const head = `Task ${t.id.slice(0, 6)} "${t.title}" (${t.project})`;
  switch (e.kind) {
    case "finished":
      return `${head} finished. ${t.summary ?? ""}${t.branch ? ` Branch ${t.branch}: ${t.commits ?? 0} commits, ${t.diffStat ?? ""}.` : ""}`;
    case "question":
      return `${head} has a question: ${t.question}`;
    case "failed":
      return `${head} failed: ${t.error ?? t.activity}`;
    case "approval": {
      const a = t.approvals.find((x) => x.id === e.approvalId);
      return `${head} wants approval ${e.approvalId} to run: ${a?.command ?? a?.label ?? "a risky command"}`;
    }
  }
}

bus.on("worker", (e: WorkerEvent) => {
  const line = describe(e);
  if (!line) return;
  if (!loadSettings().announceUpdates && e.kind === "finished") return;
  if (!conductorConfigured()) return;
  pendingUpdates.push(line);
  // A short delay batches tasks that finish together into one sentence.
  setTimeout(drainUpdates, 1500);
});

// ---------------------------------------------------------------- REST

export const conductorRouter = Router();

conductorRouter.get("/", (_req, res) => {
  res.json({
    model: CONDUCTOR_MODEL,
    configured: conductorConfigured(),
    busy: !!current,
    log: state.log.slice(-120),
    usage: usageThisMonth(),
    keyFile: KEY_FILE,
  });
});

conductorRouter.post("/reset", (_req, res) => {
  state.messages = [];
  persist();
  res.json({ ok: true });
});
