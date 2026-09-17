import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { listSessions, getSessionMessages, renameSession } from "@anthropic-ai/claude-agent-sdk";
import { getWorkspace, sessionsDirFor, WORKSPACES, workspaceExists } from "./workspaces.js";
import { toTranscript } from "./transcript.js";
import { busyChats } from "./ws.js";
import { pendingFor } from "./permissions.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const chatsRouter = Router();
export const workspacesRouter = Router();

workspacesRouter.get("/", (_req, res) => {
  res.json(
    WORKSPACES.map((w) => ({ id: w.id, name: w.name, color: w.color, blurb: w.blurb, mode: w.mode, cwd: w.cwd, available: workspaceExists(w) })),
  );
});

function wsFrom(req: { query: Record<string, unknown> }) {
  return getWorkspace(typeof req.query.workspace === "string" ? req.query.workspace : "brain");
}

chatsRouter.get("/", async (req, res) => {
  const ws = wsFrom(req);
  if (!workspaceExists(ws)) return res.json([]);
  const sessions = await listSessions({ dir: ws.cwd });
  const chats = sessions
    .map((s) => ({
      id: s.sessionId,
      title: s.customTitle ?? s.summary ?? s.firstPrompt ?? "New chat",
      updatedAt: s.lastModified,
      createdAt: s.createdAt ?? s.lastModified,
      workspace: ws.id,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 80);
  res.json(chats);
});

chatsRouter.get("/:id/messages", async (req, res) => {
  const { id } = req.params;
  const ws = wsFrom(req);
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid chat id" });
  const messages = await getSessionMessages(id, { dir: ws.cwd });
  res.json({ messages: toTranscript(messages), pending: pendingFor(id), busy: busyChats.has(id) });
});

chatsRouter.post("/:id/rename", async (req, res) => {
  const { id } = req.params;
  const ws = wsFrom(req);
  const title = req.body?.title;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid chat id" });
  if (typeof title !== "string" || !title.trim()) return res.status(400).json({ error: "title required" });
  await renameSession(id, title.trim(), { dir: ws.cwd });
  res.json({ ok: true });
});

chatsRouter.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const ws = wsFrom(req);
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid chat id" });
  if (busyChats.has(id)) return res.status(409).json({ error: "chat has a response in progress" });
  try {
    await fs.rm(path.join(sessionsDirFor(ws), `${id}.jsonl`));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  res.json({ ok: true });
});
