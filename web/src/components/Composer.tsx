import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { Recorder, speaker } from "../lib/speech";
import { api } from "../lib/api";

const YES = /^(yes|yeah|yep|allow|go ahead|do it|approved?|confirm|sure)\b/i;
const NO = /^(no|nope|deny|don't|do not|stop|cancel)\b/i;

export function Composer() {
  const busy = useStore((s) => s.busy);
  const connected = useStore((s) => s.connected);
  const sendMessage = useStore((s) => s.sendMessage);
  const interrupt = useStore((s) => s.interrupt);
  const uploadNotice = useStore((s) => s.uploadNotice);
  const dismissUpload = useStore((s) => s.dismissUpload);
  const listening = useStore((s) => s.listening);
  const setListening = useStore((s) => s.setListening);
  const transcribing = useStore((s) => s.transcribing);
  const setTranscribing = useStore((s) => s.setTranscribing);
  const asks = useStore((s) => s.asks);
  const answerAsk = useStore((s) => s.answerAsk);
  const speaking = useStore((s) => s.speaking);

  const [text, setText] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<Recorder | null>(null);
  const pressRef = useRef(false);

  function submit(t = text, voice = false) {
    const v = t.trim();
    if (!v || !connected) return;
    // A pending permission prompt can be answered by voice.
    const ask = asks[0];
    if (ask && voice) {
      if (YES.test(v)) return answerAsk(ask.id, true);
      if (NO.test(v)) return answerAsk(ask.id, false);
    }
    if (busy) return;
    sendMessage(v, { voice });
    setText("");
    if (ref.current) ref.current.style.height = "auto";
  }

  async function startListening() {
    if (listening || transcribing) return;
    setMicError(null);
    speaker.stop();
    speaker.unlock();
    try {
      const r = new Recorder();
      await r.start();
      recRef.current = r;
      setListening(true);
    } catch (e) {
      setMicError(`Microphone unavailable: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function stopListening() {
    const r = recRef.current;
    if (!r) return;
    recRef.current = null;
    setListening(false);
    const blob = await r.stop();
    if (!blob) return;
    setTranscribing(true);
    try {
      const { text: heard } = await api.stt(blob);
      if (heard.trim()) submit(heard, true);
    } catch (e) {
      setMicError(`Transcription failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setTranscribing(false);
    }
  }

  // Hold Space (when not typing) or Right Option to talk, like the desk client.
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      const hot = e.code === "AltRight" || (e.code === "Space" && !isTyping());
      if (!hot || e.repeat || pressRef.current) return;
      pressRef.current = true;
      e.preventDefault();
      void startListening();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "AltRight" && e.code !== "Space") return;
      if (!pressRef.current) return;
      pressRef.current = false;
      e.preventDefault();
      void stopListening();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, transcribing, busy, connected, asks]);

  const micLabel = listening ? "Listening… release to send" : transcribing ? "Transcribing…" : "Hold to talk";

  return (
    <div className="border-t border-edge bg-panel/60 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:px-4">
      {uploadNotice && (
        <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-lg border border-wire/30 bg-wire/10 px-3 py-1.5 text-xs">
          <span>📎</span>
          <span className="truncate text-fog">
            Added <span className="text-snow">{uploadNotice.paths.join(", ")}</span>
          </span>
          <button
            onClick={() => {
              sendMessage(`I just uploaded ${uploadNotice.paths.join(", ")}. Read it, summarize it briefly, and file it into my knowledge base.`);
              dismissUpload();
            }}
            disabled={busy}
            className="ml-auto shrink-0 rounded border border-wire/40 px-2 py-0.5 text-wire hover:bg-wire/20 disabled:opacity-40"
          >
            Ask Cortex
          </button>
          <button onClick={dismissUpload} className="shrink-0 px-1 text-fog hover:text-snow">
            ✕
          </button>
        </div>
      )}
      {micError && (
        <div className="mx-auto mb-2 max-w-3xl rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
          {micError}
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-edge bg-ink px-3 py-2 focus-within:border-pulse/50 focus-within:shadow-[0_0_20px_rgba(139,92,246,0.15)]">
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            void startListening();
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            void stopListening();
          }}
          onPointerCancel={() => void stopListening()}
          onPointerLeave={() => listening && void stopListening()}
          onContextMenu={(e) => e.preventDefault()}
          disabled={!connected || transcribing}
          title={micLabel}
          aria-label={micLabel}
          className={`flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-xl border text-base transition touch-none ${
            listening
              ? "border-red-400/60 bg-red-500/25 text-red-200 shadow-[0_0_18px_rgba(248,113,113,0.5)]"
              : transcribing
                ? "border-wire/40 bg-wire/10 text-wire animate-pulse"
                : "border-edge bg-panel text-fog hover:border-pulse/40 hover:text-snow"
          } disabled:opacity-40`}
        >
          {listening ? "●" : transcribing ? "…" : "🎙"}
        </button>
        <textarea
          ref={ref}
          value={text}
          rows={1}
          placeholder={connected ? (listening ? "Listening…" : "Ask your brain anything…") : "Connecting…"}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-52 flex-1 resize-none bg-transparent py-1.5 text-[16px] outline-none placeholder:text-fog/60 md:text-[14.5px]"
        />
        {busy || speaking ? (
          <button
            onClick={interrupt}
            title="Stop"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-400/40 bg-red-500/15 text-red-300 transition hover:bg-red-500/30"
          >
            ◼
          </button>
        ) : (
          <button
            onClick={() => submit()}
            disabled={!text.trim() || !connected}
            title="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pulse text-white shadow-[0_0_16px_rgba(139,92,246,0.5)] transition hover:bg-pulse-soft disabled:opacity-30 disabled:shadow-none"
          >
            ↑
          </button>
        )}
      </div>
      <div className="mx-auto mt-1.5 hidden max-w-3xl text-center text-[10px] text-fog/60 md:block">
        Enter to send · hold the mic, Space or Right Option to talk · files can be dragged anywhere
      </div>
    </div>
  );
}
