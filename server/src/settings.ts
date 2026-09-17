import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Small persistent settings file shared by the server, the desk voice client
// and the brain's notify.sh: ~/.cortex/config.json
export type CortexSettings = {
  ntfyTopic: string;
  voice: string; // kokoro voice id
  speakReplies: boolean;
  briefingHour: number; // local hour after which the daily briefing may run
  lastBriefingDate?: string; // YYYY-MM-DD
  lastBriefingChatId?: string;
};

const DIR = path.join(os.homedir(), ".cortex");
const FILE = path.join(DIR, "config.json");

const DEFAULTS: CortexSettings = {
  ntfyTopic: "",
  voice: "bm_lewis",
  speakReplies: true,
  briefingHour: 7,
};

export function loadSettings(): CortexSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { ...DEFAULTS, ...raw };
  } catch {
    const fresh = { ...DEFAULTS, ntfyTopic: `cortex-${crypto.randomBytes(6).toString("hex")}` };
    saveSettings(fresh);
    return fresh;
  }
}

export function saveSettings(s: CortexSettings) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2) + "\n");
}

export function updateSettings(patch: Partial<CortexSettings>): CortexSettings {
  const next = { ...loadSettings(), ...patch };
  saveSettings(next);
  return next;
}

export const SETTINGS_FILE = FILE;
