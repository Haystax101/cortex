import { useRef, useState } from "react";
import { useStore } from "../state/store";

export function Composer() {
  const busy = useStore((s) => s.busy);
  const connected = useStore((s) => s.connected);
  const sendMessage = useStore((s) => s.sendMessage);
  const interrupt = useStore((s) => s.interrupt);
  const uploadNotice = useStore((s) => s.uploadNotice);
  const dismissUpload = useStore((s) => s.dismissUpload);

  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const t = text.trim();
    if (!t || busy || !connected) return;
    sendMessage(t);
    setText("");
    if (ref.current) ref.current.style.height = "auto";
  }

  return (
    <div className="border-t border-edge bg-panel/60 px-4 py-3 backdrop-blur">
      {uploadNotice && (
        <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-lg border border-wire/30 bg-wire/10 px-3 py-1.5 text-xs">
          <span>📎</span>
          <span className="truncate text-fog">
            Added <span className="text-snow">{uploadNotice.paths.join(", ")}</span>
          </span>
          <button
            onClick={() => {
              sendMessage(
                `I just uploaded ${uploadNotice.paths.join(", ")}. Read it, summarize it briefly, and file it into my knowledge base.`,
              );
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
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-edge bg-ink px-3 py-2 focus-within:border-pulse/50 focus-within:shadow-[0_0_20px_rgba(139,92,246,0.15)]">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          placeholder={connected ? "Ask your brain anything…" : "Connecting…"}
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
          className="max-h-52 flex-1 resize-none bg-transparent py-1.5 text-[14.5px] outline-none placeholder:text-fog/60"
        />
        {busy ? (
          <button
            onClick={interrupt}
            title="Stop"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-400/40 bg-red-500/15 text-red-300 transition hover:bg-red-500/30"
          >
            ◼
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!text.trim() || !connected}
            title="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pulse text-white shadow-[0_0_16px_rgba(139,92,246,0.5)] transition hover:bg-pulse-soft disabled:opacity-30 disabled:shadow-none"
          >
            ↑
          </button>
        )}
      </div>
      <div className="mx-auto mt-1.5 max-w-3xl text-center text-[10px] text-fog/60">
        Enter to send · Shift+Enter for a new line · files can be dragged anywhere
      </div>
    </div>
  );
}
