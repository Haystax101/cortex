import { useRef, useState } from "react";
import type { TreeNode } from "../lib/types";
import { useStore } from "../state/store";
import { fileIcon } from "../lib/format";

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth === 0);
  const openViewer = useStore((s) => s.openViewer);

  if (node.type === "dir") {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12.5px] text-fog transition hover:bg-panel-2 hover:text-snow"
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <span className={`inline-block text-[9px] transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
          <span>📁</span>
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {open && node.children?.map((c) => <Node key={c.path} node={c} depth={depth + 1} />)}
      </div>
    );
  }
  return (
    <button
      onClick={() => openViewer(node.path)}
      className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12.5px] text-fog transition hover:bg-panel-2 hover:text-snow"
      style={{ paddingLeft: 22 + depth * 14 }}
    >
      <span>{fileIcon(node.name)}</span>
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function FileBrowser() {
  const tree = useStore((s) => s.tree);
  const refreshTree = useStore((s) => s.refreshTree);
  const uploadFiles = useStore((s) => s.uploadFiles);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-edge bg-panel">
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="text-xs font-semibold tracking-widest text-fog">BRAIN FILES</div>
        <div className="flex gap-1">
          <button
            onClick={() => inputRef.current?.click()}
            title="Upload to inbox"
            className="rounded px-1.5 py-0.5 text-xs text-fog hover:bg-panel-2 hover:text-snow"
          >
            ＋
          </button>
          <button
            onClick={() => void refreshTree()}
            title="Refresh"
            className="rounded px-1.5 py-0.5 text-xs text-fog hover:bg-panel-2 hover:text-snow"
          >
            ⟳
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void uploadFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {tree.map((n) => (
          <Node key={n.path} node={n} depth={0} />
        ))}
      </div>
      <div className="border-t border-edge px-4 py-2.5 text-[10px] leading-relaxed text-fog/70">
        ~/brain · drag files anywhere to add to inbox
      </div>
    </aside>
  );
}
