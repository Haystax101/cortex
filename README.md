# Cortex — a personal AI brain

A local web app, phone app and desk voice assistant on top of a plain folder of markdown (`~/brain`, also an Obsidian vault). The agent is the Claude Agent SDK running the Claude Code engine, so the `claude` CLI and Cortex share one brain and one chat history. Uses your existing Claude subscription login; no API key.

## What it does

- **Conductor (the home screen)**: one fast voice you talk to all day. It's Claude Haiku on the API (your monthly API credits, roughly a tenth of a cent per turn), with a short prompt and a handful of tools. It brainstorms with you, captures ideas, and hands real work to background workers, then tells you what they came back with. Talk over it and it stops (barge-in).
- **Workers**: each task is a full Claude Code session on your **subscription** (never the API key), running in its own git worktree on a `cortex/*` branch so several can work on one repo at once without touching your checkout. They commit on their branch, stop to ask when they need a decision (`QUESTION:`), and end with a spoken `SUMMARY:`. Up to `maxParallel` (default 3) run at once; the rest queue. Risky commands (push, deploy, delete) still raise an approval, answered by voice, on the board, or from your phone.
- **Board**: needs-you (approvals and questions), what's running per project, recent results, and captured ideas. Tap a task for its activity, report, branch, transcript, and merge / discard / follow-up.
- **Cloud tasks (off until you enable them)**: `where: "cloud"` dispatches a task with `claude --cloud`, which runs on Anthropic's machines against the repo's pushed GitHub branch, keeps going with the Mac shut, and counts toward your plan's usage, not API credits. Enable with `PATCH /api/settings {"cloudEnabled": true}`.

- **Brain workspace**: journal, memory, project files, calendar, daily briefing, Get There One Day content log, internship tracker. Runs without permission prompts inside `~/brain`.
- **Project workspaces**: say "let's work on Vantaphai" and the conversation moves into that repo with the brain attached. Edits, tests and builds run freely; pushes, deploys, publishes and destructive commands raise a prompt (answer in the app or say "yes"/"no").
- **Daily briefing**: the first time the server is up after 7am it reads the calendar, yesterday's journal, every project file, the GTOD log, internship deadlines and git activity across your repos, writes the briefing into today's journal, speaks it, and pushes a summary to your phone.
- **Voice**: hold the mic button (or Space / Right Option in the browser), switch on **hands-free** (voice activity detection, just talk; talking over Cortex interrupts it), or hold Right Option anywhere on the Mac with the desk client (which talks to the conductor and speaks worker updates; `--chat` for the old direct workspace chat). Speech to text is whisper.cpp; replies start speaking at the first clause through Kokoro. Optional wake word.
- **Phone**: the same web app over Tailscale, installable to the home screen.
- **Calendar**: `cortex-cal`, a small Swift EventKit tool, reads and writes every calendar the Mac can see (iCloud, Google, lecture feeds).

```
Browser / phone PWA / desk client (voice/desk.py)
        │  WebSocket (streaming chat, permission prompts, workspace switches) + REST (chats, files, voice, briefing)
Server (Express + ws + Claude Agent SDK)          server/src
        │  spawns the Claude Code engine per turn, cwd = workspace root, ~/brain attached
        ├── voice/tts_daemon.py   Kokoro ONNX, kept warm
        ├── whisper-cli           speech to text
        └── ~/.local/bin/cortex-cal   EventKit calendar CLI
~/brain   CLAUDE.md · projects/ · journal/ · gtod/ · internships/ · knowledge/ · memory/ · tools/ · .claude/skills/
```

## Conductor setup (once)

