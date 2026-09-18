import os from "node:os";
import path from "node:path";

export const BRAIN_DIR = process.env.BRAIN_DIR ?? path.join(os.homedir(), "brain");
export const PORT = Number(process.env.PORT ?? 3001);
export const HOST = process.env.HOST ?? "127.0.0.1";
export const DEFAULT_MODEL = process.env.CORTEX_MODEL ?? "claude-opus-5";
// Cheaper model for briefings and quick voice chatter.
export const FAST_MODEL = process.env.CORTEX_FAST_MODEL ?? "claude-sonnet-5";

// Voice helpers live outside the repo (models are large).
export const VOICE_DIR = process.env.CORTEX_VOICE_DIR ?? path.join(os.homedir(), "cortex-voice");
export const WHISPER_MODEL = process.env.WHISPER_MODEL ?? path.join(VOICE_DIR, "models", "ggml-base.en.bin");
export const WHISPER_SERVER_BIN = process.env.WHISPER_SERVER_BIN ?? "whisper-server";
export const WHISPER_PORT = Number(process.env.WHISPER_PORT ?? 2022);
export const WHISPER_BIN = process.env.WHISPER_BIN ?? "whisper-cli";
export const FFMPEG_BIN = process.env.FFMPEG_BIN ?? "ffmpeg";
export const PYTHON_BIN = process.env.CORTEX_PYTHON ?? path.join(VOICE_DIR, ".venv", "bin", "python");
export const CAL_BIN = process.env.CORTEX_CAL ?? path.join(os.homedir(), ".local", "bin", "cortex-cal");

// Where the Agent SDK persists session JSONLs for BRAIN_DIR (used only for delete).
export const SESSIONS_DIR = path.join(
  os.homedir(),
  ".claude",
  "projects",
  BRAIN_DIR.replace(/[^a-zA-Z0-9]/g, "-"),
);
