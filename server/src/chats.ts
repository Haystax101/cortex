import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { listSessions, getSessionMessages, renameSession } from "@anthropic-ai/claude-agent-sdk";
import { BRAIN_DIR, SESSIONS_DIR } from "./config.js";
import { toTranscript } from "./transcript.js";
import { busyChats } from "./ws.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const chatsRouter = Router();

chatsRouter.get("/", async (_req, res) => {
  const sessions = await listSessions({ dir: BRAIN_DIR });
  const chats = sessions
    .map((s) => ({
      id: s.sessionId,
      title: s.customTitle ?? s.summary ?? s.firstPrompt ?? "New chat",
      updatedAt: s.lastModified,
      createdAt: s.createdAt ?? s.lastModified,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(chats);
});

chatsRouter.get("/:id/messages", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid chat id" });
  const messages = await getSessionMessages(id, { dir: BRAIN_DIR });
  res.json(toTranscript(messages));
});

chatsRouter.post("/:id/rename", async (req, res) => {
  const { id } = req.params;
  const title = req.body?.title;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid chat id" });
  if (typeof title !== "string" || !title.trim()) return res.status(400).json({ error: "title required" });
  await renameSession(id, title.trim(), { dir: BRAIN_DIR });
  res.json({ ok: true });
});

chatsRouter.delete("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid chat id" });
  if (busyChats.has(id)) return res.status(409).json({ error: "chat has a response in progress" });
  try {
    await fs.rm(path.join(SESSIONS_DIR, `${id}.jsonl`));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  res.json({ ok: true });
});
