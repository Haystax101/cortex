import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bus } from "./bus.js";

// Ideas George throws out while brainstorming. The conductor captures them;
// the board shows them; one tap (or "go build that") turns one into a task.

export type Idea = { id: string; text: string; project?: string; createdAt: number; taskId?: string };

const FILE = path.join(os.homedir(), ".cortex", "ideas.json");

function load(): Idea[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Idea[];
  } catch {
    return [];
  }
}

let ideas = load();

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(ideas, null, 2));
  bus.frame({ type: "ideas.update", ideas });
}

export function listIdeas(): Idea[] {
  return ideas;
}

export function addIdea(text: string, project?: string): Idea {
  const idea: Idea = { id: crypto.randomUUID().slice(0, 8), text: text.trim(), project, createdAt: Date.now() };
  ideas = [idea, ...ideas].slice(0, 300);
  save();
  return idea;
}

export function removeIdea(id: string) {
  ideas = ideas.filter((i) => i.id !== id);
  save();
}

export function linkIdea(id: string, taskId: string) {
  const i = ideas.find((x) => x.id === id);
  if (i) {
    i.taskId = taskId;
    save();
  }
}
