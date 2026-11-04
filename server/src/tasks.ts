import { query, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOptions } from "./agent.js";
import { bus } from "./bus.js";
import { DEFAULT_MODEL, FAST_MODEL } from "./config.js";
import { toolLabel } from "./labels.js";
import { createAsk } from "./permissions.js";
import { loadSettings } from "./settings.js";
import { sendNtfy } from "./tools.js";
import { getWorkspace, slugify, type Workspace } from "./workspaces.js";
import { startCloudTask } from "./cloud.js";

// Background workers. Each task is one Claude Code engine session (the
// subscription, never the API key) running a brief George gave the conductor.
// Code tasks run in their own git worktree on a cortex/* branch so several can
// work on one repo at once without touching George's checkout.

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
  result?: string; // last assistant text
  summary?: string; // SUMMARY: line, short enough to speak
  question?: string; // QUESTION: line when waiting on George
  commits?: number;
  diffStat?: string;
  costUsd: number;
  turns: number;
  cloudUrl?: string;
  error?: string;
  approvals: { id: string; label: string; command?: string }[];
  /** false = run in George's checkout instead of a worktree */
  isolate?: boolean;
};

const DIR = path.join(os.homedir(), ".cortex");
const FILE = path.join(DIR, "tasks.json");
export const WORKTREES_DIR = path.join(DIR, "worktrees");
const MAX_LOG = 40;
const KEEP_TASKS = 200;

const tasks = new Map<string, Task>();
const workers = new Map<string, Worker>();

// ---------------------------------------------------------------- persistence

function load() {
  try {
    const list = JSON.parse(fs.readFileSync(FILE, "utf8")) as Task[];
    for (const t of list) {
      // A restart kills the engine processes; anything mid-flight can be resumed with a message.
      if (t.status === "running" && t.where === "local") {
        t.status = "stopped";
        t.activity = "Interrupted by a Cortex restart. Send it a message to carry on.";
      }
      if (t.status === "queued") t.status = "stopped";
      t.approvals = [];
      tasks.set(t.id, t);
    }
  } catch {
    // first run
  }
}

let saveTimer: NodeJS.Timeout | null = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const list = [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, KEEP_TASKS);
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
  }, 300);
}

function touch(t: Task, patch: Partial<Task> = {}) {
  Object.assign(t, patch, { updatedAt: Date.now() });
  save();
  bus.frame({ type: "task.update", task: publicTask(t) });
}

function logLine(t: Task, text: string) {
  t.log.push({ t: Date.now(), text });
  if (t.log.length > MAX_LOG) t.log.splice(0, t.log.length - MAX_LOG);
  touch(t, { activity: text });
}

export function publicTask(t: Task): Task {
  return { ...t, log: t.log.slice(-12) };
}

// ---------------------------------------------------------------- git helpers

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function isGitRepo(cwd: string) {
  try {
    return (await git(cwd, ["rev-parse", "--is-inside-work-tree"])) === "true";
  } catch {
    return false;
  }
}