The conductor needs an Anthropic API key (console.anthropic.com → API keys; the plan's monthly API credits pay for it). It is read from `~/.cortex/anthropic-key` or `CORTEX_ANTHROPIC_KEY`, deliberately **not** `ANTHROPIC_API_KEY`: if that were set, Claude Code would bill the API instead of the subscription. Cortex also strips `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` from every engine process it starts, so workers always run on the subscription.

```bash
pbpaste > ~/.cortex/anthropic-key && chmod 600 ~/.cortex/anthropic-key   # with the key on the clipboard
```

The header shows the month's estimated conductor spend.

## Run it

```bash
npm install
npm run dev          # server :3001 + Vite :5173 (development)
npm run build && npm start -w server   # single port :3001 with the built app
```

Day to day, `~/cortex-voice/run-cortex.sh` starts the server if needed, opens the app and starts the desk voice client. `launchd/install.sh` makes the server start at login.

## Layout

- `server/src/conductor.ts` — the voice front end: Haiku on the Messages API, streaming, tools, barge-in, spoken worker updates, conversation memory in `~/.cortex/conductor.json`.
- `server/src/tasks.ts` — background workers: queue, git worktrees, Agent SDK sessions, questions/approvals, merge/discard. State in `~/.cortex/tasks.json`, worktrees in `~/.cortex/worktrees/`.
- `server/src/cloud.ts` — `claude --cloud` dispatch (gated by `cloudEnabled`).
- `server/src/ideas.ts`, `server/src/board.ts`, `server/src/bus.ts` — captured ideas, board REST, in-process event bus.
- `server/src/agent.ts` — Agent SDK options for every engine session; workspace cwd, system prompt, permission guard, API-key stripping.
- `server/src/workspaces.ts` — the workspace registry (brain + project repos).
- `server/src/permissions.ts` — risky-command patterns and the pending-prompt registry.
- `server/src/tools.ts` — in-process MCP tools: `switch_workspace`, `notify`.
- `server/src/voice.ts` — `/api/voice/stt` (ffmpeg + whisper-cli) and `/api/voice/tts` (Kokoro daemon, cached).
- `server/src/briefing.ts` — briefing runner, once-a-day scheduler, ntfy push.
- `server/src/settings.ts` — `~/.cortex/config.json`.
- `web/` — React + Vite + Tailwind UI, PWA manifest and icons in `web/public`. `CortexView` / `Board` / `TaskDrawer` are the conductor screen; `lib/vad.ts` is hands-free listening.
- `voice/desk.py` — push-to-talk desk client (Right Option), optional `--wake`.
- `launchd/` — LaunchAgent plist and install script.

## Environment

| Var | Default | Purpose |
|---|---|---|
| `BRAIN_DIR` | `~/brain` | Root of the brain tree |
| `PORT` / `HOST` | `3001` / `127.0.0.1` | Bind address (keep localhost; expose via `tailscale serve`) |
| `CORTEX_MODEL` | `claude-opus-5` | Model for project work and brain chats |
| `CORTEX_FAST_MODEL` | `claude-sonnet-5` | Model for the briefing, brain tasks and `model: "sonnet"` workers |
| `CORTEX_CONDUCTOR_MODEL` | `claude-haiku-5-5` | The conductor (API) |
| `CORTEX_ANTHROPIC_KEY` | unset | Conductor API key (else `~/.cortex/anthropic-key`) |
| `CORTEX_VOICE_DIR` | `~/cortex-voice` | Python venv, whisper + Kokoro models, TTS cache |
| `CORTEX_DEBUG` | unset | Log the engine's and TTS daemon's stderr |

## Voice setup (already done on George's Mac)

```bash
brew install whisper-cpp ffmpeg
mkdir -p ~/cortex-voice/models && cd ~/cortex-voice
uv venv --python 3.12 .venv && source .venv/bin/activate
uv pip install kokoro-onnx soundfile sounddevice pynput requests numpy websocket-client openwakeword
# models: ggml-small.en.bin (whisper), kokoro-v1.0.onnx + voices-v1.0.bin (Kokoro) into ~/cortex-voice/models
```

## Settings (`~/.cortex/config.json`, or `PATCH /api/settings`)

`maxParallel` (3) workers at once · `announceUpdates` (true) conductor speaks when tasks finish · `cloudEnabled` (false) allow cloud tasks.

## Notes

- Permission mode: brain runs `bypassPermissions`; project workspaces run `acceptEdits` plus a `PreToolUse` hook that gates risky Bash (see `permissions.ts`) behind a prompt to whoever is connected.
- Sessions live in `~/.claude/projects/<mangled cwd>/`, one folder per workspace; project workspaces therefore also list your `claude` CLI sessions for that repo.
- The desk client must be started from a Terminal window so macOS grants microphone and Input Monitoring permissions.
