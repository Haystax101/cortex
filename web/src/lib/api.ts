import type { ChatMeta, UIMessage, TreeNode, Workspace, PermissionAsk, Settings, Task, Idea, ConductorInfo } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      msg = ((await r.json()) as { error?: string }).error ?? msg;
    } catch {
      // keep status text
    }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

const q = (workspace: string) => `workspace=${encodeURIComponent(workspace)}`;

export const api = {
  workspaces: () => fetch("/api/workspaces").then((r) => json<Workspace[]>(r)),
  listChats: (workspace: string) => fetch(`/api/chats?${q(workspace)}`).then((r) => json<ChatMeta[]>(r)),
  chatMessages: (id: string, workspace: string) =>
    fetch(`/api/chats/${id}/messages?${q(workspace)}`).then((r) =>
      json<{ messages: UIMessage[]; pending: PermissionAsk[]; busy: boolean }>(r),
    ),
  renameChat: (id: string, title: string, workspace: string) =>
    fetch(`/api/chats/${id}/rename?${q(workspace)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((r) => json<{ ok: boolean }>(r)),
  deleteChat: (id: string, workspace: string) =>
    fetch(`/api/chats/${id}?${q(workspace)}`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),
  fileTree: () => fetch("/api/files/tree").then((r) => json<TreeNode[]>(r)),
  fileContent: (path: string) => fetch(`/api/files/content?path=${encodeURIComponent(path)}`),
  upload: (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    return fetch("/api/files/upload", { method: "POST", body: form }).then((r) => json<{ saved: string[] }>(r));
  },
  stt: (blob: Blob) => {
    const form = new FormData();
    form.append("audio", blob, `clip.${blob.type.includes("wav") ? "wav" : blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm"}`);
    return fetch("/api/voice/stt", { method: "POST", body: form }).then((r) => json<{ text: string }>(r));
  },
  tts: (text: string) =>
    fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).then((r) => {
      if (!r.ok) throw new Error(`tts ${r.status}`);
      return r.blob();
    }),
  voiceStatus: () => fetch("/api/voice/status").then((r) => json<{ tts: boolean | null; stt: boolean; voice: string; speakReplies: boolean }>(r)),
  settings: () => fetch("/api/settings").then((r) => json<Settings>(r)),
  patchSettings: (patch: Partial<Settings>) =>
    fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then((r) => json<Settings>(r)),
  briefing: () => fetch("/api/briefing").then((r) => json<{ date: string | null; chatId: string | null; running: boolean; hour: number }>(r)),
  conductor: () => fetch("/api/conductor").then((r) => json<ConductorInfo>(r)),
  resetConductor: () => fetch("/api/conductor/reset", { method: "POST" }).then((r) => json<{ ok: boolean }>(r)),
  tasks: () => fetch("/api/board/tasks").then((r) => json<Task[]>(r)),
  ideas: () => fetch("/api/board/ideas").then((r) => json<Idea[]>(r)),
  deleteIdea: (id: string) => fetch(`/api/board/ideas/${id}`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),
  createTask: (body: { project: string; title: string; brief: string; ideaId?: string; where?: "local" | "cloud"; model?: "opus" | "sonnet" }) =>
    post<Task>("/api/board/tasks", body),
  taskMessages: (id: string) => fetch(`/api/board/tasks/${id}/messages`).then((r) => json<{ messages: UIMessage[] }>(r)),
  taskAction: (id: string, action: "stop" | "done" | "merge" | "discard") => post<Task | { message: string }>(`/api/board/tasks/${id}/${action}`, {}),
  messageTask: (id: string, text: string) => post<Task>(`/api/board/tasks/${id}/message`, { text }),
  runBriefing: (force = false) =>
    fetch("/api/briefing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force }) }).then((r) =>
      json<{ chatId: string; text: string }>(r),
    ),
};
