import { useState } from "react";
import { ACTIVE, useCortex } from "../state/cortex";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import type { Task, Workspace } from "../lib/types";

// The board: what needs George, what's running per project, recent results
// and captured ideas. Everything here can also be done by voice.

const STATUS: Record<Task["status"], { dot: string; label: string }> = {
  queued: { dot: "bg-fog", label: "queued" },
  running: { dot: "bg-pulse animate-pulse", label: "working" },
  waiting: { dot: "bg-amber-400", label: "question" },
  done: { dot: "bg-emerald-400", label: "done" },
  failed: { dot: "bg-red-400", label: "failed" },
  stopped: { dot: "bg-fog/50", label: "stopped" },
};

function elapsed(t: Task) {
  const end = t.status === "running" || t.status === "queued" ? Date.now() : (t.finishedAt ?? t.updatedAt);
  const m = Math.max(0, Math.round((end - (t.startedAt ?? t.createdAt)) / 60_000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
}

export function Board() {
  const tasks = useCortex((s) => s.tasks);
  const ideas = useCortex((s) => s.ideas);
  const workspaces = useStore((s) => s.workspaces);

  const needs = tasks.filter((t) => t.approvals.length || t.status === "waiting");
  const active = tasks.filter((t) => ACTIVE.includes(t.status) && !needs.includes(t));
  const recent = tasks.filter((t) => !ACTIVE.includes(t.status)).slice(0, 12);
  const byProject = new Map<string, Task[]>();
  for (const t of active) byProject.set(t.project, [...(byProject.get(t.project) ?? []), t]);
  const ws = (id: string) => workspaces.find((w) => w.id === id);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-5">
      {needs.length > 0 && (
        <Section title="Needs you" accent="text-amber-300">
          <div className="flex flex-col gap-2">
            {needs.map((t) => (
              <NeedsCard key={t.id} task={t} ws={ws(t.project)} />
            ))}
          </div>
        </Section>
      )}

      <Section title={`Working (${active.length})`}>
        {active.length === 0 ? (
          <Empty>Nothing running. Ask Cortex to start something.</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {[...byProject.entries()].map(([project, list]) => (
              <div key={project} className="rounded-xl border border-edge bg-panel/50 p-2.5">
                <ProjectChip ws={ws(project)} id={project} />
                <div className="mt-2 flex flex-col gap-1.5">
                  {list.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Recent">
        {recent.length === 0 ? (
          <Empty>Finished work shows up here with a spoken summary.</Empty>
        ) : (
          <div className="flex flex-col gap-1.5">
            {recent.map((t) => (
              <TaskRow key={t.id} task={t} showProject ws={ws(t.project)} />
            ))}
          </div>
        )}
      </Section>

      <Section title={`Ideas (${ideas.length})`}>
        {ideas.length === 0 ? (
          <Empty>Ideas you float while brainstorming get captured here.</Empty>
        ) : (
          <div className="flex flex-col gap-1.5">
            {ideas.slice(0, 30).map((i) => (
              <IdeaRow key={i.id} idea={i} workspaces={workspaces} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className={`mb-2 text-[10px] font-semibold uppercase tracking-widest ${accent ?? "text-fog/80"}`}>{title}</div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-edge px-4 py-5 text-center text-xs text-fog">{children}</div>;
}

function ProjectChip({ ws, id }: { ws?: Workspace; id: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-fog">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: ws?.color ?? "#8b93a7" }} />
      {ws?.name ?? id}
    </span>
  );
}

function TaskRow({ task: t, showProject, ws }: { task: Task; showProject?: boolean; ws?: Workspace }) {
  const openTask = useCortex((s) => s.openTask);
  const st = STATUS[t.status];
  return (
    <button onClick={() => openTask(t.id)} className="flex w-full items-start gap-2.5 rounded-lg border border-edge bg-panel px-3 py-2 text-left transition hover:border-pulse/40">
      <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-snow">{t.title}</span>
          {t.where === "cloud" && <span className="rounded bg-wire/15 px-1 text-[9.5px] text-wire">cloud</span>}
          {t.model.includes("sonnet") && <span className="rounded bg-edge px-1 text-[9.5px] text-fog">sonnet</span>}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-fog">
          {showProject && <ProjectChip ws={ws} id={t.project} />} {t.status === "done" || t.status === "failed" ? (t.summary ?? t.error ?? t.activity) : t.activity}
        </span>
      </span>
      <span className="shrink-0 text-[10.5px] text-fog">{ACTIVE.includes(t.status) ? elapsed(t) : relativeTime(t.updatedAt)}</span>
    </button>
  );
}

function NeedsCard({ task: t, ws }: { task: Task; ws?: Workspace }) {
  const answerAsk = useStore((s) => s.answerAsk);
  const openTask = useCortex((s) => s.openTask);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  return (
    <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3">
      <div className="mb-1 flex items-center gap-2">
        <ProjectChip ws={ws} id={t.project} />
        <button onClick={() => openTask(t.id)} className="truncate text-[13px] font-medium text-snow hover:underline">
          {t.title}
        </button>
      </div>
      {t.approvals.map((a) => (
        <div key={a.id} className="mt-2">
          <div className="text-[12px] text-amber-200">Wants to run:</div>
          <pre className="my-1.5 max-h-28 overflow-auto rounded-lg border border-edge bg-ink px-2.5 py-1.5 font-mono text-[11.5px] text-snow">{a.command ?? a.label}</pre>
          <div className="flex gap-2">
            <button onClick={() => answerAsk(a.id, true)} className="rounded-lg bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/35">
              Allow
            </button>
            <button onClick={() => answerAsk(a.id, false)} className="rounded-lg bg-red-500/15 px-3 py-1 text-xs font-medium text-red-300 hover:bg-red-500/30">
              Deny
            </button>
          </div>
        </div>
      ))}
      {t.status === "waiting" && t.question && (
        <form
          className="mt-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reply.trim()) return;
            setSending(true);
            void api.messageTask(t.id, reply.trim()).finally(() => {
              setSending(false);
              setReply("");
            });
          }}
        >
          <div className="text-[13px] leading-relaxed text-snow">{t.question}</div>
          <div className="mt-2 flex gap-2">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Answer (or just tell Cortex)"
              className="min-w-0 flex-1 rounded-lg border border-edge bg-ink px-2.5 py-1.5 text-[16px] outline-none focus:border-amber-400/60 md:text-xs"
            />
            <button disabled={sending || !reply.trim()} className="rounded-lg bg-amber-500/25 px-3 text-xs font-medium text-amber-100 disabled:opacity-40">
              Send
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function IdeaRow({ idea, workspaces }: { idea: import("../lib/types").Idea; workspaces: Workspace[] }) {
  const tasks = useCortex((s) => s.tasks);
  const setError = useCortex((s) => s.setError);
  const [project, setProject] = useState(idea.project ?? "");
  const [open, setOpen] = useState(false);
  const linked = idea.taskId ? tasks.find((t) => t.id === idea.taskId) : undefined;
  return (
    <div className="rounded-lg border border-edge bg-panel px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-sm">💡</span>
        <div className="min-w-0 flex-1 text-[13px] leading-snug text-snow">{idea.text}</div>
        {linked ? (
          <span className="shrink-0 text-[10.5px] text-fog">{STATUS[linked.status].label}</span>
        ) : (
          <>
            <button onClick={() => setOpen(!open)} className="shrink-0 rounded px-1.5 text-[11px] text-pulse-soft hover:bg-pulse/15">
              Build
            </button>
            <button onClick={() => void api.deleteIdea(idea.id)} className="shrink-0 rounded px-1 text-[11px] text-fog hover:text-red-300" title="Delete">
              ✕
            </button>
          </>
        )}
      </div>
      {open && !linked && (
        <div className="mt-2 flex gap-2">
          <select value={project} onChange={(e) => setProject(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-edge bg-ink px-2 py-1 text-xs">
            <option value="">Project…</option>
            {workspaces
              .filter((w) => w.available)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </select>
          <button
            disabled={!project}
            onClick={() => {
              void api
                .createTask({ project, title: idea.text.slice(0, 50), brief: `George captured this idea while brainstorming and wants it built:\n\n${idea.text}`, ideaId: idea.id })
                .then(() => setOpen(false))
                .catch((e: Error) => setError(e.message));
            }}
            className="rounded-lg bg-pulse/25 px-3 text-xs font-medium text-snow disabled:opacity-40"
          >
            Start
          </button>
        </div>
      )}
      <div className="mt-1 text-[10px] text-fog/70">{relativeTime(idea.createdAt)}</div>
    </div>
  );
}
