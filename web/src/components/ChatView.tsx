import { useEffect, useRef } from "react";
import { useStore, NEW_KEY } from "../state/store";
import { MessageBubble, Blocks } from "./MessageBubble";
import { Composer } from "./Composer";

const SUGGESTIONS = [
  "What do you know about me?",
  "Process my inbox",
  "What's in my knowledge base?",
];

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

  const key = activeChatId ?? NEW_KEY;
  const messages = transcripts[key] ?? [];
  const showStream = streamBlocks !== null && streamChatId === activeChatId;
  const title = chats.find((c) => c.id === activeChatId)?.title;

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  });

  const empty = messages.length === 0 && !showStream;

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge bg-panel/40 px-5">
        <div className="truncate text-sm font-medium">{title ?? "New chat"}</div>
        {busy && streamChatId === activeChatId && (
          <span className="thinking-shimmer text-xs">responding…</span>
        )}
      </header>

      {error && (
        <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-5 py-2 text-xs text-red-300">
          <span className="truncate">{error}</span>
          <button onClick={clearError} className="ml-auto shrink-0 hover:text-snow">
            ✕
          </button>
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
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-pulse/15 text-4xl shadow-[0_0_40px_rgba(139,92,246,0.35)]">
              🧠
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold">Your brain is listening</div>
              <div className="mt-1 text-sm text-fog">
                It reads and writes <span className="font-mono text-[12px]">~/brain</span> — knowledge, memory, skills.
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
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
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-6">
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
          </div>
        )}
      </div>

      <Composer />
    </main>
  );
}
