import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BRAIN_DIR, DEFAULT_MODEL, FAST_MODEL } from "./config.js";

// A workspace is where a conversation runs: the brain itself, or one of
// George's project repos with the brain attached as an extra directory.
export type Workspace = {
  id: string;
  name: string;
  cwd: string;
  color: string; // tailwind-ish hex for the UI chip
  /** bypass = brain (markdown only); guarded = real code, prompts on risky commands */
  mode: "bypass" | "guarded";
  model: string;
  blurb: string;
};

const home = os.homedir();

export const WORKSPACES: Workspace[] = [
  {
    id: "brain",
    name: "Brain",
    cwd: BRAIN_DIR,
    color: "#8b5cf6",
    mode: "bypass",
    model: DEFAULT_MODEL,
    blurb: "Memory, journal, calendar, planning",
  },
  {
    id: "vantaphai",
    name: "Vantaphai",
    cwd: path.join(home, "vantaphai_platform"),
    color: "#f59e0b",
    mode: "guarded",
    model: DEFAULT_MODEL,
    blurb: "Regulatory intelligence platform",
  },
  {
    id: "supercharged",
    name: "Supercharged",
    cwd: path.join(home, "supercharged-app"),
    color: "#22d3ee",
    mode: "guarded",
    model: DEFAULT_MODEL,
    blurb: "Agentic people-search app",
  },
  {
    id: "gtod",
    name: "Get There One Day",
    cwd: path.join(home, "workspace", "gtod-site"),
    color: "#f43f5e",
    mode: "guarded",
    model: DEFAULT_MODEL,
    blurb: "Site, Charge assistant, content",
  },
];

export const BRIEFING_MODEL = FAST_MODEL;

export function getWorkspace(id: string | undefined | null): Workspace {
  const ws = WORKSPACES.find((w) => w.id === (id ?? "brain"));
  if (!ws) throw new Error(`unknown workspace: ${id}`);
  return ws;
}

export function workspaceExists(ws: Workspace): boolean {
  return fs.existsSync(ws.cwd);
}

// The Agent SDK stores each cwd's sessions under ~/.claude/projects/<mangled cwd>/.
export function sessionsDirFor(ws: Workspace): string {
  return path.join(home, ".claude", "projects", ws.cwd.replace(/[^a-zA-Z0-9]/g, "-"));
}

// Best-effort: pick a workspace from free text like "let's work on vantaphai".
export function matchWorkspace(text: string): Workspace | null {
  const t = text.toLowerCase();
  if (/\bvanta/.test(t)) return getWorkspace("vantaphai");
  if (/\bsupercharged|\bspc\b/.test(t)) return getWorkspace("supercharged");
  if (/get there one day|\bgtod\b|\bpodcast\b/.test(t)) return getWorkspace("gtod");
  if (/\bbrain\b|\bjournal\b|\bcalendar\b/.test(t)) return getWorkspace("brain");
  return null;
}
