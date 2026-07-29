# Cortex — your personal AI brain

A local web app that puts a chat interface on top of a plain folder tree at `~/brain`. Claude (via the Claude Agent SDK) reads and writes that tree directly — knowledge notes, persistent memory, uploaded files, and agent skills — using your existing Claude subscription login.

## How it works

```
Browser (React + Vite + Tailwind)
   │  WebSocket (streaming chat) + REST (chats, files, upload)
Server (Express + ws + Claude Agent SDK)
   │  spawns the Claude Code engine per message, cwd = ~/brain
~/brain (the actual brain — a git repo of markdown)
   ├── CLAUDE.md            brain constitution: identity, protocols, boundaries
   ├── .claude/skills/      agent skills (file-inbox, remember, add your own)
   ├── knowledge/           the wiki (people/, projects/, reference/, index.md)
   ├── memory/              MEMORY.md + topics/ — maintained by the agent itself
   └── inbox/               drag-and-drop uploads land here until filed
```

Because chats are stored in Claude Code's own session format and the brain follows Claude Code conventions, the `claude` CLI and this app share one brain: run `claude` inside `~/brain` and those chats appear in the web sidebar too.

## Run it

```bash
cd cortex
npm install
npm run dev        # server on :3001, web on :5173
```

Open http://localhost:5173.

Production-ish mode (single port, no Vite):

```bash
npm run build      # builds web/dist
npm start -w server  # serves app + API on http://127.0.0.1:3001
```

## Auth / billing

No API key needed: the Agent SDK spawns the Claude Code engine, which uses the machine's existing `claude` CLI login, so usage counts against your Claude subscription. To switch to metered API billing later, set `ANTHROPIC_API_KEY` in the server's environment — zero code change. The startup log prints which auth mode is active.

## Config (env vars)

| Var | Default | Purpose |
|---|---|---|
| `BRAIN_DIR` | `~/brain` | Root of the brain tree |
| `PORT` | `3001` | Server port (binds 127.0.0.1 only) |
| `CORTEX_MODEL` | `claude-opus-5` | Model for chat turns |
| `CORTEX_DEBUG` | unset | Log the Claude engine's stderr |

## Notes & gotchas

- **Permissions**: the agent runs with `bypassPermissions` (it never blocks on a prompt). Its boundaries come from `~/brain/CLAUDE.md`; `~/brain` is a git repo, so `git log`/`git diff` there is your undo net. For tighter control, switch `permissionMode` to `"dontAsk"` and drop `Bash` from `allowedTools` in `server/src/agent.ts`.
- **Sessions** live in `~/.claude/projects/-Users-gdwha-brain/*.jsonl`. Resume only works when `cwd` matches, which is why every `query()` goes through `server/src/agent.ts`.
- The first token takes ~1–2 s (the SDK spawns a fresh engine process per message).
- `~/brain` must be trusted by Claude Code (`projects["…/brain"].hasTrustDialogAccepted` in `~/.claude.json` — already set on this machine).
