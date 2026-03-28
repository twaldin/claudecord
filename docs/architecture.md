# Claudecord — Architecture

## Overview

Claudecord is a Discord bot that routes messages to Claude agent sessions. Each Discord channel maps to one named agent. Agents reply via an MCP shim that calls back to the daemon's HTTP API.

```
Discord ──► Daemon (Express + discord.js) ──► Message Queue
                │                                    │
                │                             Shim (MCP server)
                │                             polls every 2s
                │                                    │
                └──◄── HTTP POST /reply ◄────────── Claude Agent Session
```

---

## Components

### Daemon (`src/daemon/`)

Long-running Node.js process. Three responsibilities:

1. **Discord client** — receives messages, forwards to the right agent's queue; posts replies and embeds back to Discord.
2. **HTTP API** — Express server agents call to receive messages (`GET /messages/:name`) and send replies (`POST /reply`), and that scripts call to signal lifecycle events (`POST /agent/spawn`, `POST /agent/died`).
3. **Runtime systems** — Channel Manager, Status Board, Slash Commands, Stats Store; all wired together in `src/daemon/index.ts`.

### Shim (`src/shim/`)

MCP server that runs inside each agent process. It polls the daemon for messages, exposes them as `notifications/claude/channel` tool calls into the agent's context, and provides the `claudecord_reply` tool so the agent can post back to Discord.

### Scripts (`scripts/`)

tmux-based agent lifecycle management. `spawn_teammate` creates a new tmux pane and calls `POST /agent/spawn`. `kill_teammate` kills the pane and calls `POST /agent/died`.

### Config (`config/routing.json`)

Static channel ID → agent name mapping. The daemon loads this at startup and mutates it in memory as dynamic agent channels are created/destroyed. Changes are persisted back to disk atomically.

---

## Data Flows

### Inbound message (Discord → Agent)

```
1. discord.js fires messageCreate
2. routing.resolveAgent(config, channelId) → agentName
3. ChannelMessage pushed to in-memory queue for agentName
4. Shim polls GET /messages/:agentName every 2s
5. Daemon dequeues and returns messages
6. Shim emits notifications/claude/channel into Claude's context
```

### Outbound reply (Agent → Discord)

```
1. Agent calls claudecord_reply MCP tool with { chat_id, text?, embed? }
2. Shim POSTs to POST /reply
3. Daemon calls discord.sendToChannel(channelId, text) or discord.sendEmbed(channelId, embed)
4. discord.js sends message to Discord channel
```

### Agent spawn flow

```
1. orchestrator calls: spawn_teammate coder-fix-49 /tmp/wt
2. tmux pane created; registry.tsv appended
3. Script POSTs: POST /agent/spawn { agentName, agentType, task, issueNumber, worktreePath }
4. http-api validates and calls onAgentSpawn handler
5. ChannelManager.createAgentChannel(agentName, agentType, task):
   a. guild.channels.create({ name: agentName, type: GuildText })
   b. buildSpawnEmbed → sendEmbed to new channel
   c. routing.addAgentChannel → persists channelId to routing.json
   d. Appends ChannelLifecycle entry to channel-state.json
6. Returns { ok: true, channelId }
7. onSpawnNotify fires: posts spawn summary embed to #code-status
```

### Agent death flow

```
1. kill_teammate calls: POST /agent/died { agentName }
2. http-api calls onAgentDied handler
3. ChannelManager.archiveAgentChannel(channelId, agentName):
   a. channel.permissionOverwrites.create(everyoneRoleId, { SendMessages: false })
   b. buildCleanupEmbed → sendEmbed → cleanupMessageId
   c. addReactions(channelId, cleanupMessageId, ['📦', '🗑️'])
   d. Updates channel-state.json: status → 'archived', diedAt set
```

---

## Channel Manager

**Module:** `src/daemon/channel-manager.ts`

Owns the full lifecycle of ephemeral agent channels. Created once at daemon startup and injected into the HTTP API.

### Lifecycle states

```
spawn_teammate called
       │
       ▼
  createAgentChannel()
       │ creates Discord channel
       │ posts spawn embed
       │ writes routing.json + channel-state.json
       ▼
  status: 'active'
       │
  agent works (messages flow normally)
       │
  kill_teammate / agent exits
       ▼
  archiveAgentChannel()
       │ sets channel read-only (deny SendMessages for @everyone)
       │ posts cleanup embed with 📦 / 🗑️ reactions
       │ status → 'archived'
       ▼
  User reacts:
    📦 → status stays 'archived' (kept read-only forever)
    🗑️ → status → 'pending-cleanup' (daemon can delete after 24h)
    no reaction → auto-archived after 48h
```

### State persistence

Channel state is saved to `$CLAUDECORD_HOME/channel-state.json`. On daemon restart, the manager loads this file. The file is written atomically (write to `.tmp`, then `rename`).

### Category mapping

| agentType   | Discord category |
|-------------|-----------------|
| coder       | Coders          |
| researcher  | Research        |
| evaluator   | Reviews         |
| persistent  | (no category)   |

---

## Status Board

**Module:** `src/daemon/status-board.ts`

Maintains a single persistent embed in `#status` that shows all active agents, task counts, and system health. The message is edited in-place every 60 seconds (configurable via `intervalMs`).

### Update loop

