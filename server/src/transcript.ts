import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { toolLabel } from "./labels.js";

export type UIBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; toolId: string; name: string; label: string; isError?: boolean };

export type UIMessage = {
  id: string;
  role: "user" | "assistant";
  blocks: UIBlock[];
};

type ApiMessage = { role?: string; content?: unknown };
type ContentBlock = Record<string, unknown>;

function isNoiseUserText(text: string): boolean {
  return (
    text.startsWith("Caveat: The messages below") ||
    text.includes("<command-name>") ||
    text.includes("<local-command-stdout>") ||
    text.startsWith("<system-reminder>")
  );
}

// Maps raw session messages to renderable chat messages. Consecutive assistant
// messages (one per agentic turn segment) merge into a single bubble; tool
// results attach error state onto their originating tool block.
export function toTranscript(messages: SessionMessage[]): UIMessage[] {
  const out: UIMessage[] = [];
  const toolBlockById = new Map<string, { kind: "tool"; toolId: string; name: string; label: string; isError?: boolean }>();

  for (const m of messages) {
    if (m.type === "system") continue;
    if (m.parent_tool_use_id || m.parent_agent_id) continue; // subagent internals
    const api = (m.message ?? {}) as ApiMessage;
    const content = api.content;

    if (m.type === "user") {
      const texts: string[] = [];
      if (typeof content === "string") {
        if (!isNoiseUserText(content)) texts.push(content);
      } else if (Array.isArray(content)) {
        for (const b of content as ContentBlock[]) {
          if (b.type === "text" && typeof b.text === "string" && !isNoiseUserText(b.text)) {
            texts.push(b.text);
          } else if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
            const tool = toolBlockById.get(b.tool_use_id);
            if (tool && b.is_error === true) tool.isError = true;
          }
        }
      }
      if (texts.length) {
        out.push({ id: m.uuid, role: "user", blocks: texts.map((t) => ({ kind: "text", text: t })) });
      }
      continue;
    }

    // assistant
    const blocks: UIBlock[] = [];
    if (Array.isArray(content)) {
      for (const b of content as ContentBlock[]) {
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
          blocks.push({ kind: "text", text: b.text });
        } else if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim()) {
          blocks.push({ kind: "thinking", text: b.thinking });
        } else if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
          const tool = { kind: "tool" as const, toolId: b.id, name: b.name, label: toolLabel(b.name, b.input) };
          toolBlockById.set(b.id, tool);
          blocks.push(tool);
        }
      }
    }
    if (!blocks.length) continue;

    const last = out[out.length - 1];
    if (last && last.role === "assistant") {
      last.blocks.push(...blocks);
    } else {
      out.push({ id: m.uuid, role: "assistant", blocks });
    }
  }

  return out;
}
