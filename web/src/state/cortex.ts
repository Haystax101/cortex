import { create } from "zustand";
import type { ConductorInfo, Idea, LogEntry, ServerFrame, Task } from "../lib/types";
import { api } from "../lib/api";
import { wsClient } from "../lib/ws";
import { speaker } from "../lib/speech";

// State for the conductor conversation and the board. Frames arrive through
// the main store's WebSocket handler (state/store.ts forwards cx.*, task.* and
// ideas.* here).

type Draft = { turnId: string; source: "george" | "update"; text: string; tools: string[] };

interface CortexState {
  view: "cortex" | "chat";
  mobileTab: "talk" | "board";
  log: LogEntry[];
  draft: Draft | null;
  busy: boolean;
  info: Omit<ConductorInfo, "log"> | null;
  error: string | null;
  tasks: Task[];
  ideas: Idea[];
  openTaskId: string | null;
  handsFree: boolean;
  /** this tab sent the last message, so it should be the one that speaks */
  saidHere: boolean;

  init: () => void;
  handle: (f: ServerFrame) => void;
  say: (text: string, voice?: boolean) => void;
  interrupt: () => void;
  setView: (v: "cortex" | "chat") => void;
  setMobileTab: (t: "talk" | "board") => void;
  openTask: (id: string | null) => void;
  setHandsFree: (v: boolean) => void;
  clearError: () => void;
  setError: (e: string) => void;
}

function shouldSpeak(saidHere: boolean): boolean {
  if (!speaker.isEnabled()) return false;
  // With the app open on the phone and the laptop, only the one in use talks.
  return saidHere || (document.visibilityState === "visible" && document.hasFocus());
}

export const useCortex = create<CortexState>((set, get) => ({
  view: "cortex",
  mobileTab: "talk",
  log: [],
  draft: null,
  busy: false,
  info: null,
  error: null,
  tasks: [],
  ideas: [],
  openTaskId: null,
  handsFree: false,
  saidHere: false,

  init: () => {
    void api
      .conductor()
      .then(({ log, ...info }) => set({ log, info, busy: info.busy }))
      .catch(() => {});
    void api.tasks().then((tasks) => set({ tasks })).catch(() => {});
    void api.ideas().then((ideas) => set({ ideas })).catch(() => {});
  },

  handle: (f) => {
    const s = get();
    switch (f.type) {
      case "cx.start":
        set({ draft: { turnId: f.turnId, source: f.source, text: "", tools: [] }, busy: true });
        break;
      case "cx.delta": {
        if (!s.draft || s.draft.turnId !== f.turnId) set({ draft: { turnId: f.turnId, source: "george", text: "", tools: [] } });
        const d = get().draft!;
        set({ draft: { ...d, text: d.text + f.text } });
        if (shouldSpeak(s.saidHere)) speaker.feed(f.text);
        break;
      }
      case "cx.tool": {
        if (s.draft?.turnId === f.turnId) set({ draft: { ...s.draft, tools: [...s.draft.tools, f.label] } });
        break;
      }
      case "cx.done":
        speaker.flush();
        set({ draft: null, busy: false });
        void api
          .conductor()
          .then(({ log: _log, ...info }) => set({ info }))
          .catch(() => {});
        break;
      case "cx.error":
        set({ error: f.error });
        break;
      case "cx.log":
        if (!s.log.some((e) => e.id === f.entry.id)) set({ log: [...s.log, f.entry].slice(-200) });
        if (f.entry.role !== "george") set({ saidHere: false });
        break;
      case "task.update": {
        const i = s.tasks.findIndex((t) => t.id === f.task.id);
        const tasks = i >= 0 ? s.tasks.map((t) => (t.id === f.task.id ? f.task : t)) : [f.task, ...s.tasks];
        set({ tasks });
        break;
      }
      case "task.removed":
        set({ tasks: s.tasks.filter((t) => t.id !== f.taskId), openTaskId: s.openTaskId === f.taskId ? null : s.openTaskId });
        break;
      case "ideas.update":
        set({ ideas: f.ideas });
        break;
    }
  },

  say: (text, voice = false) => {
    const t = text.trim();
    if (!t) return;
    speaker.stop();
    speaker.unlock();
    if (!wsClient.send({ type: "cx.say", text: t, voice })) {
      set({ error: "Not connected to the server." });
      return;
    }
    set({ saidHere: true, error: null });
  },

  interrupt: () => {
    speaker.stop();
    wsClient.send({ type: "cx.interrupt" });
  },

  setView: (view) => set({ view }),
  setMobileTab: (mobileTab) => set({ mobileTab }),
  openTask: (openTaskId) => set({ openTaskId }),
  setHandsFree: (handsFree) => set({ handsFree }),
  clearError: () => set({ error: null }),
  setError: (error) => set({ error }),
}));

export const ACTIVE: Task["status"][] = ["queued", "running", "waiting"];