```
start():
  1. post() immediately
  2. setInterval(post, 60_000)

post():
  snapshot = getSnapshot()          // current agent states from index.ts
  embed = buildStatusBoardEmbed(snapshot)
  if (messageId exists):
    editMessage(channelId, messageId, embed)
      ← if 404/error: fallback to sendEmbed (message was deleted)
  else:
    messageId = sendEmbed(channelId, embed)
```

The `messageId` is held in memory only. If the daemon restarts, it posts a fresh message and starts tracking the new ID. Old messages are left in the channel as history.

---

## Slash Commands

**Module:** `src/daemon/slash-commands.ts`

Six guild-scoped slash commands registered via Discord's REST API on daemon startup (`registerSlashCommands`). Guild-scoped means commands appear instantly (vs global commands which take up to an hour to propagate).

| Command   | Description                        | Auth required |
|-----------|------------------------------------|---------------|
| `/spawn`  | Spawn a new agent                  | No            |
| `/status` | Show current agent status (ephemeral) | No         |
| `/tasks`  | List tasks from tasks.md (ephemeral) | No          |
| `/habits` | Mark habits as done                | No            |
| `/kill`   | Kill a running agent               | Yes (allowlist) |
| `/stats`  | Show system stats (today/week/all-time) | No       |

`/kill` checks `deps.allowedUsers` against `interaction.user.id`. The allowlist is populated from `DISCORD_ALLOWED_USERS` in the environment.

`/spawn` creates an agent channel via ChannelManager and replies with `<#channelId>`.

`/kill` autocompletes from the list of registered agents.

---

## Embed System

Two sources of embeds:

**Daemon-generated** — built by `src/daemon/embeds.ts` in response to lifecycle events. These are always posted by the daemon directly (not via an agent reply):

| Function                  | Trigger                        | Channel           |
|---------------------------|--------------------------------|-------------------|
| `buildSpawnEmbed`         | `POST /agent/spawn`            | agent's channel   |
| `buildCleanupEmbed`       | `POST /agent/died`             | agent's channel   |
| `buildCompletionEmbed`    | `POST /agent/work-completed`   | #code-status      |
| `buildStatusBoardEmbed`   | 60s timer                      | #status           |
| `buildHeartbeatEmbed`     | `POST /agent/heartbeat`        | #code-status      |
| `buildPRReviewEmbed`      | agent via `claudecord_reply`   | #code-status      |
| `buildDeployEmbed`        | agent via `claudecord_reply`   | #code-status      |

**Agent-generated** — when an agent calls `claudecord_reply` with an `embed` parameter, the daemon passes the `AgentEmbed` payload to `discord.sendEmbed()`, which wraps it in a discord.js `EmbedBuilder`. Agents construct the embed fields themselves.

See `docs/patterns/rich-embeds.md` for agent-side usage.

---

## Stats Tracking

**Module:** `src/daemon/stats.ts`

Pure functions over a JSON file (`stats.json`). No in-process state — every call reads and writes the file.

### Storage structure

```
stats.json
├── daily[]          — one entry per calendar day
│   └── { date, prsMerged, testsAdded, issuesFixed, agentSpawns, agentCrashes, agentUptime }
├── agents{}         — per-agent lifetime stats (totalSpawns, totalCrashes, totalUptimeSeconds)
├── totals           — all-time aggregate counters
└── lastUpdated      — ISO timestamp
```

### What increments what

| Event                       | Counters updated                          |
|-----------------------------|-------------------------------------------|
| `POST /agent/spawn`         | totals.agentSpawns, today.agentSpawns     |
| `POST /agent/died` (crash)  | totals.agentCrashes, today.agentCrashes   |
| `POST /agent/work-completed`| totals.prsMerged / issuesFixed (if set)   |

Writes are atomic (`.tmp` + `rename`).

---

## Security

### API Bearer token

Set `CLAUDECORD_API_SECRET` in the environment. When set, every HTTP request (except `GET /health`) must include:

```
Authorization: Bearer <secret>
```

Requests without a valid token receive `401 Unauthorized`. The shim reads the same environment variable and includes it in all requests.

### User allowlist

Set `DISCORD_ALLOWED_USERS` to a comma-separated list of Discord user IDs. The daemon passes this list to the slash command handler. Currently enforced for `/kill` — other destructive operations can be guarded by checking `deps.allowedUsers` in the interaction handler.

If `DISCORD_ALLOWED_USERS` is empty, no restriction is applied (suitable for private servers).

---

## Environment Variables

| Variable                       | Required | Description |
|--------------------------------|----------|-------------|
| `DISCORD_TOKEN`                | Yes      | Bot token from Discord Developer Portal |
| `ANTHROPIC_API_KEY`            | Yes      | Anthropic API key for Claude sessions |
| `DISCORD_GUILD_ID`             | Yes*     | Server ID; required to enable channel manager |
| `DISCORD_STATUS_CHANNEL_ID`    | No       | Channel for the auto-updating status board |
| `DISCORD_CODE_STATUS_CHANNEL_ID` | No    | Channel for spawn/completion summaries |
| `DISCORD_ALLOWED_USERS`        | No       | Comma-separated user IDs for privileged commands |
| `CLAUDECORD_API_SECRET`        | No       | Bearer token for HTTP API auth |

\* Without `DISCORD_GUILD_ID`, the daemon starts but channel creation is skipped.
