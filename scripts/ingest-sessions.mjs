#!/usr/bin/env node
// Summarises George's past Claude Code sessions into the brain, then rewrites the
// project files from those summaries.
//
//   node scripts/ingest-sessions.mjs                 # summarise every session not yet ingested
//   node scripts/ingest-sessions.mjs --project gtod  # one project
//   node scripts/ingest-sessions.mjs --synthesize    # (re)write projects/*.md from the summaries
//   node scripts/ingest-sessions.mjs --all           # summaries + synthesis (what the nightly job runs)
//
// Summaries: ~/brain/knowledge/sessions/<project>/<date>-<slug>-<id>.md
// State:     ~/brain/knowledge/sessions/.ingested.json
// Transcripts (full, for grep): ~/brain/knowledge/sessions/_transcripts/<project>/...
import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BRAIN = process.env.BRAIN_DIR ?? path.join(os.homedir(), "brain");
const SESS_TOOL = path.join(BRAIN, "tools", "sessions.py");
const SUMM_DIR = path.join(BRAIN, "knowledge", "sessions");
const STATE = path.join(SUMM_DIR, ".ingested.json");
const MODEL = process.env.CORTEX_FAST_MODEL ?? "claude-sonnet-5";
const CHUNK = 180_000; // chars per summarisation call
const MIN_MSGS = 4;

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const onlyProject = opt("--project");
const doSummaries = !flag("--synthesize") || flag("--all");
const doSynth = flag("--synthesize") || flag("--all");
const force = flag("--force");

const PROJECT_FILE = {
  supercharged: "projects/supercharged.md",
  vantaphai: "projects/vantaphai.md",
  gtod: "projects/get-there-one-day.md",
  cortex: "projects/cortex.md",
};

function py(cmdArgs) {
  return execFileSync("python3", [SESS_TOOL, ...cmdArgs], { maxBuffer: 256 * 1024 * 1024 }).toString();
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}
function saveState(s) {
  fs.mkdirSync(SUMM_DIR, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 1));
}

// One model call with no tools, no project settings: cheap and fast.
async function ask(system, prompt) {
  const q = query({
    prompt,
    options: {
      cwd: os.tmpdir(),
      model: MODEL,
      systemPrompt: system,
      settingSources: [],
      allowedTools: [],
      disallowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Task", "Skill", "TodoWrite"],
      permissionMode: "dontAsk",
      maxTurns: 1,
      effort: "low",
    },
  });
  let out = "";
  for await (const m of q) {
    if (m.type === "assistant") for (const b of m.message.content) if (b.type === "text") out += b.text;
  }
  return out.trim();
}

const SUMMARY_SYSTEM = `You write dense, factual digests of transcripts between George Hastings and Claude Code, for George's personal knowledge base. George is a computer science student and founder; the projects are Supercharged (student career-outreach startup), Vantaphai (legal regulatory-intelligence startup where George is a forward deployed engineer), Get There One Day (his podcast, site and "Charge" assistant) and Cortex (his personal AI brain app). Write in plain markdown with these sections, omitting any that would be empty:

# <one-line title>
**Session:** <id> · <dates> · <project>

## What this session was about
2–4 sentences.

## What got built or changed
Bullets. Concrete: features, files, architecture, commands, data. Keep names of files, branches, services, models and numbers.

## Decisions and reasoning
Bullets: what was decided and why. Include rejected options.

## People, clients and context
Bullets: names (cofounders, clients, mentors), roles, what they asked for or said. Keep quotes short.

## Open threads and next steps
Bullets: unfinished work, questions, ideas parked for later.

## Facts worth remembering
Bullets: durable facts about the product, the codebase, George's preferences or plans.

Be specific and complete rather than short; 300–900 words. Never invent; if the transcript is truncated, say what part is missing.`;

