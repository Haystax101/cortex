import { create } from "zustand";
import type { ChatMeta, ServerFrame, TreeNode, UIBlock, UIMessage } from "../lib/types";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";

// Key used for a brand-new chat's transcript until the server assigns a session id.
const NEW = "__new__";

type UploadNotice = { paths: string[] } | null;

interface CortexStore {
  chats: ChatMeta[];
  activeChatId: string | null; // null = new chat view
  transcripts: Record<string, UIMessage[]>;
  streamBlocks: UIBlock[] | null; // in-flight assistant draft for streamChatId
  streamChatId: string | null; // null while a new chat awaits its session id
  busy: boolean;
  connected: boolean;
  error: string | null;
  tree: TreeNode[];
  viewerPath: string | null;
  uploadNotice: UploadNotice;

  init: () => void;
  refreshChats: () => Promise<void>;
  refreshTree: () => Promise<void>;
  selectChat: (id: string | null) => void;
  sendMessage: (text: string) => void;
  interrupt: () => void;
  renameChat: (id: string, title: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  openViewer: (path: string | null) => void;
  uploadFiles: (files: File[]) => Promise<void>;
  dismissUpload: () => void;
  clearError: () => void;
}

export const useStore = create<CortexStore>((set, get) => {
  function handleFrame(f: ServerFrame) {
    const s = get();
    switch (f.type) {
      case "chat.session": {
        if (s.streamChatId === null && s.busy) {
          // Adopt the server-assigned session id for the pending new chat.
          const transcripts = { ...s.transcripts };
          if (transcripts[NEW]) {
            transcripts[f.chatId] = transcripts[NEW];
            delete transcripts[NEW];
          }
          const placeholder: ChatMeta = {
            id: f.chatId,
            title: transcripts[f.chatId]?.[0]?.blocks.find((b) => b.kind === "text")?.text.slice(0, 60) ?? "New chat",
            updatedAt: Date.now(),
            createdAt: Date.now(),
          };
          set({
            transcripts,
            streamChatId: f.chatId,
            activeChatId: s.activeChatId === null ? f.chatId : s.activeChatId,
            chats: [placeholder, ...s.chats],
          });
        }
        break;
      }
      case "text.delta": {
        if (!s.streamBlocks) break;
        const blocks = [...s.streamBlocks];
        const last = blocks[blocks.length - 1];
        if (last?.kind === "text") {
          blocks[blocks.length - 1] = { kind: "text", text: last.text + f.text };
        } else {
          blocks.push({ kind: "text", text: f.text });
        }
        set({ streamBlocks: blocks });
        break;
      }
      case "thinking.delta": {
        if (!s.streamBlocks) break;
        const blocks = [...s.streamBlocks];
        const last = blocks[blocks.length - 1];
        if (last?.kind === "thinking") {
          blocks[blocks.length - 1] = { kind: "thinking", text: last.text + f.text };
        } else {
          blocks.push({ kind: "thinking", text: f.text });
        }
        set({ streamBlocks: blocks });
        break;
      }
      case "tool.start": {
        if (!s.streamBlocks) break;
        set({
          streamBlocks: [
            ...s.streamBlocks,
            { kind: "tool", toolId: f.toolId, name: f.name, label: f.label, running: true },
          ],
        });
        break;
      }
      case "tool.end": {
        if (!s.streamBlocks) break;
        set({
          streamBlocks: s.streamBlocks.map((b) =>
            b.kind === "tool" && b.toolId === f.toolId ? { ...b, label: f.label } : b,
          ),
        });
        break;
      }
      case "tool.result": {
        if (!s.streamBlocks) break;
        set({
          streamBlocks: s.streamBlocks.map((b) =>
            b.kind === "tool" && b.toolId === f.toolId ? { ...b, running: false, isError: f.isError } : b,
          ),
        });
        break;
      }
      case "message.complete":
        // Live rendering uses deltas; canonical transcript is refetched on turn.done.
        break;
      case "turn.done": {
        // Commit the streamed draft locally — the session JSONL may not be fully
        // flushed yet, so an immediate refetch can miss the final message.
        const draft = s.streamBlocks;
        if (draft?.length && f.chatId) {
          const finalMsg: UIMessage = {
            id: `turn-${Date.now()}`,
            role: "assistant",
            blocks: draft.map((b) => (b.kind === "tool" ? { ...b, running: false } : b)),
          };
          set((st) => ({
            transcripts: { ...st.transcripts, [f.chatId]: [...(st.transcripts[f.chatId] ?? []), finalMsg] },
          }));
        }
        set({ busy: false, streamBlocks: null, streamChatId: null });
        void get().refreshChats();
        void get().refreshTree();
        // Canonicalize from the server once the JSONL has settled.
        if (f.chatId) {
          setTimeout(() => {
            void api.chatMessages(f.chatId).then((msgs) => {
              if (msgs.length) set((st) => ({ transcripts: { ...st.transcripts, [f.chatId]: msgs } }));
            });
          }, 2000);
        }
        break;
      }
      case "chat.error": {
        set({ busy: false, streamBlocks: null, streamChatId: null, error: f.error });
        if (f.chatId) {
          void api.chatMessages(f.chatId).then((msgs) =>
            set((st) => ({ transcripts: { ...st.transcripts, [f.chatId as string]: msgs } })),
          );
        }
        break;
      }
    }
  }

  return {
    chats: [],
    activeChatId: null,
    transcripts: {},
    streamBlocks: null,
    streamChatId: null,
    busy: false,
    connected: false,
    error: null,
    tree: [],
    viewerPath: null,
    uploadNotice: null,

    init: () => {
      wsClient.connect(handleFrame, (connected) => {
        const wasBusy = get().busy;
        set({ connected });
        // If the socket dropped mid-turn we lost frames; re-sync from the server.
        if (connected && wasBusy) {
          const id = get().streamChatId;
          set({ busy: false, streamBlocks: null, streamChatId: null });
          if (id) {
            void api.chatMessages(id).then((msgs) =>
              set((st) => ({ transcripts: { ...st.transcripts, [id]: msgs } })),
            );
          }
        }
      });
      void get().refreshChats();
      void get().refreshTree();
    },

    refreshChats: async () => {
      try {
        set({ chats: await api.listChats() });
      } catch {
        // server may be restarting; keep stale list
      }
    },

    refreshTree: async () => {
      try {
        set({ tree: await api.fileTree() });
      } catch {
        // ignore
      }
    },

    selectChat: (id) => {
      set({ activeChatId: id });
      // Always refetch (cached copy shows meanwhile) so history never goes stale.
      if (id) {
        void api.chatMessages(id).then((msgs) => {
          if (msgs.length) set((st) => ({ transcripts: { ...st.transcripts, [id]: msgs } }));
        });
      }
    },

    sendMessage: (text) => {
      const s = get();
      if (s.busy || !text.trim()) return;
      const chatId = s.activeChatId;
      const key = chatId ?? NEW;
      const userMsg: UIMessage = {
        id: `local-${Date.now()}`,
        role: "user",
        blocks: [{ kind: "text", text }],
      };
      const ok = wsClient.send({ type: "chat.send", chatId, text });
      if (!ok) {
        set({ error: "Not connected to the server." });
        return;
      }
      set({
        transcripts: { ...s.transcripts, [key]: [...(s.transcripts[key] ?? []), userMsg] },
        streamBlocks: [],
        streamChatId: chatId,
        busy: true,
        error: null,
      });
    },

    interrupt: () => {
      const id = get().streamChatId;
      if (id) wsClient.send({ type: "chat.interrupt", chatId: id });
    },

    renameChat: async (id, title) => {
      await api.renameChat(id, title);
      await get().refreshChats();
    },

    deleteChat: async (id) => {
      await api.deleteChat(id);
      const s = get();
      const transcripts = { ...s.transcripts };
      delete transcripts[id];
      set({
        transcripts,
        activeChatId: s.activeChatId === id ? null : s.activeChatId,
        chats: s.chats.filter((c) => c.id !== id),
      });
    },

    openViewer: (path) => set({ viewerPath: path }),

    uploadFiles: async (files) => {
      if (!files.length) return;
      try {
        const { saved } = await api.upload(files);
        set({ uploadNotice: { paths: saved } });
        void get().refreshTree();
      } catch (e) {
        set({ error: `Upload failed: ${e instanceof Error ? e.message : e}` });
      }
    },

    dismissUpload: () => set({ uploadNotice: null }),
    clearError: () => set({ error: null }),
  };
});

export const NEW_KEY = NEW;
