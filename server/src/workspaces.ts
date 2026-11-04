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

export const CORTEX_APP_DIR = path.join(home, "workspace", "agent-sandbox", "cortex");

WORKSPACES.push({
  id: "cortex",
  name: "Cortex",
  cwd: CORTEX_APP_DIR,
  color: "#a78bfa",
  mode: "guarded",
  model: DEFAULT_MODEL,
  blurb: "Cortex's own code: add abilities, change permissions",
});

export const BRIEFING_MODEL = FAST_MODEL;

// Projects started from Cortex (by voice or the board) live in ~/.cortex/projects.json
// and become workspaces like the built-in ones.
const PROJECTS_FILE = path.join(home, ".cortex", "projects.json");
const PALETTE = ["#34d399", "#60a5fa", "#f472b6", "#facc15", "#fb923c", "#c084fc", "#2dd4bf"];

type StoredProject = { id: string; name: string; cwd: string; blurb: string; color: string };

function loadStoredProjects(): StoredProject[] {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf8")) as StoredProject[];
  } catch {
    return [];
  }
}

for (const p of loadStoredProjects()) {
  if (!WORKSPACES.some((w) => w.id === p.id)) WORKSPACES.push({ ...p, mode: "guarded", model: DEFAULT_MODEL });
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
}

// Registers a project as a workspace. Creates the folder (and a git repo) when
// it doesn't exist yet; an existing folder is used as-is.
export function createProject(name: string, blurb: string, dir?: string): { workspace: Workspace; created: boolean } {
  const id = slugify(name);
  const existing = WORKSPACES.find((w) => w.id === id);
  if (existing) return { workspace: existing, created: false };
  const cwd = dir ? path.resolve(dir.replace(/^~(?=\/|$)/, home)) : path.join(home, "workspace", id);
  let created = false;
  if (!fs.existsSync(cwd)) {
    fs.mkdirSync(cwd, { recursive: true });
    created = true;
  }
  const stored: StoredProject = { id, name, cwd, blurb, color: PALETTE[loadStoredProjects().length % PALETTE.length] };
  fs.mkdirSync(path.dirname(PROJECTS_FILE), { recursive: true });
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify([...loadStoredProjects(), stored], null, 2) + "\n");
  const ws: Workspace = { ...stored, mode: "guarded", model: DEFAULT_MODEL };
  WORKSPACES.push(ws);
  return { workspace: ws, created };
}

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
  if (/\bcortex\b|\byourself\b|\byour (own )?code\b/.test(t)) return getWorkspace("cortex");
  if (/\bbrain\b|\bjournal\b|\bcalendar\b/.test(t)) return getWorkspace("brain");
  return null;
}
