import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { BRAIN_DIR, DEFAULT_MODEL } from "./config.js";

export type Run = { q: Query; abort: AbortController };

// The single place query() is called — cwd must always be BRAIN_DIR or resume breaks.
export function runTurn(text: string, chatId: string | null): Run {
  const abort = new AbortController();
  const q = query({
    prompt: text,
    options: {
      cwd: BRAIN_DIR,
      ...(chatId ? { resume: chatId } : {}),
      model: DEFAULT_MODEL,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append:
          "You are Cortex, George's personal AI brain, accessed through a web chat interface. " +
          "Follow the conventions in CLAUDE.md. Keep responses conversational and readable — " +
          "this is a chat, not a terminal.",
      },
      settingSources: ["project"],
      skills: "all",
      allowedTools: [
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "WebSearch",
        "WebFetch",
        "Bash",
        "TodoWrite",
        "Task",
        "Skill",
      ],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      abortController: abort,
      stderr: (data: string) => {
        if (process.env.CORTEX_DEBUG) console.error("[claude]", data);
      },
    },
  });
  return { q, abort };
}
