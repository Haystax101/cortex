import { useEffect, useRef, useState } from "react";
import { useCortex } from "../state/cortex";
import { useStore } from "../state/store";
import { Recorder, speaker } from "../lib/speech";
import { HandsFree } from "../lib/vad";
import { api } from "../lib/api";
import { Board } from "./Board";
import { TaskDrawer } from "./TaskDrawer";

// The conductor home screen: talk on the left, the board on the right
// (tabs on a phone). Hold the mic to talk, or switch on hands-free and just
// speak; talking over Cortex cuts it off.

const YES = /^(yes|yeah|yep|allow|go ahead|do it|approved?|confirm|sure)\b/i;

export function CortexView() {
  const mobileTab = useCortex((s) => s.mobileTab);
  const setMobileTab = useCortex((s) => s.setMobileTab);
  const tasks = useCortex((s) => s.tasks);
  const needsYou = tasks.filter((t) => t.status === "waiting" || t.approvals.length).length;

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      <Header />
      <div className="flex border-b border-edge lg:hidden">
        {(["talk", "board"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setMobileTab(t)}
            className={`flex-1 py-2 text-xs font-medium uppercase tracking-widest ${mobileTab === t ? "border-b-2 border-pulse text-snow" : "text-fog"}`}
          >
            {t}
            {t === "board" && needsYou > 0 && <span className="ml-1.5 rounded-full bg-amber-500/30 px-1.5 text-amber-200">{needsYou}</span>}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <section className={`min-w-0 flex-1 flex-col lg:flex lg:max-w-[560px] lg:border-r lg:border-edge ${mobileTab === "talk" ? "flex" : "hidden"}`}>
          <Conversation />
          <TalkBar />
        </section>
        <section className={`min-w-0 flex-1 overflow-y-auto lg:block ${mobileTab === "board" ? "block" : "hidden"}`}>
          <Board />
        </section>
      </div>
      <TaskDrawer />
    </main>
  );
}

function Header() {
  const info = useCortex((s) => s.info);
  const busy = useCortex((s) => s.busy);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const speak = useStore((s) => s.speak);
  const setSpeak = useStore((s) => s.setSpeak);
  const speaking = useStore((s) => s.speaking);
  const connected = useStore((s) => s.connected);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge bg-panel/40 px-3 pt-[env(safe-area-inset-top)] md:px-5">
      <button onClick={() => setSidebarOpen(true)} className="rounded px-1.5 py-1 text-fog hover:text-snow md:hidden" aria-label="Menu">
        ☰
      </button>
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${busy ? "animate-pulse bg-pulse" : connected ? "bg-emerald-400" : "bg-red-400"}`} />
      <div className="text-sm font-semibold tracking-wide">Cortex</div>
      {info && (
        <div className="hidden truncate text-[11px] text-fog sm:block">
          {info.configured ? (
            <>
              {info.model} · ${info.usage.usd.toFixed(2)} this month
            </>
          ) : (
            <span className="text-amber-300">no API key yet</span>
          )}
        </div>
      )}
      <div className="ml-auto">
        <button
          onClick={() => setSpeak(!speak)}
          title={speak ? "Voice replies on" : "Voice replies off"}
          className={`rounded-lg px-2 py-1 text-sm transition ${speak ? "text-wire" : "text-fog hover:text-snow"} ${speaking ? "animate-pulse" : ""}`}
        >
          {speak ? "🔊" : "🔇"}
        </button>
      </div>
    </header>
  );
}

function Conversation() {
  const log = useCortex((s) => s.log);
  const draft = useCortex((s) => s.draft);
  const info = useCortex((s) => s.info);
  const error = useCortex((s) => s.error);
  const clearError = useCortex((s) => s.clearError);
  const say = useCortex((s) => s.say);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length, draft?.text]);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto px-4 py-5">
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="hover:text-snow">
            ✕
          </button>
        </div>
      )}
      {info && !info.configured && (
        <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
          The conductor needs an Anthropic API key (it uses your monthly API credits, workers stay on your subscription). Save it on the Mac:
          <pre className="mt-2 overflow-x-auto rounded bg-ink px-2 py-1.5 font-mono text-[11px] text-snow">{`pbpaste > ${info.keyFile} && chmod 600 ${info.keyFile}`}</pre>
          then restart Cortex.
        </div>
      )}
      {log.length === 0 && !draft && (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-pulse/15 text-4xl shadow-[0_0_40px_rgba(139,92,246,0.35)]">🧠</div>
          <div className="max-w-xs text-sm text-fog">Talk to Cortex. It brainstorms with you and hands real work to background agents on the board.</div>
          <div className="flex flex-wrap justify-center gap-2">
            {["What's on today?", "What's everyone working on?", "Let's brainstorm"].map((s) => (
              <button key={s} onClick={() => say(s)} className="rounded-full border border-edge bg-panel px-3 py-1.5 text-xs text-fog hover:border-pulse/40 hover:text-snow">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3">
        {log.map((e) => (
          <Line key={e.id} role={e.role} text={e.text} tools={e.tools} />
        ))}
        {draft && <Line role={draft.source === "update" ? "update" : "cortex"} text={draft.text} tools={draft.tools} live />}
      </div>
    </div>
  );
}

function Line({ role, text, tools, live }: { role: "george" | "cortex" | "update"; text: string; tools?: string[]; live?: boolean }) {
  if (role === "george") {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-pulse/20 px-3.5 py-2 text-[14.5px] leading-relaxed text-snow">{text.replace(/^\[typed\]\s*/, "")}</div>
    );
  }
  return (
    <div className={`max-w-[92%] ${role === "update" ? "border-l-2 border-wire/50 pl-3" : ""}`}>
      {role === "update" && <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-wire/80">update</div>}
      {!!tools?.length && (
        <div className="mb-1 flex flex-wrap gap-1">
          {tools.map((t, i) => (
            <span key={i} className="rounded-full border border-edge px-2 py-0.5 text-[10.5px] text-fog">
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="text-[14.5px] leading-relaxed text-snow">
        {text || (live ? <span className="thinking-shimmer text-fog">…</span> : null)}
      </div>
    </div>
  );
}

function TalkBar() {
  const say = useCortex((s) => s.say);
  const interrupt = useCortex((s) => s.interrupt);
  const busy = useCortex((s) => s.busy);
  const handsFree = useCortex((s) => s.handsFree);
  const setHandsFree = useCortex((s) => s.setHandsFree);
  const setError = useCortex((s) => s.setError);
  const tasks = useCortex((s) => s.tasks);
  const connected = useStore((s) => s.connected);
  const speaking = useStore((s) => s.speaking);
  const answerAsk = useStore((s) => s.answerAsk);

  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [level, setLevel] = useState(0);
  const recRef = useRef<Recorder | null>(null);
  const hfRef = useRef<HandsFree | null>(null);
  const pressRef = useRef(false);

  async function send(blob: Blob) {
    setTranscribing(true);
    try {
      const { text: heard } = await api.stt(blob);
      const t = heard.trim();
      if (!t || /^\[.*\]$|^\(.*\)$/.test(t)) return; // whisper's "[BLANK_AUDIO]" and friends
      // A bare "yes" while exactly one approval is pending answers it directly.
      const pending = tasks.flatMap((x) => x.approvals);
      if (pending.length === 1 && YES.test(t) && t.split(/\s+/).length <= 4) {
        answerAsk(pending[0].id, true);
        return;
      }
      say(t, true);
    } catch (e) {
      setError(`Transcription failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setTranscribing(false);
    }
  }

  async function startPtt() {
    if (recRef.current) return;
    speaker.stop();
    speaker.unlock();
    if (busy) interrupt();
    hfRef.current?.setPaused(true);
    try {
      const r = new Recorder();
      await r.start();
      recRef.current = r;
      setListening(true);
    } catch (e) {
      setError(`Microphone unavailable: ${e instanceof Error ? e.message : e}`);
      hfRef.current?.setPaused(false);
    }
  }

  async function stopPtt() {
    const r = recRef.current;
    if (!r) return;
    recRef.current = null;
    setListening(false);
    const blob = await r.stop();
    hfRef.current?.setPaused(false);
    if (blob) await send(blob);
  }

  async function toggleHandsFree() {
    if (hfRef.current?.running) {
      hfRef.current.stop();
      hfRef.current = null;
      setHandsFree(false);
      setLevel(0);
      return;
    }
    speaker.unlock();
    const hf = new HandsFree({
      isPlaybackActive: () => speaker.isSpeaking(),
      onSpeechStart: () => {
        // Barge-in: George started talking, so Cortex stops.
        if (speaker.isSpeaking() || useCortex.getState().busy) interrupt();
        setListening(true);
      },
      onUtterance: (wav) => {
        setListening(false);
        void send(wav);
      },
      onLevel: (l) => setLevel(l),
    });
    try {
      await hf.start();
      hfRef.current = hf;
      setHandsFree(true);
    } catch (e) {
      setError(`Microphone unavailable: ${e instanceof Error ? e.message : e}`);
    }
  }

  useEffect(() => () => hfRef.current?.stop(), []);

  // Hold Space (when not typing) or Right Option to talk.
  useEffect(() => {
    const typing = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      const hot = e.code === "AltRight" || (e.code === "Space" && !typing());
      if (!hot || e.repeat || pressRef.current) return;
      pressRef.current = true;
      e.preventDefault();
      void startPtt();
    };
    const up = (e: KeyboardEvent) => {
      if ((e.code !== "AltRight" && e.code !== "Space") || !pressRef.current) return;
      pressRef.current = false;
      e.preventDefault();
      void stopPtt();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  function submit() {
    if (!text.trim()) return;
    say(text, false);
    setText("");
  }

  const status = listening ? "Listening…" : transcribing ? "Transcribing…" : speaking ? "Speaking" : busy ? "Thinking…" : handsFree ? "Hands-free: just talk" : "Hold to talk";

  return (
    <div className="border-t border-edge bg-panel/60 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mb-3 flex items-center justify-center gap-4">
        <button
          onClick={() => void toggleHandsFree()}
          title="Hands-free: Cortex listens continuously and you can talk over it"
          className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
            handsFree ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200" : "border-edge text-fog hover:text-snow"
          }`}
        >
          {handsFree ? "● Hands-free on" : "Hands-free"}
        </button>
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            void startPtt();
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            void stopPtt();
          }}
          onPointerCancel={() => void stopPtt()}
          onPointerLeave={() => listening && !handsFree && void stopPtt()}
          onContextMenu={(e) => e.preventDefault()}
          disabled={!connected}
          aria-label={status}
          className={`relative flex h-16 w-16 select-none items-center justify-center rounded-full border text-2xl transition touch-none disabled:opacity-40 ${
            listening
              ? "border-red-400/70 bg-red-500/25 text-red-100 shadow-[0_0_30px_rgba(248,113,113,0.55)]"
              : transcribing
                ? "animate-pulse border-wire/50 bg-wire/15 text-wire"
                : "border-pulse/50 bg-pulse/15 text-snow shadow-[0_0_24px_rgba(139,92,246,0.35)] hover:bg-pulse/25"
          }`}
          style={handsFree && !listening ? { boxShadow: `0 0 ${8 + level * 30}px rgba(52,211,153,${0.25 + level * 0.5})` } : undefined}
        >
          🎙
        </button>
        <button
          onClick={interrupt}
          disabled={!busy && !speaking}
          className="rounded-full border border-edge px-3 py-1.5 text-[11px] font-medium text-fog transition hover:border-red-400/50 hover:text-red-300 disabled:opacity-30"
        >
          ◼ Stop
        </button>
      </div>
      <div className="mb-2 text-center text-[11px] text-fog">{status}</div>
      <div className="flex items-end gap-2 rounded-2xl border border-edge bg-ink px-3 py-2 focus-within:border-pulse/50">
        <textarea
          value={text}
          rows={1}
          placeholder={connected ? "Or type to Cortex…" : "Connecting…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-40 flex-1 resize-none bg-transparent py-1 text-[16px] outline-none placeholder:text-fog/60 md:text-[14px]"
        />
        <button
          onClick={submit}
          disabled={!text.trim() || !connected}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-pulse text-white transition hover:bg-pulse-soft disabled:opacity-30"
        >
          ↑
        </button>
      </div>
    </div>
  );
}
