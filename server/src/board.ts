import { Router } from "express";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { listIdeas, removeIdea, linkIdea } from "./ideas.js";
import { createTask, discardTask, getTask, listTasks, markTask, mergeTask, messageTask, stopTask } from "./tasks.js";
import { toTranscript } from "./transcript.js";

// REST for the board UI: the same task actions the conductor has as tools,
// for when George would rather tap than talk.
export const boardRouter = Router();

const wrap =
  (fn: (req: import("express").Request) => Promise<unknown> | unknown) =>
  async (req: import("express").Request, res: import("express").Response) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  };

boardRouter.get("/tasks", (_req, res) => res.json(listTasks()));

boardRouter.post(
  "/tasks",
  wrap(async (req) => {
    const b = req.body ?? {};
    const t = await createTask({ project: b.project, title: b.title ?? "", brief: b.brief ?? "", where: b.where, model: b.model });
    if (typeof b.ideaId === "string") linkIdea(b.ideaId, t.id);
    return t;
  }),
);

boardRouter.get(
  "/tasks/:id/messages",
  wrap(async (req) => {
    const t = getTask(req.params.id);
    if (!t) throw new Error("no such task");
    if (!t.chatId) return { messages: [] };
    return { messages: toTranscript(await getSessionMessages(t.chatId, { dir: t.cwd })) };
  }),
);

boardRouter.post("/tasks/:id/message", wrap((req) => messageTask(req.params.id, String(req.body?.text ?? ""))));
boardRouter.post("/tasks/:id/stop", wrap((req) => stopTask(req.params.id)));
boardRouter.post("/tasks/:id/done", wrap((req) => markTask(req.params.id, "done")));
boardRouter.post("/tasks/:id/merge", wrap(async (req) => ({ message: await mergeTask(req.params.id) })));
boardRouter.post("/tasks/:id/discard", wrap(async (req) => ({ message: await discardTask(req.params.id) })));

boardRouter.get("/ideas", (_req, res) => res.json(listIdeas()));
boardRouter.delete(
  "/ideas/:id",
  wrap((req) => {
    removeIdea(req.params.id);
    return { ok: true };
  }),
);
