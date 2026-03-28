# Claudecord

Discord bot that routes messages to Claude agents via the Claude Code SDK. Each channel maps to an independent agent session with its own context and tools.

## Architecture

```
Discord Channel → Router → Agent Manager → Claude Code SDK Session
```

- **Bot**: discord.js client handles messages and interactions
- **Router**: maps channels to agent configs (which model, what system prompt, what tools)
- **Agent Manager**: spawns, resumes, and kills Claude sessions per channel
- **Sessions**: thin wrappers around the Claude Code SDK streaming API

## Features

- **Message routing** — each Discord channel maps to a named Claude agent; messages are queued and delivered via the MCP shim
- **Rich Discord embeds** — spawn notifications, PR review results, completion summaries, and deploy outcomes posted as structured embeds
- **Ephemeral channels per agent** — auto-created when `spawn_teammate` runs, auto-archived with 📦/🗑️ cleanup reactions when the agent exits
- **Slash commands** — `/spawn`, `/status`, `/tasks`, `/habits`, `/kill`, `/stats` registered guild-scoped for instant availability
- **Auto-updating status dashboard** — single embed in `#status` that edits in-place every 60 seconds
- **Stats tracking** — PRs merged, issues fixed, agent spawns/crashes stored per-day and all-time in `stats.json`
- **API security** — optional Bearer token auth (`CLAUDECORD_API_SECRET`), user allowlist for privileged commands (`DISCORD_ALLOWED_USERS`)

## Setup

```bash
cp .env.example .env
# Fill in DISCORD_TOKEN and ANTHROPIC_API_KEY
npm install
npm run dev
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — full system architecture, data flows, and component reference
- [`docs/patterns/rich-embeds.md`](docs/patterns/rich-embeds.md) — how agents send embeds via `claudecord_reply`
- [`docs/patterns/ephemeral-channels.md`](docs/patterns/ephemeral-channels.md) — agent channel lifecycle

## License

MIT