async function prepareWorktree(t: Task, ws: Workspace) {
  if (ws.mode !== "guarded" || !(await isGitRepo(ws.cwd))) return;
  const short = t.id.slice(0, 6);
  const branch = `cortex/${slugify(t.title).slice(0, 30)}-${short}`;
  const dir = path.join(WORKTREES_DIR, `${ws.id}-${short}`);
  fs.mkdirSync(WORKTREES_DIR, { recursive: true });
  const baseRef = await git(ws.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD");
  await git(ws.cwd, ["worktree", "add", "-b", branch, dir, "HEAD"]);
  Object.assign(t, { cwd: dir, branch, baseRef });
}

async function refreshGitStats(t: Task) {
  if (!t.branch) return;
  try {
    const base = await git(t.cwd, ["merge-base", "HEAD", t.baseRef ?? "HEAD"]);
    const commits = Number(await git(t.cwd, ["rev-list", "--count", `${base}..HEAD`]));
    const stat = await git(t.cwd, ["diff", "--shortstat", base]);
    t.commits = commits;
    t.diffStat = stat || "no changes";
  } catch {
    // stats are cosmetic
  }
}

// ---------------------------------------------------------------- worker

function workerSystem(t: Task): string {
  const where = t.branch
    ? `You are in a dedicated git worktree at ${t.cwd} on branch ${t.branch} (branched from ${t.baseRef}). George's own checkout at ${t.baseCwd} is untouched. Dependencies may not be installed in this worktree yet: install them if a build or test needs them. Commit your work on this branch with clear messages. Never push, merge, or switch branches.`
    : `You are working in ${t.cwd}.`;
  return [
    `You are a Cortex background worker. George gave this task to the Cortex conductor by voice; nobody is watching this session live, so work autonomously and do the whole job (investigate, change, test, verify) without asking for confirmation of routine steps.`,
    where,
    `If you reach a decision only George can make (product choice, credentials, something destructive or outward-facing), stop and end your reply with one line: "QUESTION: <the single question>". He answers later and you continue from there.`,
    `End every reply with one line: "SUMMARY: <two or three plain spoken sentences: what you did, the result, anything he should check>". The conductor reads it aloud.`,
  ].join("\n\n");
}

function makeInput() {
  const queue: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const it = (async function* () {
    while (!closed) {
      if (queue.length) yield queue.shift()!;
      else await new Promise<void>((r) => (wake = r));
    }
  })();
  return {
    it,
    push(text: string) {
      queue.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
      wake?.();
      wake = null;
    },
    close() {
      closed = true;
      wake?.();
      wake = null;
    },
  };
}

const IDLE_MS = 20 * 60_000;

class Worker {
  readonly q: Query;
  private input = makeInput();
  private idle: NodeJS.Timeout | null = null;
  readonly abort = new AbortController();
  closed = false;

  constructor(readonly task: Task) {
    const base = getWorkspace(task.project);
    const ws: Workspace = { ...base, cwd: task.cwd };
    const options = buildOptions(ws, task.chatId ?? null, {
      model: task.model,
      extraSystem: workerSystem(task),
      abort: this.abort,
      ask: (toolName, label, input) => this.ask(toolName, label, input),
      hooks: {},
    });
    this.q = query({ prompt: this.input.it, options });
    void this.pump();
  }

  send(text: string) {
    if (this.idle) clearTimeout(this.idle);
    this.input.push(text);
  }

  private async ask(toolName: string, label: string, input: unknown): Promise<boolean> {
    const t = this.task;
    const command = typeof (input as { command?: unknown })?.command === "string" ? String((input as { command: string }).command) : undefined;
    let askId = "";
    return createAsk(t.id, toolName, label, input, (ask) => {
      askId = ask.id;
      t.approvals.push({ id: ask.id, label, command });
      logLine(t, `Waiting for approval: ${label}`);
      bus.frame({ type: "permission.ask", id: ask.id, chatId: t.id, toolName, label, input });
      bus.worker({ kind: "approval", taskId: t.id, approvalId: ask.id });
      void sendNtfy(`${t.title}: approval needed`, command ?? label);
    }).finally(() => {
      // resolved either way; drop it from the card
      const i = t.approvals.findIndex((a) => a.id === askId);
      if (i >= 0) t.approvals.splice(i, 1);
      touch(t);
    });
  }

  private async pump() {
    const t = this.task;
    let text = "";
    try {
      for await (const msg of this.q) {
        switch (msg.type) {
          case "system":
            if (msg.subtype === "init" && !t.chatId) touch(t, { chatId: msg.session_id });
            break;
          case "assistant": {
            if (msg.parent_tool_use_id) break;
            for (const b of msg.message.content as Array<{ type: string; text?: string; name?: string; input?: unknown }>) {
              if (b.type === "text" && b.text) text += (text ? "\n" : "") + b.text;
              if (b.type === "tool_use" && b.name) logLine(t, toolLabel(b.name, b.input));
            }
            break;
          }
          case "result": {
            await this.finishTurn(text, msg.subtype, msg.total_cost_usd ?? 0, msg.num_turns ?? 0);
            text = "";
            break;
          }
        }
      }
    } catch (err) {
      if (!this.abort.signal.aborted) {
        touch(t, { status: "failed", error: String(err instanceof Error ? err.message : err), finishedAt: Date.now() });
        bus.worker({ kind: "failed", taskId: t.id });
      }
    } finally {
      this.closed = true;
      if (this.idle) clearTimeout(this.idle);
      workers.delete(t.id);
      schedule();
    }
  }

  private async finishTurn(text: string, subtype: string, cost: number, turns: number) {
    const t = this.task;
    const summary = /^SUMMARY:\s*(.+)$/im.exec(text)?.[1]?.trim();
    const question = /^QUESTION:\s*(.+)$/im.exec(text)?.[1]?.trim();
    await refreshGitStats(t);
    const failed = subtype !== "success";
    touch(t, {
      result: text.replace(/^(SUMMARY|QUESTION):.*$/gim, "").trim() || text,
      summary: summary ?? (text.length > 300 ? text.slice(-300) : text),
      question: question ?? undefined,
      costUsd: t.costUsd + cost,
      turns: t.turns + turns,
      status: failed ? "failed" : question ? "waiting" : "done",
      error: failed ? `Engine stopped: ${subtype}` : undefined,
      finishedAt: Date.now(),
      activity: failed ? `Stopped (${subtype})` : question ? "Has a question for you" : "Finished",
    });
    bus.worker({ kind: failed ? "failed" : question ? "question" : "finished", taskId: t.id });
    // Keep the engine warm for a follow-up for a while, then free the slot.
    this.idle = setTimeout(() => this.close(), IDLE_MS);
    schedule();
  }

  close() {
    if (this.closed) return;
    this.input.close();
  }

  stop() {
    this.q.interrupt().catch(() => this.abort.abort());
    this.close();
  }
}

// ---------------------------------------------------------------- scheduling

function runningCount() {
  let n = 0;
  for (const w of workers.values()) if (w.task.status === "running") n++;
  return n;
}

function schedule() {
  const max = Math.max(1, loadSettings().maxParallel || 3);
  const queued = [...tasks.values()].filter((t) => t.status === "queued").sort((a, b) => a.createdAt - b.createdAt);
  for (const t of queued) {
    if (runningCount() >= max) break;
    void begin(t);
  }
}

function firstPrompt(t: Task): string {
  return `[Task from George, via the Cortex conductor]\nTitle: ${t.title}\n\n${t.brief}`;
}

async function begin(t: Task) {
  touch(t, { status: "running", startedAt: t.startedAt ?? Date.now(), activity: "Starting" });
  try {
    if (t.isolate !== false && !t.chatId && !t.branch) await prepareWorktree(t, getWorkspace(t.project));
    const w = new Worker(t);
    workers.set(t.id, w);
    w.send(firstPrompt(t));
    logLine(t, t.branch ? `Working on branch ${t.branch}` : "Working");
  } catch (e) {
    touch(t, { status: "failed", error: (e as Error).message, activity: "Could not start" });
    bus.worker({ kind: "failed", taskId: t.id });
  }
}

// ---------------------------------------------------------------- public API

export type NewTask = {
  project: string;
  title: string;
  brief: string;
  where?: "local" | "cloud";
  model?: "opus" | "sonnet";
  isolate?: boolean;
};

export async function createTask(input: NewTask): Promise<Task> {
  const ws = getWorkspace(input.project);
  if (!fs.existsSync(ws.cwd)) throw new Error(`${ws.name}'s folder does not exist: ${ws.cwd}`);
  const where = input.where ?? "local";
  const model = input.model === "sonnet" || (input.model === undefined && ws.id === "brain") ? FAST_MODEL : (ws.model ?? DEFAULT_MODEL);
  const now = Date.now();
  const t: Task = {
    id: crypto.randomUUID(),
    title: input.title.trim().slice(0, 80) || "Task",
    project: ws.id,
    brief: input.brief.trim(),
    where,
    model,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    cwd: ws.cwd,
    baseCwd: ws.cwd,
    activity: "Queued",
    log: [],
    costUsd: 0,
    turns: 0,
    approvals: [],
    isolate: input.isolate !== false,
  };
  tasks.set(t.id, t);
  if (where === "cloud") {
    if (!loadSettings().cloudEnabled) {
      tasks.delete(t.id);
      throw new Error("Cloud dispatch is switched off. George has to enable it in settings (cloudEnabled) first.");
    }
    touch(t, { status: "running", startedAt: now, activity: "Starting a cloud session" });
    void startCloudTask(t, firstPrompt(t) + "\n\n" + workerSystem({ ...t, branch: undefined }))
      .then((url) => touch(t, { cloudUrl: url, activity: url ? "Running in the cloud" : "Cloud session started (no link returned)" }))
      .catch((e) => {
        touch(t, { status: "failed", error: (e as Error).message, activity: "Cloud start failed" });
        bus.worker({ kind: "failed", taskId: t.id });
      });
    return t;
  }
  touch(t);
  schedule();
  return t;
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id) ?? [...tasks.values()].find((t) => t.id.startsWith(id));
}

