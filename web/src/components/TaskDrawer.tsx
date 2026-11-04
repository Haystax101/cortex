import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ACTIVE, useCortex } from "../state/cortex";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { MessageBubble } from "./MessageBubble";
import type { UIMessage } from "../lib/types";

// Detail panel for one task: what it's doing, what it came back with, the full
// transcript, and the actions (message, stop, merge, discard).

export function TaskDrawer() {
  const id = useCortex((s) => s.openTaskId);
  const openTask = useCortex((s) => s.openTask);
  const task = useCortex((s) => s.tasks.find((t) => t.id === s.openTaskId));
  const workspaces = useStore((s) => s.workspaces);
  const [msg, setMsg] = useState("");
  const [transcript, setTranscript] = useState<UIMessage[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"merge" | "discard" | null>(null);

  useEffect(() => {
    setTranscript(null);
    setNote(null);
    setConfirm(null);
  }, [id]);

  if (!id || !task) return null;
  const ws = workspaces.find((w) => w.id === task.project);
  const active = ACTIVE.includes(task.status);

  const act = (a: "stop" | "done" | "merge" | "discard") =>
    api
      .taskAction(task.id, a)
      .then((r) => setNote("message" in r ? r.message : null))
      .catch((e: Error) => setNote(e.message))
      .finally(() => setConfirm(null));

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={() => openTask(null)} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-edge bg-panel shadow-2xl">
        <header className="flex items-start gap-3 border-b border-edge px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] text-fog">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: ws?.color ?? "#8b93a7" }} />
              {ws?.name ?? task.project} · {task.status} · {task.model.replace(/^claude-/, "")}
              {task.where === "cloud" && " · cloud"}
            </div>
            <div className="mt-0.5 text-[15px] font-semibold leading-snug">{task.title}</div>
          </div>
          <button onClick={() => openTask(null)} className="text-fog hover:text-snow">
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 text-[13px]">
          {note && <div className="mb-3 rounded-lg border border-wire/30 bg-wire/10 px-3 py-2 text-xs text-wire">{note}</div>}

          {task.cloudUrl && (
            <a href={task.cloudUrl} target="_blank" rel="noreferrer" className="mb-3 block rounded-lg border border-wire/40 bg-wire/10 px-3 py-2 text-xs text-wire hover:bg-wire/20">
              Open the cloud session ↗
            </a>
          )}

          {task.question && task.status === "waiting" && (
            <div className="mb-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-amber-100">{task.question}</div>
          )}

          {task.summary && (
            <Field label="Summary">
              <div className="leading-relaxed text-snow">{task.summary}</div>
            </Field>
          )}

          {task.branch && (
            <Field label="Branch">
              <div className="font-mono text-[12px] text-snow">{task.branch}</div>
              <div className="text-[11.5px] text-fog">
                from {task.baseRef} · {task.commits ?? 0} commits{task.diffStat ? ` · ${task.diffStat}` : ""}
              </div>
            </Field>
          )}

          <Field label="Brief">
            <div className="whitespace-pre-wrap text-fog">{task.brief}</div>
          </Field>

          <Field label="Activity">
            <div className="flex flex-col gap-0.5 font-mono text-[11.5px] text-fog">
              {task.log.length === 0 && <span>{task.activity}</span>}
              {task.log.map((l, i) => (
                <span key={i} className="truncate">
                  <span className="text-fog/50">{new Date(l.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> {l.text}
                </span>
              ))}
            </div>
          </Field>

          {task.result && (
            <Field label="Report">
              <div className="prose-chat text-snow">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.result}</ReactMarkdown>
              </div>
            </Field>
          )}

          {task.error && <Field label="Error"><div className="text-red-300">{task.error}</div></Field>}

          {task.chatId && (
            <Field label="Transcript">
              {transcript ? (
                <div className="flex flex-col gap-4">
                  {transcript.map((m) => (
                    <MessageBubble key={m.id} msg={m} />
                  ))}
                </div>
              ) : (
                <button
                  onClick={() => void api.taskMessages(task.id).then((r) => setTranscript(r.messages)).catch((e: Error) => setNote(e.message))}
                  className="rounded-lg border border-edge px-3 py-1.5 text-xs text-fog hover:text-snow"
                >
                  Load full transcript
                </button>
              )}
            </Field>
          )}
          <div className="mt-2 text-[10.5px] text-fog/70">
            {task.turns} engine turns{task.costUsd ? ` · ~$${task.costUsd.toFixed(2)} equivalent (covered by your plan)` : ""} · {task.cwd}
          </div>
        </div>

        <footer className="border-t border-edge px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {task.where === "local" && (
            <form
              className="mb-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!msg.trim()) return;
                void api
                  .messageTask(task.id, msg.trim())
                  .then(() => setMsg(""))
                  .catch((er: Error) => setNote(er.message));
              }}
            >
              <input
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                placeholder={active ? "Steer this worker…" : "Follow up (resumes the session)…"}
                className="min-w-0 flex-1 rounded-lg border border-edge bg-ink px-3 py-1.5 text-[16px] outline-none focus:border-pulse/50 md:text-xs"
              />
              <button disabled={!msg.trim()} className="rounded-lg bg-pulse px-3 text-xs font-medium text-white disabled:opacity-30">
                Send
              </button>
            </form>
          )}
          <div className="flex flex-wrap gap-2">
            {active && <Btn onClick={() => void act("stop")}>Stop</Btn>}
            {!active && task.status !== "done" && <Btn onClick={() => void act("done")}>Mark done</Btn>}
            {task.branch && !active && (
              confirm === "merge" ? (
                <Btn tone="green" onClick={() => void act("merge")}>Confirm merge into {task.baseRef}</Btn>
              ) : (
                <Btn tone="green" onClick={() => setConfirm("merge")}>Merge…</Btn>
              )
            )}
            {confirm === "discard" ? (
              <Btn tone="red" onClick={() => void act("discard")}>Confirm: delete branch & worktree</Btn>
            ) : (
              <Btn tone="red" onClick={() => setConfirm("discard")}>Discard…</Btn>
            )}
          </div>
        </footer>
      </aside>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-fog/70">{label}</div>
      {children}
    </div>
  );
}

function Btn({ children, onClick, tone }: { children: React.ReactNode; onClick: () => void; tone?: "green" | "red" }) {
  const c =
    tone === "green"
      ? "border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/15"
      : tone === "red"
        ? "border-red-400/30 text-red-300 hover:bg-red-500/15"
        : "border-edge text-fog hover:text-snow";
  return (
    <button onClick={onClick} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${c}`}>
      {children}
    </button>
  );
}
