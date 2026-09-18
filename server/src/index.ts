import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRAIN_DIR, HOST, PORT, DEFAULT_MODEL, FAST_MODEL } from "./config.js";
import { chatsRouter, workspacesRouter } from "./chats.js";
import { filesRouter } from "./files.js";
import { attachWebSocket, broadcast } from "./ws.js";
import { voiceRouter, warmTts, warmStt } from "./voice.js";
import { briefingRouter, setBriefingBroadcast, startBriefingScheduler } from "./briefing.js";
import { loadSettings, updateSettings } from "./settings.js";

if (!fs.existsSync(BRAIN_DIR)) {
  console.error(`Brain directory not found: ${BRAIN_DIR}`);
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/api/chats", chatsRouter);
app.use("/api/workspaces", workspacesRouter);
app.use("/api/files", filesRouter);
app.use("/api/voice", voiceRouter);
app.use("/api/briefing", briefingRouter);

app.get("/api/settings", (_req, res) => res.json(loadSettings()));
app.patch("/api/settings", (req, res) => {
  const allowed = ["voice", "speakReplies", "briefingHour", "ntfyTopic"] as const;
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in (req.body ?? {})) patch[k] = req.body[k];
  res.json(updateSettings(patch));
});

app.get("/api/health", (_req, res) => res.json({ ok: true, brain: BRAIN_DIR, model: DEFAULT_MODEL, fastModel: FAST_MODEL }));

// Serve the built frontend when it exists (production mode).
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const server = http.createServer(app);
attachWebSocket(server);
setBriefingBroadcast(broadcast);

server.listen(PORT, HOST, () => {
  const auth = process.env.ANTHROPIC_API_KEY ? "API key" : "Claude subscription (CLI login)";
  const s = loadSettings();
  console.log(`Cortex server → http://${HOST}:${PORT}`);
  console.log(`  brain: ${BRAIN_DIR}`);
  console.log(`  model: ${DEFAULT_MODEL} (fast: ${FAST_MODEL})`);
  console.log(`  auth:  ${auth}`);
  console.log(`  ntfy:  https://ntfy.sh/${s.ntfyTopic}`);
  warmTts();
  warmStt();
  startBriefingScheduler();
});
