import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIBlock, UIMessage } from "../lib/types";
import { toolIcon } from "../lib/format";

function ToolChip({ block }: { block: Extract<UIBlock, { kind: "tool" }> }) {
  return (
    <div className="my-1.5 flex items-center gap-2 rounded-lg border border-edge bg-panel px-3 py-1.5 font-mono text-xs text-fog">
      <span className="text-sm leading-none">{toolIcon(block.name)}</span>
      <span className="truncate">{block.label}</span>
      {block.running ? (
        <span className="tool-running-dot ml-auto h-2 w-2 shrink-0 rounded-full bg-pulse" />
      ) : block.isError ? (
        <span className="ml-auto shrink-0 text-red-400">✗</span>
      ) : (
        <span className="ml-auto shrink-0 text-emerald-400">✓</span>
      )}
    </div>
  );
}

function ThinkingBlock({ text, live }: { text: string; live?: boolean }) {
  return (
    <details className="my-1.5 rounded-lg border border-edge/60 bg-panel/50 px-3 py-1.5 text-xs text-fog">
      <summary className="cursor-pointer select-none">
        {live ? <span className="thinking-shimmer">thinking…</span> : "thoughts"}
      </summary>
      <div className="mt-1.5 whitespace-pre-wrap border-t border-edge/60 pt-1.5 italic opacity-80">{text}</div>
    </details>
  );
}

export function Blocks({ blocks, streaming }: { blocks: UIBlock[]; streaming?: boolean }) {
  return (
    <>
      {blocks.map((b, i) => {
        const isLast = i === blocks.length - 1;
        if (b.kind === "text") {
          return (
            <div key={i} className="prose-chat text-[14.5px]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{b.text}</ReactMarkdown>
              {streaming && isLast && <span className="stream-caret" />}
            </div>
          );
        }
        if (b.kind === "thinking") return <ThinkingBlock key={i} text={b.text} live={streaming && isLast} />;
        return <ToolChip key={b.toolId} block={b} />;
      })}
      {streaming && (blocks.length === 0 || blocks[blocks.length - 1].kind === "tool") && (
        <div className="my-1 text-xs text-fog">
          <span className="thinking-shimmer">working…</span>
        </div>
      )}
    </>
  );
}

export function MessageBubble({ msg }: { msg: UIMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-md border border-pulse/25 bg-pulse/15 px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap">
          {msg.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("\n")}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-widest text-pulse-soft">
        <span>◉</span> CORTEX
      </div>
      <Blocks blocks={msg.blocks} />
    </div>
  );
}
