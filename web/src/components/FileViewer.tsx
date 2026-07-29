import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../state/store";
import { api } from "../lib/api";

const IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

export function FileViewer() {
  const path = useStore((s) => s.viewerPath);
  const openViewer = useStore((s) => s.openViewer);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ext = path?.split(".").pop()?.toLowerCase() ?? "";
  const isImage = IMG_EXT.includes(ext);
  const isPdf = ext === "pdf";
  const url = path ? `/api/files/content?path=${encodeURIComponent(path)}` : "";

  useEffect(() => {
    setText(null);
    setErr(null);
    if (!path || isImage || isPdf) return;
    api
      .fileContent(path)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
        const data = await res.json();
        setText(data.content);
      })
      .catch((e) => setErr(String(e.message ?? e)));
  }, [path, isImage, isPdf]);

  if (!path) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm"
      onClick={() => openViewer(null)}
    >
      <div
        className="flex max-h-[85vh] w-[min(820px,90vw)] flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
          <span className="truncate font-mono text-xs text-fog">{path}</span>
          <button onClick={() => openViewer(null)} className="ml-auto rounded px-2 py-0.5 text-fog hover:bg-panel-2 hover:text-snow">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          {isImage ? (
            <img src={url} alt={path} className="max-w-full rounded-lg" />
          ) : isPdf ? (
            <embed src={url} type="application/pdf" className="h-[70vh] w-full rounded-lg" />
          ) : err ? (
            <div className="text-sm text-red-300">{err}</div>
          ) : text === null ? (
            <div className="thinking-shimmer text-sm">loading…</div>
          ) : ext === "md" || ext === "markdown" ? (
            <div className="prose-chat text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-snow/90">{text}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
