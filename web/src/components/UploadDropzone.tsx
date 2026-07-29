import { useEffect, useState } from "react";
import { useStore } from "../state/store";

// Full-window drag-and-drop target; drops land in ~/brain/inbox via the upload API.
export function UploadDropzone() {
  const uploadFiles = useStore((s) => s.uploadFiles);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void uploadFiles(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [uploadFiles]);

  if (!dragging) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-pulse/10 backdrop-blur-[2px]">
      <div className="rounded-2xl border-2 border-dashed border-pulse bg-ink/90 px-10 py-8 text-center shadow-[0_0_60px_rgba(139,92,246,0.4)]">
        <div className="text-4xl">📥</div>
        <div className="mt-2 text-lg font-semibold">Drop to add to your brain</div>
        <div className="mt-1 text-xs text-fog">files land in inbox/ — Cortex can file them for you</div>
      </div>
    </div>
  );
}
