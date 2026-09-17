import { useEffect, useRef } from "react";
import { useStore, NEW_KEY } from "../state/store";
import { MessageBubble, Blocks } from "./MessageBubble";
import { Composer } from "./Composer";
import { PermissionCard } from "./PermissionCard";

const SUGGESTIONS: Record<string, string[]> = {
  brain: ["What's on today?", "Run my briefing", "Log a GTOD video", "Close the day", "What do you know about me?"],
  default: ["What's the current state of this repo?", "What should I work on next here?", "Run the tests"],
};

export function ChatView() {
  const activeChatId = useStore((s) => s.activeChatId);
  const transcripts = useStore((s) => s.transcripts);
  const streamBlocks = useStore((s) => s.streamBlocks);
  const streamChatId = useStore((s) => s.streamChatId);
  const busy = useStore((s) => s.busy);
  const chats = useStore((s) => s.chats);
  const error = useStore((s) => s.error);
  const clearError = useStore((s) => s.clearError);
  const sendMessage = useStore((s) => s.sendMessage);
  const asks = useStore((s) => s.asks);
  const workspace = useStore((s) => s.workspace);
  const workspaces = useStore((s) => s.workspaces);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const setFilesOpen = useStore((s) => s.setFilesOpen);
  const filesOpen = useStore((s) => s.filesOpen);
  const speak = useStore((s) => s.speak);
  const setSpeak = useStore((s) => s.setSpeak);
  const speaking = useStore((s) => s.speaking);
  const pendingSwitch = useStore((s) => s.pendingSwitch);

  const key = activeChatId ?? NEW_KEY;
  const messages = transcripts[key] ?? [];
  const showStream = streamBlocks !== null && streamChatId === activeChatId;
  const title = chats.find((c) => c.id === activeChatId)?.title;
  const ws = workspaces.find((w) => w.id === workspace);
  const visibleAsks = asks.filter((a) => a.chatId === activeChatId || (!activeChatId && a.chatId === streamChatId));

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  });

  const empty = messages.length === 0 && !showStream;
  const suggestions = SUGGESTIONS[workspace] ?? SUGGESTIONS.default;

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge bg-panel/40 px-3 pt-[env(safe-area-inset-top)] md:px-5">
        <button onClick={() => setSidebarOpen(true)} className="rounded px-1.5 py-1 text-fog hover:text-snow md:hidden" aria-label="Menu">
          ☰
        </button>
        {ws && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-edge px-2 py-0.5 text-[11px] text-fog">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: ws.color }} />
            {ws.name}
          </span>
        )}
        <div className="truncate text-sm font-medium">{title ?? "New chat"}</div>
        {busy && streamChatId === activeChatId && <span className="thinking-shimmer text-xs">responding…</span>}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setSpeak(!speak)}
            title={speak ? "Voice replies on" : "Voice replies off"}
            className={`rounded-lg px-2 py-1 text-sm transition ${speak ? "text-wire" : "text-fog hover:text-snow"} ${speaking ? "animate-pulse" : ""}`}
          >
            {speak ? "🔊" : "🔇"}
          </button>
          <button
            onClick={() => setFilesOpen(!filesOpen)}
            title="Brain files"
            className={`rounded-lg px-2 py-1 text-sm transition lg:hidden ${filesOpen ? "text-pulse-soft" : "text-fog hover:text-snow"}`}
          >
            🗂
          </button>
        </div>
      </header>

      {error && (
        <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-5 py-2 text-xs text-red-300">
          <span className="truncate">{error}</span>
          <button onClick={clearError} className="ml-auto shrink-0 hover:text-snow">
            ✕
          </button>
        </div>
      )}

      {pendingSwitch && (
        <div className="border-b border-wire/30 bg-wire/10 px-5 py-2 text-xs text-wire">
          Switching to <b>{workspaces.find((w) => w.id === pendingSwitch.workspace)?.name ?? pendingSwitch.workspace}</b> when this reply finishes.
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto"
      >
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 px-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-pulse/15 text-4xl shadow-[0_0_40px_rgba(139,92,246,0.35)]">🧠</div>
            <div className="text-center">
              <div className="text-lg font-semibold">{ws && ws.id !== "brain" ? `${ws.name} workspace` : "Your brain is listening"}</div>
              <div className="mt-1 text-sm text-fog">
                {ws && ws.id !== "brain" ? (
                  <>
                    Working in <span className="font-mono text-[12px]">{ws.cwd.replace(/^\/Users\/[^/]+/, "~")}</span> with your brain attached.
                  </>
                ) : (
                  <>
                    It reads and writes <span className="font-mono text-[12px]">~/brain</span>: journal, projects, calendar, memory.
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="rounded-full border border-edge bg-panel px-3.5 py-1.5 text-xs text-fog transition hover:border-pulse/40 hover:text-snow"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-5">
            {messages.map((m) => (
              <MessageBubble key={m.id} msg={m} />
            ))}
            {showStream && (
              <div>
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-pulse-soft">
                  <span>◉</span> CORTEX
                </div>
                <Blocks blocks={streamBlocks} streaming />
              </div>
            )}
            {visibleAsks.map((a) => (
              <PermissionCard key={a.id} ask={a} />
            ))}
          </div>
        )}
      </div>

      <Composer />
    </main>
  );
}
