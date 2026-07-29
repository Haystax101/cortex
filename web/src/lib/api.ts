import type { ChatMeta, UIMessage, TreeNode } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  listChats: () => fetch("/api/chats").then((r) => json<ChatMeta[]>(r)),
  chatMessages: (id: string) => fetch(`/api/chats/${id}/messages`).then((r) => json<UIMessage[]>(r)),
  renameChat: (id: string, title: string) =>
    fetch(`/api/chats/${id}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((r) => json<{ ok: boolean }>(r)),
  deleteChat: (id: string) => fetch(`/api/chats/${id}`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),
  fileTree: () => fetch("/api/files/tree").then((r) => json<TreeNode[]>(r)),
  fileContent: (path: string) => fetch(`/api/files/content?path=${encodeURIComponent(path)}`),
  upload: (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    return fetch("/api/files/upload", { method: "POST", body: form }).then((r) => json<{ saved: string[] }>(r));
  },
};
