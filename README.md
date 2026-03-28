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
- **Slash commands** — `/spawn`, `/status`, `/tasks`, `/kill`, `/stats` registered guild-scoped for instant availability
- **Auto-updating status dashboard** — single embed in `#status` that edits in-place every 60 seconds
- **Stats tracking** — PRs merged, issues fixed, agent spawns/crashes stored per-day and all-time in `stats.json`
- **API security** — optional Bearer token auth (`CLAUDECORD_API_SECRET`), user allowlist for privileged commands (`DISCORD_ALLOWED_USERS`)

## Quickstart

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. Under **Bot**: click **Add Bot**, then copy the token
3. Under **Bot → Privileged Gateway Intents**, enable:
   - **Message Content Intent**
   - **Server Members Intent** (optional, for member lookups)
4. Under **OAuth2 → URL Generator**, select scopes: `bot`, `applications.commands`
5. Bot permissions: `Send Messages`, `Read Message History`, `Add Reactions`, `Embed Links`, `Manage Channels` (if using ephemeral channels), `Use Slash Commands`
6. Copy the generated URL, open it in a browser, and invite the bot to your server

### 2. Install prerequisites

```bash
# Node.js 20+
node --version

# Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Project dependencies
npm install
```

### 3. Configure

```bash
cp .env.example .env
# Fill in DISCORD_BOT_TOKEN, ANTHROPIC_API_KEY, and other values

bash scripts/setup.sh
# Interactive — prompts for channel IDs and fills placeholders in agent configs
```

`ANTHROPIC_API_KEY` must be set in your environment (or in `.env`) for agents to run.

### 4. Start

```bash
npm run daemon
```

This starts the Express HTTP API and the Discord bot. Agents are spawned separately via `scripts/agents/spawn_teammate`.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — full system architecture, data flows, and component reference
- [`docs/patterns/rich-embeds.md`](docs/patterns/rich-embeds.md) — how agents send embeds via `claudecord_reply`
- [`docs/patterns/ephemeral-channels.md`](docs/patterns/ephemeral-channels.md) — agent channel lifecycle

## License

MIT
