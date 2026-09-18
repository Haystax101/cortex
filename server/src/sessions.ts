import { query, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { buildOptions, type TurnOptions } from "./agent.js";
import { FAST_MODEL } from "./config.js";
import { getWorkspace, type Workspace } from "./workspaces.js";
import type { ServerFrame } from "./frames.js";

// Long-lived engine sessions. In streaming-input mode the Claude Code process
// stays alive between turns, so a follow-up skips the ~1-3s spawn and reloads
// nothing. One LiveSession per chat; idle sessions are closed after a while.

const IDLE_MS = 15 * 60_000;

type Sink = (f: ServerFrame) => void;

function makeInput() {
  const queue: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const it = (async function* () {
    while (!closed) {
      if (queue.length) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((r) => (wake = r));
      }
    }
  })();
  return {
    it,
    push(m: SDKUserMessage) {
      queue.push(m);
      wake?.();
      wake = null;
    },
    close() {
      closed = true;
      wake?.();
      wake = null;
    },
    get closed() {
      return closed;
    },
  };
}

export class LiveSession {
  readonly q: Query;
  readonly workspace: Workspace;
  readonly abort = new AbortController();
  chatId: string; // "" until the init frame for a brand-new chat
  sink: Sink = () => {}; // whoever sent the latest turn
  busy = false;
  voice = false;
  private input = makeInput();
  private idle: NodeJS.Timeout | null = null;
  private model: string;
  onClose: () => void = () => {};

  constructor(workspace: Workspace, chatId: string | null, opts: TurnOptions) {
    this.workspace = workspace;
    this.chatId = chatId ?? "";
    this.voice = !!opts.voice;
    this.model = opts.model ?? (opts.voice && workspace.id === "brain" ? FAST_MODEL : workspace.model);
    const options = buildOptions(workspace, chatId, {
      ...opts,
      model: this.model,
      ask: (tool: string, label: string, input: unknown) => (this.askImpl ? this.askImpl(tool, label, input) : Promise.resolve(false)),
      hooks: { onSwitchWorkspace: (target: string, reason: string) => this.sink({ type: "workspace.switch", chatId: this.chatId, workspace: target, reason }) },
      abort: this.abort,
    });
    this.q = query({ prompt: this.input.it, options });
  }

  askImpl: ((tool: string, label: string, input: unknown) => Promise<boolean>) | null = null;

  async send(text: string, opts: { voice?: boolean }) {
    this.touch();
    const wantVoice = !!opts.voice;
    const wantModel = wantVoice && this.workspace.id === "brain" ? FAST_MODEL : this.workspace.model;
    if (wantModel !== this.model) {
      try {
        await this.q.setModel(wantModel);
        this.model = wantModel;
      } catch {
        // keep going on the current model
      }
    }
    this.voice = wantVoice;
    const hint = wantVoice
      ? "[Spoken message. Reply will be read aloud: plain sentences, four or five at most unless asked for detail, no markdown, no lists, no code blocks. Ask one question if you need a decision.]\n\n"
      : "";
    this.busy = true;
    this.input.push({
      type: "user",
      message: { role: "user", content: hint + text },
      parent_tool_use_id: null,
    });
  }

  interrupt() {
    this.q.interrupt().catch(() => this.abort.abort());
  }

  touch() {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), IDLE_MS);
  }

  close() {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    if (!this.input.closed) this.input.close();
  }

  get closed() {
    return this.input.closed;
  }
}

const live = new Map<string, LiveSession>(); // chatId → session

export function getLive(chatId: string): LiveSession | undefined {
  const s = live.get(chatId);
  if (s && s.closed) {
    live.delete(chatId);
    return undefined;
  }
  return s;
}

export function register(session: LiveSession) {
  if (session.chatId) live.set(session.chatId, session);
}

export function unregister(session: LiveSession) {
  if (session.chatId && live.get(session.chatId) === session) live.delete(session.chatId);
}

export function openSession(workspaceId: string | null | undefined, chatId: string | null, opts: TurnOptions): LiveSession {
  const ws = getWorkspace(workspaceId);
  const s = new LiveSession(ws, chatId, opts);
  register(s);
  return s;
}

export function liveCount() {
  return live.size;
}
