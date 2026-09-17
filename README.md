# Cortex — a personal AI brain

A local web app, phone app and desk voice assistant on top of a plain folder of markdown (`~/brain`, also an Obsidian vault). The agent is the Claude Agent SDK running the Claude Code engine, so the `claude` CLI and Cortex share one brain and one chat history. Uses your existing Claude subscription login; no API key.

## What it does

- **Brain workspace**: journal, memory, project files, calendar, daily briefing, Get There One Day content log, internship tracker. Runs without permission prompts inside `~/brain`.
- **Project workspaces**: say "let's work on Vantaphai" and the conversation moves into that repo with the brain attached. Edits, tests and builds run freely; pushes, deploys, publishes and destructive commands raise a prompt (answer in the app or say "yes"/"no").
- **Daily briefing**: the first time the server is up after 7am it reads the calendar, yesterday's journal, every project file, the GTOD log, internship deadlines and git activity across your repos, writes the briefing into today's journal, speaks it, and pushes a summary to your phone.
- **Voice**: hold the mic button (or Space / Right Option in the browser), or hold Right Option anywhere on the Mac with the desk client. Speech to text is whisper.cpp; replies are spoken sentence by sentence through Kokoro. Optional wake word.
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

## Run it

```bash
npm install
npm run dev          # server :3001 + Vite :5173 (development)
npm run build && npm start -w server   # single port :3001 with the built app
```

Day to day, `~/cortex-voice/run-cortex.sh` starts the server if needed, opens the app and starts the desk voice client. `launchd/install.sh` makes the server start at login.

## Layout

- `server/src/agent.ts` — the one place `query()` is called; workspace cwd, system prompt, permission guard.
- `server/src/workspaces.ts` — the workspace registry (brain + project repos).
- `server/src/permissions.ts` — risky-command patterns and the pending-prompt registry.
- `server/src/tools.ts` — in-process MCP tools: `switch_workspace`, `notify`.
- `server/src/voice.ts` — `/api/voice/stt` (ffmpeg + whisper-cli) and `/api/voice/tts` (Kokoro daemon, cached).
- `server/src/briefing.ts` — briefing runner, once-a-day scheduler, ntfy push.
- `server/src/settings.ts` — `~/.cortex/config.json`.
- `web/` — React + Vite + Tailwind UI, PWA manifest and icons in `web/public`.
- `voice/desk.py` — push-to-talk desk client (Right Option), optional `--wake`.
- `launchd/` — LaunchAgent plist and install script.

## Environment

| Var | Default | Purpose |
|---|---|---|
| `BRAIN_DIR` | `~/brain` | Root of the brain tree |
| `PORT` / `HOST` | `3001` / `127.0.0.1` | Bind address (keep localhost; expose via `tailscale serve`) |
| `CORTEX_MODEL` | `claude-opus-5` | Model for project work and brain chats |
| `CORTEX_FAST_MODEL` | `claude-sonnet-5` | Model for the briefing |
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

## Notes

- Permission mode: brain runs `bypassPermissions`; project workspaces run `acceptEdits` plus a `PreToolUse` hook that gates risky Bash (see `permissions.ts`) behind a prompt to whoever is connected.
- Sessions live in `~/.claude/projects/<mangled cwd>/`, one folder per workspace; project workspaces therefore also list your `claude` CLI sessions for that repo.
- The desk client must be started from a Terminal window so macOS grants microphone and Input Monitoring permissions.
