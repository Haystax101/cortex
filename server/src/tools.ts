import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import { WORKSPACES, getWorkspace } from "./workspaces.js";
import { loadSettings } from "./settings.js";

// In-process MCP tools exposed to every Cortex session. Each run gets its own
// instance so the switch tool can talk back to the client that owns the run.
export type ToolHooks = {
  onSwitchWorkspace?: (workspaceId: string, reason: string) => void;
};

export const CORTEX_TOOL_NAMES = ["mcp__cortex__switch_workspace", "mcp__cortex__notify"];

export async function sendNtfy(title: string, message: string): Promise<boolean> {
  const { ntfyTopic } = loadSettings();
  if (!ntfyTopic) return false;
  try {
    const res = await fetch(`https://ntfy.sh/${ntfyTopic}`, {
      method: "POST",
      headers: { Title: title, Tags: "brain" },
      body: message,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function makeCortexTools(hooks: ToolHooks) {
  const ids = WORKSPACES.map((w) => w.id);
  return createSdkMcpServer({
    name: "cortex",
    version: "1.0.0",
    tools: [
      tool(
        "switch_workspace",
        `Move the conversation into one of George's project repos (or back to the brain). Call this when he says he wants to work on a project. Workspaces: ${WORKSPACES.map((w) => `${w.id} (${w.name}: ${w.blurb})`).join("; ")}. After calling it, tell George in one short sentence that you have switched and ask what he wants to do there; the next message will run inside that repo.`,
        {
          workspace: z.enum(ids as [string, ...string[]]).describe("workspace id"),
          reason: z.string().optional().describe("what George wants to do there, one line"),
        },
        async ({ workspace, reason }) => {
          const ws = getWorkspace(workspace);
          hooks.onSwitchWorkspace?.(ws.id, reason ?? "");
          return {
            content: [
              {
                type: "text",
                text: `Switched to ${ws.name} (${ws.cwd}). The next message from George runs there, with the brain attached.`,
              },
            ],
          };
        },
      ),
      tool(
        "notify",
        "Send a push notification to George's phone. Use sparingly: briefing summary, a reminder he asked for, or something time-critical.",
        {
          title: z.string().max(80),
          message: z.string().max(600),
        },
        async ({ title, message }) => {
          const ok = await sendNtfy(title, message);
          return { content: [{ type: "text", text: ok ? "sent" : "notification not sent (no ntfy topic configured or network error)" }] };
        },
      ),
    ],
  });
}
