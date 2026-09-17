import { useState } from "react";
import { useStore } from "../state/store";
import { relativeTime } from "../lib/format";

export function Sidebar() {
  const chats = useStore((s) => s.chats);
  const workspaces = useStore((s) => s.workspaces);
  const workspace = useStore((s) => s.workspace);
  const setWorkspace = useStore((s) => s.setWorkspace);
  const activeChatId = useStore((s) => s.activeChatId);
  const busy = useStore((s) => s.busy);
  const connected = useStore((s) => s.connected);
  const selectChat = useStore((s) => s.selectChat);
  const renameChat = useStore((s) => s.renameChat);
  const deleteChat = useStore((s) => s.deleteChat);
  const briefingRunning = useStore((s) => s.briefingRunning);
  const lastBriefing = useStore((s) => s.lastBriefing);
  const runBriefing = useStore((s) => s.runBriefing);
  const openBriefing = useStore((s) => s.openBriefing);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const briefingIsToday = lastBriefing?.date === today;
  const active = workspaces.find((w) => w.id === workspace);

  return (
    <>
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-edge bg-panel transition-transform md:static md:z-auto md:w-64 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pulse/20 text-lg shadow-[0_0_18px_rgba(139,92,246,0.35)]">🧠</div>
          <div>
            <div className="text-sm font-semibold tracking-wide">CORTEX</div>
            <div className="flex items-center gap-1.5 text-[10px] text-fog">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`} />
              {connected ? "connected" : "reconnecting…"}
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="ml-auto text-fog md:hidden" aria-label="Close">
            ✕
          </button>
        </div>

        {/* Briefing */}
        <button
          onClick={() => (briefingIsToday ? openBriefing() : void runBriefing())}
          disabled={briefingRunning || busy}
          className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-wire/30 bg-wire/10 px-3 py-2 text-left text-xs text-wire transition hover:bg-wire/20 disabled:opacity-50"
        >
          <span>☀️</span>
          <span className="flex-1">
            {briefingRunning ? <span className="thinking-shimmer">Preparing briefing…</span> : briefingIsToday ? "Today's briefing" : "Run morning briefing"}
          </span>
          {briefingIsToday && !briefingRunning && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                void runBriefing(true);
              }}
              title="Run again"
              className="rounded px-1 text-[10px] text-wire/70 hover:bg-wire/20"
            >
              ↻
            </span>
          )}
        </button>

        {/* Workspaces */}
        <div className="px-3 pb-2">
          <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-widest text-fog/70">Workspace</div>
          <div className="grid grid-cols-2 gap-1">
            {workspaces.map((w) => {
              const on = w.id === workspace;
              return (
                <button
                  key={w.id}
                  onClick={() => setWorkspace(w.id)}
                  disabled={busy || !w.available}
                  title={w.available ? `${w.blurb}\n${w.cwd}` : `Folder not found: ${w.cwd}`}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-[11.5px] transition disabled:opacity-40 ${
                    on ? "border-transparent text-snow" : "border-edge text-fog hover:text-snow"
                  }`}
                  style={on ? { background: `${w.color}22`, boxShadow: `inset 0 0 0 1px ${w.color}88` } : undefined}
                >
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: w.color }} />
                  <span className="truncate">{w.name}</span>
                </button>
              );
            })}
          </div>
          {active && active.mode === "guarded" && (
            <div className="mt-1.5 px-1 text-[10px] text-fog/70">Code workspace: edits run freely, pushes and deploys ask first.</div>
          )}
        </div>

        <button
          onClick={() => selectChat(null)}
          disabled={busy}
          className="mx-3 mb-3 rounded-lg border border-pulse/40 bg-pulse/10 px-3 py-2 text-sm font-medium text-pulse-soft transition hover:bg-pulse/20 disabled:opacity-40"
        >
          + New chat
        </button>

        <nav className="flex-1 overflow-y-auto px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {chats.map((c) => {
            const isActive = c.id === activeChatId;
            return (
              <div
                key={c.id}
                className={`group relative mb-0.5 rounded-lg transition ${isActive ? "border border-pulse/30 bg-pulse/10" : "border border-transparent hover:bg-panel-2"}`}
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
          {chats.length === 0 && <div className="px-3 py-6 text-center text-xs text-fog">No chats in this workspace yet</div>}
        </nav>
      </aside>
    </>
  );
}
