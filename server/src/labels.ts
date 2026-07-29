import path from "node:path";
import { BRAIN_DIR } from "./config.js";

function rel(p: unknown): string {
  if (typeof p !== "string") return "";
  return p.startsWith(BRAIN_DIR) ? path.relative(BRAIN_DIR, p) || "." : p;
}

function str(v: unknown, max = 80): string {
  if (typeof v !== "string") return "";
  return v.length > max ? v.slice(0, max) + "…" : v;
}

// Human label for a tool call, e.g. "Reading knowledge/x.md".
export function toolLabel(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "Read":
      return `Reading ${rel(i.file_path)}`;
    case "Write":
      return `Writing ${rel(i.file_path)}`;
    case "Edit":
      return `Editing ${rel(i.file_path)}`;
    case "Glob":
      return `Scanning ${str(i.pattern)}`;
    case "Grep":
      return `Searching "${str(i.pattern)}"`;
    case "WebSearch":
      return `Searching the web: ${str(i.query)}`;
    case "WebFetch":
      return `Fetching ${str(i.url)}`;
    case "Bash":
      return `Running: ${str(i.description ?? i.command, 60)}`;
    case "Skill":
      return `Using skill: ${str(i.skill ?? i.command)}`;
    case "Task":
      return `Subagent: ${str(i.description)}`;
    case "TodoWrite":
      return "Updating plan";
    default:
      return name;
  }
}
