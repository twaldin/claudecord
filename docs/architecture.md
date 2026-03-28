# Architecture

## Overview

Claudecord bridges Discord and Claude Code agents through a lightweight daemon + MCP shim pattern.

```
Discord
   │
   │  (messages)
   ▼
┌─────────────────────────────────┐
│           Daemon                │
│  ┌──────────┐  ┌─────────────┐ │
│  │ discord  │  │  HTTP API   │ │
│  │  client  │  │ :19532      │ │
│  └────┬─────┘  └──────┬──────┘ │
│       │  routes to    │        │
│       │  agent queue  │        │
└───────┼───────────────┼────────┘
        │               │
        │         ┌─────┴──────────────────┐
        │         │   Agent (Claude Code)   │
        │         │                         │
        │         │  ┌──────────────────┐   │
        │         │  │   Shim (MCP)     │   │
        │         │  │                  │   │
        │         │  │  polls /messages │   │
        │         │  │  emits channel   │   │
        │         │  │  notifications   │   │
        │         │  │                  │   │
        │         │  │  claudecord_reply│   │
        │         │  │  → POST /reply   │   │
        │         │  └──────────────────┘   │
        │         │                         │
        │         │  CLAUDE.md / state.md   │
        │         └─────────────────────────┘
        │
        └──── daemon sends reply back to Discord
```

## Components

### Daemon (`src/daemon/`)

A Node.js process that runs 24/7:

- **discord.ts** — Discord.js client. Listens for messages, sends replies. Handles chunking for messages > 2000 chars.
- **routing.ts** — Maps Discord channel IDs to agent names via `config/routing.json`.
- **http-api.ts** — Express server on `:19532`. Agents register, poll for messages, and POST replies.
- **index.ts** — Entry point. Wires discord + routing + HTTP API together. Manages PID file for clean restarts.

### Shim (`src/shim/`)

An MCP server that runs inside each Claude Code agent process:

- **index.ts** — Polls `/messages/:agentName` every 2s. Emits `notifications/claude/channel` into the agent's context. Exposes `claudecord_reply` tool.
- **tools.ts** — Message formatting and tool schema.

### Agents (`agents/`)

Claude Code processes running in tmux panes. Each has:

- `CLAUDE.md` — persistent instructions (role, tools, patterns)
- `state.md` — cross-compaction memory (ignored by git)
- `.mcp.json` — loads the claudecord shim as an MCP server

### Registry (`registry.tsv`)

A TSV file tracking live agents:
```
name|window|pane|status|directory|spawned_at
orchestrator|0|0|alive|/home/user/claudecord/agents/orchestrator|2026-01-01T00:00:00Z
coder-fix-42|0|1|alive|/tmp/claudecord-wt-fix-42|2026-01-01T01:00:00Z
```

Scripts use this to send messages, capture panes, and kill agents.

## Message Flow

1. User sends message in Discord channel `#orchestrator`
2. Daemon routes to `orchestrator` agent queue
3. Shim polls and emits `notifications/claude/channel` into orchestrator's context
4. Orchestrator processes, optionally spawns sub-agents via `spawn_teammate`
5. Agent calls `claudecord_reply(chat_id=..., text=...)` via MCP tool
6. Shim POSTs to `/reply` on daemon
7. Daemon sends message back to Discord channel

## Routing Config

```json
{
  "agents": {
    "orchestrator": { "channels": ["CHANNEL_ID_1"] },
    "coder": { "channels": ["CHANNEL_ID_2"] }
  },
  "defaultAgent": "orchestrator"
}
```

Messages to unrouted channels fall through to `defaultAgent`.
