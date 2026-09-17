import { create } from "zustand";
import type { ChatMeta, PermissionAsk, ServerFrame, TreeNode, UIBlock, UIMessage, Workspace } from "../lib/types";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import { speaker } from "../lib/speech";

// Key used for a brand-new chat's transcript until the server assigns a session id.
const NEW = "__new__";

type UploadNotice = { paths: string[] } | null;

interface CortexStore {
  workspaces: Workspace[];
  workspace: string; // active workspace id
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
  asks: PermissionAsk[];
  speak: boolean; // read replies aloud
  speaking: boolean;
  listening: boolean;
  transcribing: boolean;
  briefingRunning: boolean;
  lastBriefing: { chatId: string; date: string } | null;
  pendingSwitch: { workspace: string; reason: string } | null;
  sidebarOpen: boolean;
  filesOpen: boolean;

  init: () => void;
  refreshChats: () => Promise<void>;
  refreshTree: () => Promise<void>;
  setWorkspace: (id: string) => void;
  selectChat: (id: string | null) => void;
  sendMessage: (text: string, opts?: { voice?: boolean }) => void;
  interrupt: () => void;
  renameChat: (id: string, title: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  openViewer: (path: string | null) => void;
  uploadFiles: (files: File[]) => Promise<void>;
  dismissUpload: () => void;
  clearError: () => void;
  answerAsk: (id: string, allow: boolean) => void;
  setSpeak: (v: boolean) => void;
  setListening: (v: boolean) => void;
  setTranscribing: (v: boolean) => void;
  runBriefing: (force?: boolean) => Promise<void>;
  openBriefing: () => void;
  setSidebarOpen: (v: boolean) => void;
  setFilesOpen: (v: boolean) => void;
}

function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // ignore
  }
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
            workspace: f.workspace,
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
        speaker.feed(f.text);
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
        speaker.flush();
        set({ streamBlocks: [...s.streamBlocks, { kind: "tool", toolId: f.toolId, name: f.name, label: f.label, running: true }] });
        break;
      }
      case "tool.end": {
        if (!s.streamBlocks) break;
        set({ streamBlocks: s.streamBlocks.map((b) => (b.kind === "tool" && b.toolId === f.toolId ? { ...b, label: f.label } : b)) });
        break;
      }
      case "tool.result": {
        if (!s.streamBlocks) break;
        set({
          streamBlocks: s.streamBlocks.map((b) => (b.kind === "tool" && b.toolId === f.toolId ? { ...b, running: false, isError: f.isError } : b)),
        });
        break;
      }
      case "message.complete":
        break;
      case "turn.done": {
        speaker.flush();
        // Commit the streamed draft locally — the session JSONL may not be fully
        // flushed yet, so an immediate refetch can miss the final message.
        const draft = s.streamBlocks;
        if (draft?.length && f.chatId) {
          const finalMsg: UIMessage = {
            id: `turn-${Date.now()}`,
            role: "assistant",
            blocks: draft.map((b) => (b.kind === "tool" ? { ...b, running: false } : b)),
          };
          set((st) => ({ transcripts: { ...st.transcripts, [f.chatId]: [...(st.transcripts[f.chatId] ?? []), finalMsg] } }));
        }
        set({ busy: false, streamBlocks: null, streamChatId: null, asks: s.asks.filter((a) => a.chatId !== f.chatId) });
        void get().refreshChats();
        void get().refreshTree();
        // Canonicalize from the server once the JSONL has settled.
        if (f.chatId) {
          const wsId = get().workspace;
          setTimeout(() => {
            void api.chatMessages(f.chatId, wsId).then(({ messages }) => {
              if (messages.length) set((st) => ({ transcripts: { ...st.transcripts, [f.chatId]: messages } }));
            });
          }, 2000);
        }
        // A workspace switch requested during the turn takes effect now.
        const sw = get().pendingSwitch;
        if (sw) {
          set({ pendingSwitch: null });
          get().setWorkspace(sw.workspace);
          set({ activeChatId: null });
        }
        break;
      }
      case "chat.error": {
        speaker.stop();
        set({ busy: false, streamBlocks: null, streamChatId: null, error: f.error });
        if (f.chatId) {
          const wsId = get().workspace;
          void api.chatMessages(f.chatId, wsId).then(({ messages }) =>
            set((st) => ({ transcripts: { ...st.transcripts, [f.chatId as string]: messages } })),
          );
        }
        break;
      }
      case "permission.ask": {
        set({ asks: [...s.asks.filter((a) => a.id !== f.id), { id: f.id, chatId: f.chatId, toolName: f.toolName, label: f.label, input: f.input }] });
        break;
      }
      case "permission.resolved": {
        set({ asks: s.asks.filter((a) => a.id !== f.id) });
        break;
      }
      case "workspace.switch": {
        set({ pendingSwitch: { workspace: f.workspace, reason: f.reason } });
        break;
      }
      case "briefing.status": {
        set({ briefingRunning: f.running });
        break;
      }
      case "briefing.ready": {
        set({ lastBriefing: { chatId: f.chatId, date: f.date }, briefingRunning: false });
        if (get().workspace === "brain") void get().refreshChats();
        break;
      }
    }
  }

  return {
    workspaces: [],
    workspace: readPref("cortex.workspace", "brain"),
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
    asks: [],
    speak: readPref("cortex.speak", true),
    speaking: false,
    listening: false,
    transcribing: false,
    briefingRunning: false,
    lastBriefing: null,
    pendingSwitch: null,
    sidebarOpen: false,
    filesOpen: false,

    init: () => {
      speaker.setEnabled(get().speak);
      speaker.onSpeaking((speaking) => set({ speaking }));
      wsClient.connect(handleFrame, (connected) => {
        const wasBusy = get().busy;
        set({ connected });
        if (connected && wasBusy) {
          const id = get().streamChatId;
          set({ busy: false, streamBlocks: null, streamChatId: null });
          if (id) {
            void api.chatMessages(id, get().workspace).then(({ messages }) =>
              set((st) => ({ transcripts: { ...st.transcripts, [id]: messages } })),
            );
          }
        }
      });
      void api.workspaces().then((workspaces) => {
        set({ workspaces });
        if (!workspaces.some((w) => w.id === get().workspace)) set({ workspace: "brain" });
        void get().refreshChats();
      });
      void api.briefing().then((b) => {
        if (b.chatId && b.date) set({ lastBriefing: { chatId: b.chatId, date: b.date }, briefingRunning: b.running });
      });
      void get().refreshTree();
    },

    refreshChats: async () => {
      try {
        const ws = get().workspace;
        const chats = await api.listChats(ws);
        if (get().workspace === ws) set({ chats });
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

    setWorkspace: (id) => {
      if (id === get().workspace) return;
      writePref("cortex.workspace", id);
      set({ workspace: id, chats: [], activeChatId: null, asks: [], sidebarOpen: false });
      void get().refreshChats();
    },

    selectChat: (id) => {
      set({ activeChatId: id, sidebarOpen: false });
      if (id) {
        void api.chatMessages(id, get().workspace).then(({ messages, pending, busy }) => {
          set((st) => ({
            transcripts: { ...st.transcripts, [id]: messages.length ? messages : (st.transcripts[id] ?? []) },
            asks: [...st.asks.filter((a) => a.chatId !== id), ...pending],
          }));
          void busy;
        });
      }
    },

    sendMessage: (text, opts) => {
      const s = get();
      if (s.busy || !text.trim()) return;
      const chatId = s.activeChatId;
      const key = chatId ?? NEW;
      const userMsg: UIMessage = { id: `local-${Date.now()}`, role: "user", blocks: [{ kind: "text", text }] };
      speaker.stop();
      speaker.setEnabled(s.speak);
      if (s.speak) speaker.unlock();
      const ok = wsClient.send({ type: "chat.send", chatId, text, workspace: s.workspace, voice: !!opts?.voice });
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
      speaker.stop();
      if (id) wsClient.send({ type: "chat.interrupt", chatId: id });
    },

    renameChat: async (id, title) => {
      await api.renameChat(id, title, get().workspace);
      await get().refreshChats();
    },

    deleteChat: async (id) => {
      await api.deleteChat(id, get().workspace);
      const s = get();
      const transcripts = { ...s.transcripts };
      delete transcripts[id];
      set({ transcripts, activeChatId: s.activeChatId === id ? null : s.activeChatId, chats: s.chats.filter((c) => c.id !== id) });
    },

    openViewer: (path) => set({ viewerPath: path, filesOpen: path ? get().filesOpen : get().filesOpen }),

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

    answerAsk: (id, allow) => {
      wsClient.send({ type: "permission.reply", id, allow });
      set({ asks: get().asks.filter((a) => a.id !== id) });
    },

    setSpeak: (v) => {
      writePref("cortex.speak", v);
      speaker.setEnabled(v);
      if (v) speaker.unlock();
      set({ speak: v });
    },
    setListening: (v) => set({ listening: v }),
    setTranscribing: (v) => set({ transcribing: v }),

    runBriefing: async (force) => {
      set({ briefingRunning: true, error: null });
      try {
        const r = await api.runBriefing(force);
        set({ lastBriefing: { chatId: r.chatId, date: new Date().toISOString().slice(0, 10) } });
        if (get().workspace !== "brain") get().setWorkspace("brain");
        await get().refreshChats();
        get().selectChat(r.chatId);
      } catch (e) {
        set({ error: `Briefing failed: ${e instanceof Error ? e.message : e}` });
      } finally {
        set({ briefingRunning: false });
      }
    },

    openBriefing: () => {
      const b = get().lastBriefing;
      if (!b) return;
      if (get().workspace !== "brain") get().setWorkspace("brain");
      void get()
        .refreshChats()
        .then(() => get().selectChat(b.chatId));
    },

    setSidebarOpen: (v) => set({ sidebarOpen: v }),
    setFilesOpen: (v) => set({ filesOpen: v }),
  };
});

export const NEW_KEY = NEW;
