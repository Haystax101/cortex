import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRAIN_DIR, PORT, DEFAULT_MODEL } from "./config.js";
import { chatsRouter } from "./chats.js";
import { filesRouter } from "./files.js";
import { attachWebSocket } from "./ws.js";

if (!fs.existsSync(BRAIN_DIR)) {
  console.error(`Brain directory not found: ${BRAIN_DIR}`);
  process.exit(1);
}

const app = express();
app.use(express.json());

app.use("/api/chats", chatsRouter);
app.use("/api/files", filesRouter);
app.get("/api/health", (_req, res) => res.json({ ok: true, brain: BRAIN_DIR, model: DEFAULT_MODEL }));

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

server.listen(PORT, "127.0.0.1", () => {
  const auth = process.env.ANTHROPIC_API_KEY ? "API key" : "Claude subscription (CLI login)";
  console.log(`Cortex server → http://127.0.0.1:${PORT}`);
  console.log(`  brain: ${BRAIN_DIR}`);
  console.log(`  model: ${DEFAULT_MODEL}`);
  console.log(`  auth:  ${auth}`);
});
