import os from "node:os";
import path from "node:path";

export const BRAIN_DIR = process.env.BRAIN_DIR ?? path.join(os.homedir(), "brain");
export const PORT = Number(process.env.PORT ?? 3001);
export const DEFAULT_MODEL = process.env.CORTEX_MODEL ?? "claude-opus-5";

// Where the Agent SDK persists session JSONLs for BRAIN_DIR (used only for delete).
export const SESSIONS_DIR = path.join(
  os.homedir(),
  ".claude",
  "projects",
  BRAIN_DIR.replace(/[^a-zA-Z0-9]/g, "-"),
);