export function listTasks(): Task[] {
  return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt).map(publicTask);
}

// Follow-up, answer to a QUESTION:, or "carry on" after a restart.
export function messageTask(id: string, text: string): Task {
  const t = getTask(id);
  if (!t) throw new Error(`no task ${id}`);
  if (t.where === "cloud") throw new Error("Cloud tasks are steered from the cloud session itself (open its link).");
  let w = workers.get(t.id);
  touch(t, { status: "running", question: undefined, activity: "Picking up your message", finishedAt: undefined });
  if (!w || w.closed) {
    w = new Worker(t); // resumes the engine session by chatId
    workers.set(t.id, w);
  }
  w.send(`[George, via the conductor]: ${text}`);
  return t;
}

export function stopTask(id: string): Task {
  const t = getTask(id);
  if (!t) throw new Error(`no task ${id}`);
  workers.get(t.id)?.stop();
  touch(t, { status: "stopped", activity: "Stopped by George", finishedAt: Date.now() });
  schedule();
  return t;
}

// Merge a finished task's branch into George's checkout (only when he says so).
export async function mergeTask(id: string): Promise<string> {
  const t = getTask(id);
  if (!t?.branch) throw new Error("That task has no branch to merge.");
  const dirty = await git(t.baseCwd, ["status", "--porcelain"]);
  if (dirty) throw new Error("Your main checkout has uncommitted changes, so I didn't merge. Commit or stash them first.");
  const current = await git(t.baseCwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const out = await git(t.baseCwd, ["merge", "--no-ff", "-m", `Merge ${t.branch}: ${t.title}`, t.branch]);
  logLine(t, `Merged into ${current}`);
  return `Merged ${t.branch} into ${current}. ${out.split("\n").slice(-1)[0] ?? ""}`.trim();
}

// Remove a task's worktree and branch (only when George says so).
export async function discardTask(id: string): Promise<string> {
  const t = getTask(id);
  if (!t) throw new Error(`no task ${id}`);
  workers.get(t.id)?.stop();
  if (t.branch) {
    await git(t.baseCwd, ["worktree", "remove", "--force", t.cwd]).catch(() => {});
    await git(t.baseCwd, ["branch", "-D", t.branch]).catch(() => {});
  }
  tasks.delete(t.id);
  save();
  bus.frame({ type: "task.removed", taskId: t.id });
  return `Discarded ${t.title}.`;
}

export function markTask(id: string, status: "done" | "stopped"): Task {
  const t = getTask(id);
  if (!t) throw new Error(`no task ${id}`);
  touch(t, { status, finishedAt: Date.now(), activity: status === "done" ? "Marked done" : "Stopped" });
  return t;
}

// One line per task, for the conductor's context and spoken status reports.
export function boardSummary(limit = 12): string {
  const list = [...tasks.values()]
    .filter((t) => t.status !== "stopped" || Date.now() - t.updatedAt < 6 * 3600_000)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
  if (!list.length) return "No tasks yet.";
  return list
    .map((t) => {
      const age = Math.round((Date.now() - (t.startedAt ?? t.createdAt)) / 60_000);
      const extra = t.status === "waiting" ? ` QUESTION: ${t.question}` : t.approvals.length ? ` NEEDS APPROVAL: ${t.approvals.map((a) => `${a.id} ${a.command ?? a.label}`).join("; ")}` : ` (${t.activity})`;
      return `- [${t.id.slice(0, 6)}] ${t.project} · "${t.title}" · ${t.status}${t.where === "cloud" ? " · cloud" : ""} · ${age}m${extra}`;
    })
    .join("\n");
}

load();
