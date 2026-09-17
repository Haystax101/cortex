import { Router } from "express";
import { renameSession } from "@anthropic-ai/claude-agent-sdk";
import { runHeadless } from "./agent.js";
import { BRIEFING_MODEL, getWorkspace } from "./workspaces.js";
import { loadSettings, updateSettings } from "./settings.js";
import { sendNtfy } from "./tools.js";
import type { ServerFrame } from "./frames.js";

let running: Promise<{ chatId: string; text: string }> | null = null;
let broadcast: (f: ServerFrame) => void = () => {};

export function setBriefingBroadcast(fn: (f: ServerFrame) => void) {
  broadcast = fn;
}

function localDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const PROMPT = (date: string) =>
  `It is the morning of ${date}. Run the briefing skill for today. Read the calendar with cortex-cal, yesterday's journal, every projects/*.md, gtod/content-log.md, internships/tracker.md and tools/git-activity.sh. ` +
  `Write the briefing into today's journal under "## Briefing" (create the journal file from the template if needed), then reply with the spoken-style briefing: under 200 words, plain sentences, at most one question at the end.`;

export function runBriefing(force = false): Promise<{ chatId: string; text: string }> {
  if (running) return running;
  const date = localDate();
  const s = loadSettings();
  if (!force && s.lastBriefingDate === date && s.lastBriefingChatId) {
    return Promise.resolve({ chatId: s.lastBriefingChatId, text: "" });
  }
  running = (async () => {
    console.log(`[briefing] running for ${date}`);
    broadcast({ type: "briefing.status", running: true, date });
    try {
      const { chatId, text } = await runHeadless(PROMPT(date), {
        workspaceId: "brain",
        model: BRIEFING_MODEL,
        voice: true,
      });
      try {
        await renameSession(chatId, `Briefing ${date}`, { dir: getWorkspace("brain").cwd });
      } catch {
        // title is cosmetic
      }
      updateSettings({ lastBriefingDate: date, lastBriefingChatId: chatId });
      const summary = text.length > 700 ? text.slice(0, 690) + "…" : text;
      void sendNtfy(`Cortex briefing, ${date}`, summary || "Your briefing is ready.");
      broadcast({ type: "briefing.ready", chatId, date, text });
      return { chatId, text };
    } finally {
      broadcast({ type: "briefing.status", running: false, date });
      running = null;
    }
  })();
  return running;
}

// Run once per day, the first time the server is up after briefingHour.
export function startBriefingScheduler() {
  const tick = () => {
    const s = loadSettings();
    const now = new Date();
    if (now.getHours() < s.briefingHour) return;
    if (s.lastBriefingDate === localDate()) return;
    runBriefing().catch((e) => console.error("[briefing]", e));
  };
  setTimeout(tick, 20_000);
  setInterval(tick, 5 * 60_000);
}

export const briefingRouter = Router();

briefingRouter.get("/", (_req, res) => {
  const s = loadSettings();
  res.json({ date: s.lastBriefingDate ?? null, chatId: s.lastBriefingChatId ?? null, running: !!running, hour: s.briefingHour });
});

briefingRouter.post("/", async (req, res) => {
  try {
    const force = req.body?.force === true || req.query.force === "1";
    const r = await runBriefing(force);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