async function summarise(sess) {
  const transcript = py(["show", sess.id]);
  const chunks = [];
  for (let i = 0; i < transcript.length; i += CHUNK) chunks.push(transcript.slice(i, i + CHUNK));
  let parts = [];
  for (let i = 0; i < chunks.length; i++) {
    const label = chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : "";
    parts.push(await ask(SUMMARY_SYSTEM, `Transcript${label}:\n\n${chunks[i]}`));
  }
  if (parts.length > 1) {
    const merged = await ask(
      SUMMARY_SYSTEM,
      `These are digests of consecutive parts of ONE long session. Merge them into a single digest in the same format, keeping every concrete detail and de-duplicating.\n\n${parts.map((p, i) => `--- PART ${i + 1} ---\n${p}`).join("\n\n")}`,
    );
    return merged;
  }
  return parts[0];
}

function slug(s) {
  return (s || "session").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "session";
}

async function runSummaries() {
  const state = loadState();
  const all = JSON.parse(py(["list", "--json", "--min-msgs", String(MIN_MSGS)]));
  const todo = all.filter((s) => s.project !== "other" && (!onlyProject || s.project === onlyProject) && (force || !state[s.id] || state[s.id].end !== s.end));
  console.log(`${todo.length} session(s) to summarise`);
  for (const s of todo) {
    const dir = path.join(SUMM_DIR, s.project);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${s.start}-${slug(s.first)}-${s.id.slice(0, 8)}.md`);
    process.stdout.write(`  ${s.project} ${s.id.slice(0, 8)} ${s.start} (${Math.round(s.chars / 1000)}k chars) … `);
    const t0 = Date.now();
    try {
      const digest = await summarise(s);
      fs.writeFileSync(file, digest + `\n\n<!-- source: ${s.id} · ${s.start} → ${s.end} · ${s.msgs} messages -->\n`);
      state[s.id] = { end: s.end, file: path.relative(BRAIN, file), at: new Date().toISOString() };
      saveState(state);
      console.log(`ok ${Math.round((Date.now() - t0) / 1000)}s`);
    } catch (e) {
      console.log(`FAILED ${e.message}`);
    }
  }
  // keep the greppable transcripts current too
  py(["export", "all"]);
}

const SYNTH_SYSTEM = `You maintain George Hastings' project files in his personal knowledge base (a folder of markdown he reads daily and that his AI assistant, Cortex, uses to brief him). You are given the CURRENT project file and DIGESTS of every Claude Code session about the project, in date order. Rewrite the project file so it is a rich, accurate, current picture. Keep the existing header lines about repo paths and workspace names. Structure:

# <Project>
One-line description and George's role.

## Overview
What it is, who it's for, how it works. Architecture and stack with concrete names.

## People
Cofounders, clients, mentors, users: name, role, what they care about.

## Timeline
Dated bullets of what happened, from the digests (most important events only, newest last).

## Current state (as of <today>)
Where things actually are. Include numbers.

## Next actions
Checkbox bullets, most important first. Carry over unticked items from the current file unless the digests show they are done.

## Open questions
## Decisions log
Dated bullets: decision and reason.

## Ideas / backlog
## Reference
Links, commands, file paths, environment names, anything George keeps looking up.

Be thorough: this file may be 800–2000 words. Every claim must come from the current file or the digests. Do not invent. Do not include a log of your own edits.`;

async function runSynthesis() {
  const today = new Date().toISOString().slice(0, 10);
  for (const [project, rel] of Object.entries(PROJECT_FILE)) {
    if (onlyProject && project !== onlyProject) continue;
    const dir = path.join(SUMM_DIR, project);
    if (!fs.existsSync(dir)) continue;
    const digests = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => `--- DIGEST ${f} ---\n${fs.readFileSync(path.join(dir, f), "utf8")}`);
    if (!digests.length) continue;
    const file = path.join(BRAIN, rel);
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : `# ${project}\n`;
    process.stdout.write(`synthesising ${rel} from ${digests.length} digest(s) … `);
    const t0 = Date.now();
    const out = await ask(SYNTH_SYSTEM, `Today is ${today}.\n\n=== CURRENT PROJECT FILE (${rel}) ===\n${current}\n\n=== SESSION DIGESTS ===\n${digests.join("\n\n")}`);
    if (out.length < 300) {
      console.log("skipped (empty result)");
      continue;
    }
    fs.writeFileSync(file, out.trim() + "\n");
    console.log(`ok ${Math.round((Date.now() - t0) / 1000)}s, ${out.length} chars`);
  }
}

if (doSummaries) await runSummaries();
if (doSynth) await runSynthesis();
