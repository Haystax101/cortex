import { spawn } from "node:child_process";
import { workerEnv } from "./agent.js";
import type { Task } from "./tasks.js";

// Dispatches a task to a Claude Code cloud session with `claude --cloud`.
// Cloud sessions run on Anthropic's machines against the repo's GitHub remote
// (the pushed branch, not local edits), keep going with the Mac closed, and
// count toward the subscription's usage limits, not API credits. The API key
// is stripped from the environment so the CLI can't bill the API instead.
//
// Gated behind settings.cloudEnabled; tasks.ts checks it before calling.

const CLAUDE_BIN = process.env.CORTEX_CLAUDE_BIN ?? "claude";
const URL_RE = /https:\/\/claude\.ai\/code\/[A-Za-z0-9_\-/]+/;

export function startCloudTask(t: Task, prompt: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, ["--cloud", prompt], {
      cwd: t.baseCwd,
      env: workerEnv() as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let settled = false;
    const finish = (url: string | undefined, err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // The session lives in the cloud; the local CLI is only the launcher.
      if (child.exitCode === null) child.kill("SIGTERM");
      if (err) reject(err);
      else resolve(url);
    };
    const onData = (d: Buffer) => {
      out += d.toString();
      const m = URL_RE.exec(out);
      if (m) finish(m[0]);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => finish(undefined, new Error(`could not run ${CLAUDE_BIN}: ${e.message}`)));
    child.on("exit", (code) => {
      const m = URL_RE.exec(out);
      if (m) return finish(m[0]);
      if (code === 0) return finish(undefined);
      finish(undefined, new Error(`claude --cloud exited ${code}: ${out.trim().slice(-400)}`));
    });
    const timer = setTimeout(() => {
      const m = URL_RE.exec(out);
      finish(m?.[0], m ? undefined : new Error(`claude --cloud gave no session link within 90s: ${out.trim().slice(-300)}`));
    }, 90_000);
  });
}
