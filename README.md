# Claudecord

> Give your agents Discord channels.

A Claude Code plugin that routes Discord messages to your [tmux-orchestrator](https://github.com/twaldin/tmux-orchestrator) agent team. Talk to your agents from your phone. Each agent gets a channel. Replies come back automatically.

**Requires:** tmux-orchestrator, bun, tmux

## What it does

- Discord message in `#orchestrator` → delivered to your orchestrator as an MCP notification
- Discord message in `#coder-42` → routed to the `coder-42` tmux agent via `send_message`
- Agent runs `reply_discord "done, PR #123"` → message appears in its Discord channel
- `spawn_teammate` with claudecord active → Discord channel auto-created
- `kill_teammate` → channel archived with 📦/🗑️ cleanup embed

## Architecture

```
Discord
  │
  ▼
Claudecord MCP server (bun, runs in orchestrator's Claude Code session)
  │  holds the Discord WebSocket — single bot instance
  │
  ├─► Orchestrator's channel?   →  MCP notification → Claude reads it directly
  │
  └─► Other agent's channel?    →  tmux send_message → agent tmux window
                                                           │
                                          agent runs reply_discord
                                                           │
                                          curl POST localhost:19532/reply
                                                           │
                                          Discord ◄────────┘
```

## Install

```bash
# Install as a local plugin
claude plugin install ./claudecord

# Run setup wizard
/claudecord:setup
```

Or add to your project's `.claude/settings.json` (project-scope only, not user-scope):

```json
{
  "plugins": ["./claudecord"]
}
```

## Setup

Run `/claudecord:setup` once. It walks you through:

1. Discord bot creation (links to Developer Portal)
2. Bot token entry and validation
3. Guild (server) ID
4. Orchestrator channel mapping
5. Optional additional agent channels
6. Test connection

Config is written to `~/.claudecord/config.json` (600 permissions, token protected).
Routing is written to `config/routing.json` (gitignored).

## Project structure

```
claudecord/
├── .claude-plugin/
│   ├── plugin.json          # Plugin metadata
│   └── marketplace.json     # Marketplace listing
├── hooks/
│   ├── hooks.json           # SessionStart hook registration
│   └── session-start        # Context injection: "Discord routing is active"
├── skills/
│   └── discord-setup/
│       └── SKILL.md         # /claudecord:setup wizard
├── scripts/
│   ├── reply_discord        # Agent → Discord (curl to HTTP side-channel)
│   └── reconcile_channels   # Sync channel state with tmux agents
├── src/
│   ├── mcp-server/
│   │   └── index.ts         # MCP server: Discord bot + tools + HTTP side-channel
│   ├── daemon/              # Legacy Express daemon (replaced by mcp-server/)
│   └── shared/
│       └── types.ts
├── config/
│   └── routing.example.json # Copy to routing.json and fill in channel IDs
├── .mcp.json                # Auto-starts MCP server when plugin is enabled
└── package.json
```

## MCP tools

The orchestrator session gets these tools automatically:

| Tool | Description |
|------|-------------|
| `claudecord_reply` | Send a message to a Discord channel |
| `claudecord_fetch_messages` | Fetch recent messages from a channel |
| `claudecord_create_channel` | Create a Discord channel for an agent |
| `claudecord_archive_channel` | Archive a channel when an agent completes |

## Scripts

### `reply_discord`

For agent sessions (without the plugin). Requires `CLAUDECORD_CHANNEL_ID` env var or `--channel`.

```bash
reply_discord "task complete, PR #42"
reply_discord "here is the result" --channel 1234567890
reply_discord "see above" --reply-to 9876543210
```

### `reconcile_channels`

Sync Discord channels with live tmux agents.

```bash
reconcile_channels        # dry run: show what would change
reconcile_channels --fix  # archive channels for dead agents
```

## Config

`~/.claudecord/config.json`:

```json
{
  "discordBotToken": "MTIz...",
  "discordGuildId": "111222333444",
  "primaryAgent": "orchestrator",
  "httpPort": 19532,
  "allowedUsers": ["123456789"]
}
```

`config/routing.json` (gitignored, copy from `routing.example.json`):

```json
{
  "agents": {
    "orchestrator": { "channels": ["111000111000111001"] },
    "evaluator":    { "channels": ["111000111000111002"] }
  },
  "defaultAgent": "orchestrator"
}
```

## Env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDECORD_CONFIG` | `~/.claudecord/config.json` | Config file path |
| `CLAUDECORD_HTTP_PORT` | `19532` | HTTP side-channel port |
| `CLAUDECORD_PRIMARY_AGENT` | `orchestrator` | Primary agent name |
| `DISCORD_BOT_TOKEN` | — | Bot token (falls back from config) |
| `DISCORD_GUILD_ID` | — | Guild ID (falls back from config) |
| `DISCORD_ALLOWED_USERS` | — | Comma-separated Discord user IDs |

## Single-bot design

Install claudecord **only on the orchestrator session** (project-scope `.claude/settings.json`, not user-scope). This ensures only one Discord bot connection is active. Agent sessions don't need the plugin — they use the `reply_discord` script which curl-POSTs to the orchestrator's HTTP side-channel.

## Required bot permissions

- `Send Messages`
- `Read Messages / View Channels`
- `Read Message History`
- `Add Reactions`
- `Embed Links`
- `Manage Channels` (for ephemeral channel creation/archiving)

## License

MIT
