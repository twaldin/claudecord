---
name: setup
description: "Set up Claudecord — Discord bot, daemon, and agent routing. Use when first installing or reconfiguring the Discord integration."
user-invocable: true
---

# Claudecord Setup

You are guiding the user through setting up Claudecord — a Discord-based communication layer for Claude Code agents.

## What Claudecord Does

Claudecord gives each of your Claude Code agents its own Discord channel. You can talk to agents from your phone, see status boards, and manage your agent team without touching the terminal.

**Architecture:**
- **Daemon** — Node.js process that runs the Discord bot, HTTP API, and channel manager
- **Shim** — MCP server that runs inside each agent, connecting it to the daemon for bidirectional messaging
- **Scripts** — spawn, kill, message, and manage agents (provided by tmux-orchestrator plugin)

## Setup Checklist

### 1. Prerequisites
- Node.js 18+ installed
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- A Discord server (guild) where you have admin permissions
- tmux-orchestrator plugin installed (for agent scripts)

### 2. Environment Configuration

Create `.env` in the claudecord directory:

```env
DISCORD_TOKEN=your-bot-token-here
DISCORD_GUILD_ID=your-guild-id
DISCORD_ALLOWED_USERS=your-discord-user-id
CLAUDECORD_API_SECRET=any-random-string
CLAUDECORD_HOME=/path/to/claudecord
```

**Finding your IDs:**
- Guild ID: Right-click your server name → Copy Server ID (enable Developer Mode in Discord settings)
- User ID: Right-click your username → Copy User ID

### 3. Install Dependencies

```bash
cd ~/claudecord && npm install
```

### 4. Start the Daemon

```bash
npm run daemon
```

Or run in background:
```bash
nohup npm run daemon > /tmp/claudecord-daemon.log 2>&1 &
```

### 5. Verify

```bash
curl http://localhost:19532/health
```

Should return: `{"status":"ok","agents":[...],"uptime":...}`

### 6. Configure Agent Shim

When spawning agents with tmux-orchestrator, the shim connects automatically if:
- `CLAUDECORD_AGENT_NAME` is set (done by spawn_teammate)
- The daemon is running on port 19532

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Daemon won't start | Check `.env` exists and DISCORD_TOKEN is valid |
| Bot offline in Discord | Verify bot is invited to guild with proper permissions |
| Agent can't reach daemon | Check `curl localhost:19532/health` |
| No channels created | Verify DISCORD_GUILD_ID is correct |
