import { Router } from "express";
import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { FFMPEG_BIN, PYTHON_BIN, VOICE_DIR, WHISPER_BIN, WHISPER_MODEL } from "./config.js";
import { loadSettings } from "./settings.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const TTS_SCRIPT = path.resolve(here, "../../voice/tts_daemon.py");
const CACHE_DIR = path.join(VOICE_DIR, "cache");
const TMP = path.join(os.tmpdir(), "cortex-voice");
// Vocabulary hint so names transcribe correctly.
const WHISPER_PROMPT = "Cortex, George Hastings, Vantaphai, Supercharged, Get There One Day, GTOD, Palantir, University of Bath, Convex, Clerk, pgvector, Kokoro.";

// ---------------------------------------------------------------- TTS daemon

type Waiter = { resolve: (v: { ok: boolean; path?: string; error?: string; seconds?: number }) => void };
let daemon: ChildProcessWithoutNullStreams | null = null;
let daemonReady: Promise<void> | null = null;
const waiters = new Map<string, Waiter>();
let ttsAvailable: boolean | null = null;

function startDaemon(): Promise<void> {
  if (daemonReady) return daemonReady;
  daemonReady = new Promise<void>((resolve, reject) => {
    if (!fs.existsSync(PYTHON_BIN) || !fs.existsSync(TTS_SCRIPT)) {
      ttsAvailable = false;
      return reject(new Error(`TTS unavailable: missing ${PYTHON_BIN} or ${TTS_SCRIPT}`));
    }
    const p = spawn(PYTHON_BIN, [TTS_SCRIPT], { env: { ...process.env, CORTEX_VOICE_DIR: VOICE_DIR }, stdio: ["pipe", "pipe", "pipe"] });
    daemon = p;
    let buf = "";
    let ready = false;
    p.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.ready && !ready) {
          ready = true;
          ttsAvailable = true;
          resolve();
          continue;
        }
        const w = waiters.get(String(msg.id));
        if (w) {
          waiters.delete(String(msg.id));
          w.resolve(msg as { ok: boolean; path?: string; error?: string; seconds?: number });
        }
      }
    });
    p.stderr.on("data", (d) => {
      if (process.env.CORTEX_DEBUG) console.error("[tts]", d.toString().trim());
    });
    p.on("exit", (code) => {
      console.error(`[tts] daemon exited (${code})`);
      daemon = null;
      daemonReady = null;
      ttsAvailable = false;
      for (const w of waiters.values()) w.resolve({ ok: false, error: "tts daemon exited" });
      waiters.clear();
      if (!ready) reject(new Error(`tts daemon exited with ${code}`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error("tts daemon did not become ready in 60s"));
    }, 60_000);
  });
  return daemonReady;
}

export function warmTts() {
  startDaemon().catch((e) => console.error("[tts]", e.message));
}

export async function synthesize(text: string, voice?: string, speed?: number): Promise<string> {
  await startDaemon();
  const v = voice || loadSettings().voice || "bm_lewis";
  const s = speed ?? 1.05;
  const key = crypto.createHash("sha1").update(`${v}|${s}|${text}`).digest("hex");
  const out = path.join(CACHE_DIR, `${key}.wav`);
  if (fs.existsSync(out)) return out;
  const id = crypto.randomUUID();
  const result = await new Promise<{ ok: boolean; path?: string; error?: string }>((resolve) => {
    waiters.set(id, { resolve });
    daemon!.stdin.write(JSON.stringify({ id, text, voice: v, speed: s, out }) + "\n");
  });
  if (!result.ok) throw new Error(result.error || "tts failed");
  return out;
}

// ---------------------------------------------------------------- STT

function run(cmd: string, args: string[], input?: Buffer): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve({ stdout, stderr });
    });
    if (input) {
      child.stdin?.end(input);
    }
  });
}

export async function transcribe(audio: Buffer, mimeHint?: string): Promise<string> {
  await fsp.mkdir(TMP, { recursive: true });
  const id = crypto.randomUUID();
  const src = path.join(TMP, `${id}.in`);
  const wav = path.join(TMP, `${id}.wav`);
  await fsp.writeFile(src, audio);
  try {
    await run(FFMPEG_BIN, ["-y", "-loglevel", "error", "-i", src, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
    const { stdout } = await run(WHISPER_BIN, ["-m", WHISPER_MODEL, "-f", wav, "-nt", "-np", "-l", "en", "-t", "6", "--prompt", WHISPER_PROMPT]);
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("[") && !l.startsWith("whisper_"))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  } finally {
    void fsp.rm(src, { force: true });
    void fsp.rm(wav, { force: true });
    void mimeHint;
  }
}

// ---------------------------------------------------------------- routes

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

export const voiceRouter = Router();

voiceRouter.get("/status", (_req, res) => {
  res.json({
    tts: ttsAvailable,
    stt: fs.existsSync(WHISPER_MODEL),
    voice: loadSettings().voice,
    speakReplies: loadSettings().speakReplies,
  });
});

voiceRouter.post("/stt", upload.single("audio"), async (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ error: "no audio" });
  try {
    const text = await transcribe(f.buffer, f.mimetype);
    res.json({ text });
  } catch (e) {
    const err = e as Error & { stderr?: string };
    res.status(500).json({ error: err.message, detail: err.stderr?.slice(0, 500) });
  }
});

voiceRouter.post("/tts", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "text required" });
  try {
    const file = await synthesize(text.slice(0, 1500), req.body?.voice, req.body?.speed);
    res.type("audio/wav");
    res.sendFile(file);
  } catch (e) {
    res.status(503).json({ error: (e as Error).message });
  }
});
