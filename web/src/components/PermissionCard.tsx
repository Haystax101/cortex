import type { PermissionAsk } from "../lib/types";
import { useStore } from "../state/store";

export function PermissionCard({ ask }: { ask: PermissionAsk }) {
  const answerAsk = useStore((s) => s.answerAsk);
  const input = (ask.input ?? {}) as Record<string, unknown>;
  const command = typeof input.command === "string" ? input.command : JSON.stringify(input, null, 2);

  return (
    <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3.5">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-amber-300">
        <span>⚠️</span> Cortex wants to run something outward-facing
      </div>
      <div className="mb-2 text-[12px] text-fog">{typeof input.description === "string" ? input.description : ask.label}</div>
      <pre className="mb-3 max-h-40 overflow-auto rounded-lg border border-edge bg-ink px-3 py-2 font-mono text-[12px] text-snow">{command}</pre>
      <div className="flex gap-2">
        <button
          onClick={() => answerAsk(ask.id, true)}
          className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/35"
        >
          Allow
        </button>
        <button
          onClick={() => answerAsk(ask.id, false)}
          className="rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/30"
        >
          Deny
        </button>
        <span className="ml-auto self-center text-[10px] text-fog/70">say “yes” or “no” by voice too</span>
      </div>
    </div>
  );
}
