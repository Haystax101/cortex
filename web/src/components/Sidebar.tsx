import { useState } from "react";
import { useStore } from "../state/store";
import { relativeTime } from "../lib/format";

export function Sidebar() {
  const chats = useStore((s) => s.chats);
  const activeChatId = useStore((s) => s.activeChatId);
  const busy = useStore((s) => s.busy);
  const connected = useStore((s) => s.connected);
  const selectChat = useStore((s) => s.selectChat);
  const renameChat = useStore((s) => s.renameChat);
  const deleteChat = useStore((s) => s.deleteChat);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-edge bg-panel">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pulse/20 text-lg shadow-[0_0_18px_rgba(139,92,246,0.35)]">
          🧠
        </div>
        <div>
          <div className="text-sm font-semibold tracking-wide">CORTEX</div>
          <div className="flex items-center gap-1.5 text-[10px] text-fog">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`} />
            {connected ? "connected" : "reconnecting…"}
          </div>
        </div>
      </div>

      <button
        onClick={() => selectChat(null)}
        disabled={busy}
        className="mx-3 mb-3 rounded-lg border border-pulse/40 bg-pulse/10 px-3 py-2 text-sm font-medium text-pulse-soft transition hover:bg-pulse/20 disabled:opacity-40"
      >
        + New chat
      </button>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {chats.map((c) => {
          const active = c.id === activeChatId;
          return (
            <div
              key={c.id}
              className={`group relative mb-0.5 rounded-lg transition ${
                active ? "border border-pulse/30 bg-pulse/10" : "border border-transparent hover:bg-panel-2"
              }`}
            >
              {editingId === c.id ? (
                <form
                  className="px-2 py-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (editText.trim()) void renameChat(c.id, editText.trim());
                    setEditingId(null);
                  }}
                >
                  <input
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={() => setEditingId(null)}
                    className="w-full rounded border border-pulse/40 bg-ink px-1.5 py-1 text-xs outline-none"
                  />
                </form>
              ) : (
                <button onClick={() => selectChat(c.id)} className="block w-full px-3 py-2 text-left">
                  <div className="truncate pr-10 text-[13px] leading-snug">{c.title}</div>
                  <div className="mt-0.5 text-[10px] text-fog">{relativeTime(c.updatedAt)}</div>
                </button>
              )}

              {editingId !== c.id && (
                <div className="absolute right-1.5 top-1.5 hidden gap-0.5 group-hover:flex">
                  {confirmDeleteId === c.id ? (
                    <button
                      onClick={() => {
                        void deleteChat(c.id);
                        setConfirmDeleteId(null);
                      }}
                      className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-500/40"
                    >
                      sure?
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditingId(c.id);
                          setEditText(c.title);
                        }}
                        title="Rename"
                        className="rounded px-1 py-0.5 text-[11px] text-fog hover:bg-edge hover:text-snow"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => {
                          setConfirmDeleteId(c.id);
                          setTimeout(() => setConfirmDeleteId(null), 2500);
                        }}
                        title="Delete"
                        className="rounded px-1 py-0.5 text-[11px] text-fog hover:bg-edge hover:text-red-300"
                      >
                        🗑
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {chats.length === 0 && <div className="px-3 py-6 text-center text-xs text-fog">No chats yet</div>}
      </nav>
    </aside>
  );
}
