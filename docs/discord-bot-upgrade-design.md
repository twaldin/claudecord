# Discord Bot Upgrade Design

**Claudecord v2 — Rich Discord Experience**
Document version: 2026-03-28
Target file: `/tmp/claudecord-oss/docs/discord-bot-upgrade-design.md`

---

## 1. Current Architecture Baseline

Before prescribing changes, the exact current state:

**`src/daemon/discord.ts`** — `createDiscordClient()` wraps a discord.js `Client` with three intents: `Guilds`, `GuildMessages`, `MessageContent`. It exposes `sendToChannel(channelId, text, replyTo?)` which fetches a channel by ID and sends plain text, chunking at 2000 chars. No embed support. No channel management. No slash command registration.

**`src/daemon/http-api.ts`** — Express server with four routes: `POST /register`, `GET /messages/:agentName`, `POST /reply`, `GET /health`. The `/reply` handler accepts `{ channelId, text, replyTo? }` and delegates to `discord.sendToChannel`. No embed payload path exists.

**`src/daemon/routing.ts`** — Loads `config/routing.json` once at startup into a `RoutingConfig` object held in memory. `resolveAgent(config, channelId)` does a linear scan. File is read once — no reload, no write-back, no dynamic channels.

**`src/daemon/index.ts`** — Wires the above three together. `routingConfig` is a `const` captured at startup. There is no mechanism to mutate it at runtime.

**`src/shim/tools.ts` + `src/shim/index.ts`** — MCP server inside each agent process. Polls `/messages/:agentName` every 2s, emits `notifications/claude/channel` into Claude's context. Exposes `claudecord_reply` tool which POSTs `{ channelId, text, replyTo? }` to `/reply`. Tool schema has no embed fields.

**`scripts/agents/spawn_teammate`** — bash script, creates a tmux pane, writes to `registry.tsv`. No HTTP calls, no daemon awareness beyond the registry file. Nothing notifies the daemon when an agent spawns or dies.

**`scripts/agents/kill_teammate`** — kills the pane, marks registry entry `dead`. Again, no daemon notification.

**`registry.tsv`** — format: `name|window|pane|status|directory|spawned_at`. No Discord channel ID column. Daemon does not read this file.

**Key structural constraint:** The daemon and the scripts are currently decoupled. The daemon knows nothing about agent lifecycle. Scripts know nothing about Discord channels. This gap is the central design challenge for every feature below.

---

## 2. Architecture Changes Overview

The upgrade requires three new responsibilities added to the daemon:

1. **Channel Manager** — creates, archives, and deletes Discord channels; maintains the dynamic routing table.
2. **Embed Builder** — constructs typed Discord embeds for all notification types.
3. **Slash Command Handler** — registers and dispatches Discord application commands.
4. **Stats Store** — persists agent and PR metrics to a JSON file.
5. **Status Board** — owns the single-message status embed that auto-updates.

Additionally, the HTTP API gets two new endpoints that scripts call to notify the daemon of agent lifecycle events, and the shim's `claudecord_reply` tool gets an optional `embed` parameter.

The existing `sendToChannel` / polling / routing fundamentals are untouched. Plain-text replies continue to work exactly as today.

---

## 3. Feature 1 — Ephemeral Agent Channels

### 3.1 The Trigger Problem

`spawn_teammate` is a bash script that has no channel to call. The daemon has no signal that an agent was spawned. There are three options for bridging this:

**Option A — Script calls daemon HTTP endpoint.** `spawn_teammate` POSTs to a new `/agent/spawn` endpoint after writing the registry entry. Simple, low-coupling.

**Option B — Daemon polls the registry file.** The daemon watches `registry.tsv` with `fs.watch` and reacts to new entries. Fragile — `fs.watch` is unreliable across NFS/network mounts, and the registry is written by bash.

**Option C — Agent shim notifies daemon on registration.** The shim already calls `POST /register`. Extend that endpoint to also trigger channel creation.

**Decision: Option A for spawn, Option C for teardown.** Spawn is initiated by the orchestrator which runs `spawn_teammate`; extending that script to also call the daemon is natural and explicit. Teardown uses the shim's disconnect path (or a new `POST /agent/died` endpoint called from `kill_teammate`) because a killed agent won't always gracefully unregister.

### 3.2 New HTTP Endpoints

Add to `src/daemon/http-api.ts`:

```
POST /agent/spawn
Body: {
  agentName: string,
  agentType: "coder" | "researcher" | "evaluator" | "persistent",
  task: string,
  issueNumber?: number,
  prNumber?: number,
  worktreePath?: string,
  model?: string
}
Response: { ok: true, channelId: string }
```

```
POST /agent/died
Body: {
  agentName: string
}
Response: { ok: true }
```

The `POST /register` endpoint already exists; keep it as-is (shim calls it), but the orchestrator script calls `/agent/spawn` separately so the daemon can store richer metadata that `/register` doesn't have.

### 3.3 Channel Naming and Category Mapping

Channel names are derived from `agentName`:
- `coder-fix-49` → channel `#coder-fix-49` in category `Coders`
- `coder-pricing` → channel `#coder-pricing` in category `Coders`
- `researcher-spacex-ipo` → channel `#researcher-spacex-ipo` in category `Research`
- `evaluator-pr-52` → channel `#evaluator-pr-52` in category `Reviews`

Agent type is determined by the `agentType` field in `/agent/spawn`, not by name parsing. Categories are created on first use if they don't exist, then reused.

Discord channel name constraints: lowercase, no spaces, max 100 chars, hyphens allowed. The `agentName` from `spawn_teammate` is already in this format (e.g., `coder-fix-49`).

### 3.4 New Module: `src/daemon/channel-manager.ts`

This module owns all channel lifecycle operations:

```typescript
interface ChannelManagerDeps {
  client: Client               // discord.js Client, passed in after login
  guildId: string              // from env DISCORD_GUILD_ID
  config: {
    categories: {
      coders: string           // category name, e.g. "Coders"
      researchers: string      // "Research"
      evaluators: string       // "Reviews"
    }
    archiveAfterDays: number   // default 7; 0 = manual only
  }
}

interface ChannelLifecycle {
  channelId: string
  agentName: string
  agentType: AgentType
  status: 'active' | 'archived' | 'pending-cleanup'
  spawnedAt: string
  diedAt?: string
  cleanupMessageId?: string    // the reaction-based cleanup embed message ID
}
```

Public interface:
- `createAgentChannel(agentName, agentType, metadata)` → `Promise<string>` (channelId)
- `archiveAgentChannel(agentName)` → `Promise<void>` — makes channel read-only, posts summary embed
- `deleteAgentChannel(agentName)` → `Promise<void>` — removes channel entirely
- `handleCleanupReaction(messageId, emoji, userId)` → `Promise<void>`

Channel state is persisted to `$CLAUDECORD_HOME/channel-state.json` so it survives daemon restarts. On daemon startup, the channel manager loads this file and reconciles against Discord's actual channel list.

### 3.5 Routing Config Changes

`RoutingConfig` needs to support dynamic mutation at runtime. Two changes:

**`src/shared/types.ts`** — extend `RoutingConfig`:

```typescript
export interface AgentChannelMeta {
  agentType: AgentType
  spawnedAt: string
  task?: string
  issueNumber?: number
  prNumber?: number
}

export interface RoutingConfig {
  agents: Record<string, {
    channels: string[]
    meta?: AgentChannelMeta   // present for dynamically-created channels
  }>
  defaultAgent?: string
}
```

**`src/daemon/routing.ts`** — add `addAgentChannel` and `removeAgentChannel` functions that mutate the in-memory config and write it back to disk atomically (write to `.tmp`, rename). The file on disk is the source of truth across restarts.

```typescript
export function addAgentChannel(
  config: RoutingConfig,
  agentName: string,
  channelId: string,
  meta: AgentChannelMeta,
  routingPath: string
): void

export function removeAgentChannel(
  config: RoutingConfig,
  agentName: string,
  routingPath: string
): void
```

The `loadRouting` function already handles the initial load. `index.ts` passes `routingConfig` by reference; since it's an object, mutations are visible without re-assignment.

### 3.6 Channel Cleanup — Reaction-Based Flow

When an agent dies (via `POST /agent/died` or `kill_teammate` calling that endpoint):

1. The daemon calls `channelManager.archiveAgentChannel(agentName)`.
2. Channel manager sets channel permissions: deny `SEND_MESSAGES` for `@everyone`, allow read.
3. Channel manager posts a cleanup embed to the channel:

```
[embed]
Title: "coder-fix-49 completed"
Description: "Task finished. What should happen to this channel?"
Fields:
  Duration: 2h 14m
  Worktree: /tmp/claudecord-wt-fix-49
  PR: #52 (if applicable)
Footer: "React to choose: 📦 Archive forever  |  🗑️ Delete after 24h  |  No reaction = archived in 48h"
Color: gray (agent is done)
```

4. Channel manager adds bot reactions 📦 and 🗑️ to that message and stores the message ID in `channel-state.json`.

5. The daemon's discord client listens for `messageReactionAdd` events. When a reaction arrives on a tracked cleanup message:
   - 📦 → set `status: 'archived'`, remove 🗑️ reaction, do nothing further (channel stays read-only indefinitely)
   - 🗑️ → set `status: 'pending-cleanup'`, schedule deletion in 24h, post "Channel will be deleted in 24 hours."

6. A timer job in the channel manager checks `channel-state.json` every 10 minutes for entries where:
   - `status === 'pending-cleanup'` and 24h have elapsed → delete channel
   - `status === 'active'` and `diedAt` is set and 48h have elapsed with no reaction → call `archiveAgentChannel` with `permanent: true` (skip the embed re-post, just lock it)

This requires adding `GatewayIntentBits.GuildMessageReactions` to the discord.js client intents in `discord.ts`.

### 3.7 spawn_teammate Script Changes

Add to the end of `scripts/agents/spawn_teammate`, after the registry write:

```bash
# Notify daemon of spawn (non-fatal if daemon not running)
DAEMON_URL="${CLAUDECORD_DAEMON_URL:-http://localhost:19532}"
TASK_DESC="${CLAUDECORD_SPAWN_TASK:-}"
ISSUE_NUM="${CLAUDECORD_SPAWN_ISSUE:-}"

curl -sf -X POST "$DAEMON_URL/agent/spawn" \
  -H "Content-Type: application/json" \
  ${CLAUDECORD_API_SECRET:+-H "Authorization: Bearer $CLAUDECORD_API_SECRET"} \
  -d "{\"agentName\":\"$NAME\",\"agentType\":\"${AGENT_TYPE:-coder}\",\"task\":\"$TASK_DESC\",\"issueNumber\":${ISSUE_NUM:-null},\"worktreePath\":\"$DIR\",\"model\":\"$MODEL\"}" \
  >/dev/null 2>&1 || true
```

Similarly, `kill_teammate` adds a `POST /agent/died` call before the `tmux kill-pane`.

The `spawn_fix_coder` script (private, not in OSS) sets `CLAUDECORD_SPAWN_TASK` and `CLAUDECORD_SPAWN_ISSUE` before calling `spawn_teammate` so the daemon gets the full metadata.

### 3.8 Dispatch Notification (Required by Additional Spec)

Immediately upon processing `POST /agent/spawn`, the daemon posts a rich embed to two places:
1. The newly-created agent channel
2. `#code-status` (channel ID from env `DISCORD_CODE_STATUS_CHANNEL_ID`)

Embed spec:
```
Color:   Blue (#5865F2) for coder | Orange (#ED7D31) for researcher | Red (#ED4245) for evaluator
Title:   "coder-fix-49 spawned"
Fields:
  Type:      Coder (Ephemeral)
  Task:      "Fix null pointer in upload handler"
  Issue:     #49 (linked: https://github.com/.../issues/49)
  Worktree:  /tmp/claudecord-wt-fix-49
  Model:     sonnet
  Spawned:   <relative timestamp, e.g. "just now">
Footer:    "Watch progress in #coder-fix-49"
```

This is the "dispatch notification" — Tim sees it the moment work starts.

---

## 4. Feature 2 — Rich Embeds

### 4.1 Embed Construction Location

Embeds can be constructed either in the daemon (when the daemon generates the notification) or by agents via an extended `claudecord_reply` tool. Both paths are needed.

- **Daemon-generated embeds:** spawn notification, completion summary, heartbeat, status board. The daemon owns these because it has the data and they are not agent-authored content.
- **Agent-generated embeds:** PR review verdict, deploy result, research summary. The agent has the structured data and the daemon should just pass it through.

### 4.2 New Module: `src/daemon/embeds.ts`

All embed construction lives here. Exports pure functions that return `EmbedBuilder` objects from discord.js. No side effects. Fully testable.

```typescript
import { EmbedBuilder, Colors } from 'discord.js'

// Agent type colors
export const AGENT_COLORS = {
  coder:      0x5865F2,  // Discord blurple
  researcher: 0xED7D31,  // orange
  evaluator:  0xED4245,  // red
  persistent: 0x57F287,  // green
} as const

export function buildSpawnEmbed(data: SpawnEmbedData): EmbedBuilder
export function buildCompletionEmbed(data: CompletionEmbedData): EmbedBuilder
export function buildHeartbeatEmbed(data: HeartbeatEmbedData): EmbedBuilder
export function buildPRReviewEmbed(data: PRReviewEmbedData): EmbedBuilder
export function buildDeployEmbed(data: DeployEmbedData): EmbedBuilder
export function buildCleanupEmbed(data: CleanupEmbedData): EmbedBuilder
export function buildStatusBoardEmbed(data: StatusBoardData): EmbedBuilder
```

Input types are defined in `src/shared/types.ts` so the shim can reference them.

### 4.3 Extending claudecord_reply for Embeds

**`src/shared/types.ts`** — extend `AgentReply`:

```typescript
export interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface AgentEmbed {
  title?: string
  description?: string
  color?: number
  fields?: EmbedField[]
  footer?: string
  url?: string
  thumbnailUrl?: string
}

export interface AgentReply {
  channelId: string
  text?: string             // now optional if embed is present
  embed?: AgentEmbed        // new
  replyTo?: string
}
```

**`src/shim/tools.ts`** — extend `REPLY_TOOL` input schema with optional `embed` object field. The Zod schema in `src/shim/index.ts` gets a corresponding optional `embed` shape.

**`src/daemon/http-api.ts`** — the `/reply` handler already passes the whole body to `onReply`. No change needed here except validation: at least one of `text` or `embed` must be present.

**`src/daemon/discord.ts`** — `sendToChannel` gains an overload:

```typescript
async function sendToChannel(
  channelId: string,
  content: { text?: string; embed?: AgentEmbed },
  replyTo?: string
): Promise<void>
```

Internally it builds a discord.js `EmbedBuilder` from `AgentEmbed` if present, then sends `{ content: text, embeds: [embed] }`.

The existing plain-text path is preserved: if `embed` is absent and `text` is present, it calls the same `channel.send(chunk)` logic as today.

### 4.4 Embed Types Reference

**Spawn embed** (daemon-generated, posted to new channel + #code-status):
- Color by agent type
- Fields: Type, Task, Issue/PR link, Worktree path, Model, Spawned timestamp
- Footer: "Watch progress in #channel-name"

**Completion embed** (agent-generated via claudecord_reply, or daemon-generated when `/agent/died` comes with result metadata):
- Color: green (success) / red (failure)
- Fields: Duration, Files changed, PR link (if coder), Summary
- Footer: Agent name + exit reason

**Heartbeat embed** (daemon/orchestrator-generated, posted to #code-status):
- Color: green (healthy) / yellow (degraded) / red (critical)
- Fields: Active agents (N), Context % per agent, Tasks P0/P1 counts, Last heartbeat
- Timestamp: auto-set by Discord

**PR review embed** (evaluator-generated via claudecord_reply):
- Color: green (approved) / red (changes requested) / orange (pending)
- Fields: PR title, Verdict, Confidence, Blockers (if any), Tests status
- URL: link to GitHub PR

**Deploy embed** (evaluator or orchestrator-generated):
- Color: green / red
- Fields: PR merged, Tests, VPS target, Restart status, Duration
- URL: GitHub PR link

---

## 5. Feature 3 — Auto-Updating Status Board

### 5.1 Design

A `#status` channel contains exactly one embed, posted on daemon startup and edited in-place every 60 seconds. The daemon stores the message ID in `channel-state.json`. If the message is deleted externally, the daemon reposts it on the next tick.

### 5.2 New Module: `src/daemon/status-board.ts`

```typescript
interface StatusBoardDeps {
  discord: ReturnType<typeof createDiscordClient>   // needs editMessage added
  channelId: string
  intervalMs: number    // default 60000
  getSnapshot: () => Promise<StatusBoardData>
}

export function createStatusBoard(deps: StatusBoardDeps): {
  start: () => void
  stop: () => void
}
```

`getSnapshot()` is injected so the status board stays decoupled from the HTTP API internals. The injected function reads `registeredAgents`, `messageQueues`, and `channel-state.json` to build the snapshot.

### 5.3 discord.ts Changes

Add `editMessage(channelId, messageId, content)` and `sendEmbed(channelId, embed)` to the returned interface from `createDiscordClient`. The status board uses `sendEmbed` for initial post and `editMessage` for updates.

### 5.4 StatusBoardData Shape

```typescript
interface AgentStatusEntry {
  name: string
  type: AgentType
  status: 'idle' | 'working' | 'compacting' | 'dead'
  contextPct?: number    // from agent_status scraping, optional
  lastActivity: string   // ISO timestamp
  channelId?: string
}

interface StatusBoardData {
  agents: AgentStatusEntry[]
  taskCounts: { p0: number; p1: number; p2: number }
  systemHealth: 'healthy' | 'degraded' | 'critical'
  lastUpdated: string
}
```

Context percentage is populated via a new optional `/agent/heartbeat` endpoint that agents can POST to periodically with their current context %, or by the orchestrator scraping `agent_status`. The status board gracefully omits context % if not available.

### 5.5 Embed Layout

```
[Status Board]
Title: "Claudecord — System Status"
Description: "Updated <relative time>"
Color: green / yellow / red based on systemHealth

Fields (one per agent):
  "orchestrator"  |  "idle  |  ctx: 34%  |  last: 2m ago"  |  inline: true
  "evaluator"     |  "working  |  ctx: 67%  |  last: 12s ago" |  inline: true
  "coder-fix-49"  |  "working  |  ctx: 12%  |  last: 5s ago"  |  inline: true

Separator field:
  "Tasks"  |  "P0: 0  P1: 2  P2: 8"  |  inline: false

Footer: "Auto-updates every 60s  •  /status for details"
Timestamp: set to current time (Discord renders relative)
```

---

## 6. Feature 4 — Slash Commands

### 6.1 Registration

Discord requires slash commands to be registered with the API before they appear in the UI. Registration happens once at daemon startup via the Discord REST API, not through the gateway. Commands are registered as guild commands (instant) not global commands (takes up to 1h to propagate).

Add `DISCORD_GUILD_ID` to `.env`. The daemon calls `Routes.applicationGuildCommands(clientId, guildId)` on `client.ready`.

Registration is idempotent — calling it with the same command definitions overwrites them. No migration tooling needed.

### 6.2 New Handler: `src/daemon/slash-commands.ts`

```typescript
export function registerSlashCommands(client: Client, guildId: string): void
export function handleInteraction(
  interaction: Interaction,
  deps: SlashCommandDeps
): Promise<void>
```

`SlashCommandDeps` injects: `getRouting`, `getStats`, `getRegistry`, `spawnAgent`, `killAgent`, `readTasksFile`.

### 6.3 Command Definitions

All six commands:

**`/spawn <type> <task> [issue]`**
- Options: `type` (string, choices: coder/researcher/evaluator), `task` (string), `issue` (integer, optional)
- Action: calls `POST /agent/spawn` internally (same path as `spawn_teammate` would call)
- Reply: ephemeral embed showing spawn result with channel link

**`/status`**
- No options
- Action: reads current status snapshot, builds same embed as status board
- Reply: ephemeral (only visible to caller)

**`/tasks [priority]`**
- Options: `priority` (string, choices: all/p0/p1/p2, default: all)
- Action: reads `tasks.md`, parses markdown table, filters by priority
- Reply: embed with task list; if >25 tasks, truncates with "and N more"

**`/habits <habits>`**
- Options: `habits` (string — comma-separated habit names)
- Action: calls the orchestrator via `POST /messages` injection (enqueues a message to the orchestrator agent telling it to mark those habits)
- Reply: ephemeral "Marking habits: X, Y, Z — orchestrator will confirm"

**`/kill <agent>`**
- Options: `agent` (string, autocomplete from registry)
- Action: calls `POST /agent/died` and then shells out to `kill_teammate <agent>`
- Reply: ephemeral confirmation embed
- Requires: command caller must be in `DISCORD_ALLOWED_USERS` (reuse existing auth list)

**`/stats [period]`**
- Options: `period` (string, choices: today/week/all-time, default: today)
- Action: reads stats store, builds embed
- Reply: embed with stats

### 6.4 Autocomplete for /kill

The `agent` option on `/kill` uses discord.js autocomplete. The handler intercepts `interaction.isAutocomplete()` and returns agent names from the registry that are currently `alive`.

### 6.5 Client Intents

Add `GatewayIntentBits.GuildIntegrations` is not needed — slash commands use the Interaction create event which is covered by the default gateway. Ensure the bot has `application.commands` OAuth scope when invited.

---

## 7. Feature 5 — Stats Tracking

### 7.1 Data Model

Stored in `$CLAUDECORD_HOME/stats.json`. Written atomically (tmp + rename). Read on any `/stats` call or `/stats` slash command.

```typescript
interface DailyStats {
  date: string           // YYYY-MM-DD
  prsMerged: number
  testsAdded: number
  issuesFixed: number
  agentSpawns: number
  agentCrashes: number
  agentUptime: Record<string, number>  // agentName → seconds alive that day
}

interface AgentLifetimeStats {
  name: string
  totalSpawns: number
  totalCrashes: number
  totalUptimeSeconds: number
  firstSeen: string
  lastSeen: string
}

interface StatsStore {
  daily: DailyStats[]          // last 90 days, oldest first
  agents: Record<string, AgentLifetimeStats>
  totals: {
    prsMerged: number
    testsAdded: number
    issuesFixed: number
    agentSpawns: number
    agentCrashes: number
  }
  lastUpdated: string
}
```

### 7.2 New Module: `src/daemon/stats.ts`

```typescript
export function loadStats(path: string): StatsStore
export function recordSpawn(store: StatsStore, agentName: string): void
export function recordDeath(store: StatsStore, agentName: string, crashed: boolean): void
export function recordPRMerged(store: StatsStore, prNumber: number): void
export function recordIssueFixed(store: StatsStore, issueNumber: number): void
export function getStatsForPeriod(
  store: StatsStore,
  period: 'today' | 'week' | 'all-time'
): PeriodStats
export function saveStats(store: StatsStore, path: string): void
```

All `record*` functions mutate the store in-place and call `saveStats` internally. `loadStats` initializes an empty store if the file doesn't exist.

### 7.3 Event Wiring

Stats are incremented in `http-api.ts` when:
- `POST /agent/spawn` is received → `recordSpawn`
- `POST /agent/died` is received → `recordDeath` (crashed=false for clean exits)
- Agent sends a reply containing PR metadata → `recordPRMerged` (if the reply payload includes `prNumber` and `merged: true`)

For crash detection: if `POST /agent/died` is never called but the registry goes stale (detected by `reconcile_registry` run at heartbeat), those can be recorded as crashes. The orchestrator can call `POST /agent/died` with a `{ crashed: true }` flag from the heartbeat script.

PR merge and issue fix counts require the evaluator to POST structured completion data. The cleanest approach is a new `/agent/work-completed` endpoint:

```
POST /agent/work-completed
Body: {
  agentName: string,
  prNumber?: number,
  issueNumber?: number,
  testsAdded?: number,
  merged?: boolean
}
```

This endpoint updates stats and optionally triggers the status board refresh.

### 7.4 Stats Embed (for /stats command)

```
Title: "Stats — Today" (or "This Week" / "All Time")
Fields:
  PRs Merged:    3
  Issues Fixed:  3
  Tests Added:   12
  Agent Spawns:  5
  Agent Crashes: 0

  Top Agent:     coder-fix-47  (1h 42m active)
Footer: "Since <date>"
Color: green
```

---

## 8. Implementation Map

### Files to Create

**`src/daemon/channel-manager.ts`**
Owns Discord channel lifecycle. Depends on discord.js `Client`, `guildId`, `channel-state.json`. Exports `createChannelManager(deps)`. ~250 lines.

**`src/daemon/embeds.ts`**
Pure embed builder functions. No discord.js side effects — returns `EmbedBuilder` objects. Testable without a discord connection. ~200 lines.

**`src/daemon/status-board.ts`**
Auto-updating embed in #status. Depends on `discord.ts` (needs `editMessage`), a snapshot provider, and channel ID. ~100 lines.

**`src/daemon/slash-commands.ts`**
Command registration and interaction handler. ~300 lines.

**`src/daemon/stats.ts`**
Stats store CRUD. Pure functions over a JSON file. ~150 lines.

**`config/channel-state.example.json`**
Documents the channel-state.json format for setup.

### Files to Modify

**`src/shared/types.ts`**
- Extend `AgentReply` with optional `embed: AgentEmbed`
- Add `AgentEmbed`, `EmbedField`, `AgentType`, `AgentChannelMeta` types
- Extend `RoutingConfig.agents[name]` with optional `meta`

**`src/daemon/discord.ts`**
- Add `GatewayIntentBits.GuildMessageReactions` to intents
- Add `editMessage(channelId, messageId, content)` to returned interface
- Add `sendEmbed(channelId, embed)` to returned interface
- Modify `sendToChannel` signature to accept `{ text?, embed? }` alongside existing `text: string` overload (backwards compatible)
- Add `messageReactionAdd` event listener, delegate to channel manager

**`src/daemon/routing.ts`**
- Add `addAgentChannel(config, agentName, channelId, meta, path)`
- Add `removeAgentChannel(config, agentName, path)`
- Add `saveRouting(config, path)` (atomic write)

**`src/daemon/http-api.ts`**
- Add `POST /agent/spawn` endpoint
- Add `POST /agent/died` endpoint
- Add `POST /agent/work-completed` endpoint
- Add `POST /agent/heartbeat` endpoint (context % reporting)
- Extend `/reply` validation: accept `embed` in body, validate at least `text` or `embed` present
- Wire new endpoints to `ChannelManagerDeps` and `StatsDeps` injected via `HttpApiDeps`

**`src/daemon/index.ts`**
- Instantiate `ChannelManager`, `StatusBoard`, `StatsStore` after discord login
- Inject them into `HttpApiDeps`
- Register slash command handler on `client.on('interactionCreate')`
- Load `DISCORD_GUILD_ID`, `DISCORD_STATUS_CHANNEL_ID`, `DISCORD_CODE_STATUS_CHANNEL_ID` from env

**`src/shim/tools.ts`**
- Extend `REPLY_TOOL` input schema with optional `embed` object property
- Document embed fields in the tool description

**`src/shim/index.ts`**
- Extend Zod schema for `claudecord_reply` to accept optional `embed`
- Pass `embed` through in the `sendReply` call

**`scripts/agents/spawn_teammate`**
- Add `curl POST /agent/spawn` after registry write (non-fatal)

**`scripts/agents/kill_teammate`**
- Add `curl POST /agent/died` before `tmux kill-pane` (non-fatal)

**`.env.example`**
- Add `DISCORD_GUILD_ID=`
- Add `DISCORD_STATUS_CHANNEL_ID=`
- Add `DISCORD_CODE_STATUS_CHANNEL_ID=`
- Add `DISCORD_ALLOWED_USERS=` (already exists, but document it)

**`config/routing.example.json`**
- Add note that `agents[name].channels` is now dynamically managed for ephemeral agents

### Files to Create (Tests)

**`tests/embeds.test.ts`** — test each embed builder with fixture data, verify field presence and colors
**`tests/stats.test.ts`** — test recordSpawn/recordDeath/getStatsForPeriod
**`tests/routing-dynamic.test.ts`** — test addAgentChannel / removeAgentChannel / saveRouting
**`tests/channel-cleanup.test.ts`** — test cleanup state machine transitions

---

## 9. Data Flow

### Spawn Flow (End-to-End)

```
orchestrator calls spawn_teammate coder-fix-49 /tmp/wt --project ~/trade-up-bot
  │
  ├── tmux pane created, registry.tsv appended
  │
  └── curl POST /agent/spawn {agentName, agentType, task, issueNumber, worktreePath}
        │
        ├── http-api.ts receives, validates
        │
        ├── channelManager.createAgentChannel()
        │     ├── fetch/create "Coders" category in guild
        │     ├── channel.create("#coder-fix-49", category, permissions)
        │     └── save to channel-state.json
        │
        ├── routing.addAgentChannel(config, "coder-fix-49", channelId, meta)
        │     └── write routing.json atomically
        │
        ├── stats.recordSpawn(store, "coder-fix-49")
        │
        ├── embeds.buildSpawnEmbed(data) → EmbedBuilder
        │     ├── discord.sendEmbed(newChannelId, embed)   ← dispatch to new channel
        │     └── discord.sendEmbed(CODE_STATUS_CHANNEL, embed)  ← dispatch to #code-status
        │
        └── response: { ok: true, channelId: "..." }

coder-fix-49 shim starts, calls POST /register
  └── http-api.ts sets up message queue (no channel creation here)
```

### Agent Reply with Embed (End-to-End)

```
evaluator calls claudecord_reply(chat_id=..., embed={...})
  │
  └── shim/index.ts receives MCP tool call
        └── sendReply({ channelId, embed }) → POST /reply
              │
              └── http-api.ts deps.onReply({ channelId, embed })
                    │
                    └── discord.sendToChannel(channelId, { embed })
                          └── EmbedBuilder from AgentEmbed
                                └── channel.send({ embeds: [built] })
```

### Status Board Update Loop

```
Every 60s:
  statusBoard.tick()
    ├── getSnapshot() → reads registeredAgents, channel-state.json, tasks.md
    ├── embeds.buildStatusBoardEmbed(data)
    ├── try discord.editMessage(STATUS_CHANNEL, pinnedMessageId, embed)
    │     └── on 404 (message deleted): discord.sendEmbed() → store new messageId
    └── save messageId to channel-state.json
```

### Cleanup Reaction Flow

```
User reacts 🗑️ to cleanup embed in #coder-fix-49
  │
  └── discord.js messageReactionAdd event
        └── discord.ts forwards to channelManager.handleCleanupReaction()
              ├── validates: message is tracked cleanup message
              ├── validates: reactor is in DISCORD_ALLOWED_USERS
              ├── status → 'pending-cleanup', scheduledDeleteAt = now + 24h
              ├── save channel-state.json
              └── discord.sendToChannel(channelId, "Channel will be deleted in 24 hours.")

Every 10m: channelManager.runCleanupTimer()
  ├── find pending-cleanup entries where now > scheduledDeleteAt
  │     └── discord.channels.delete(channelId)
  │           └── routing.removeAgentChannel(...)
  └── find active entries where diedAt + 48h elapsed and no reaction
        └── set status 'archived' (read-only stays, cleanup embed stays)
```

---

## 10. Build Sequence

### Phase 1 — Foundations (no user-visible changes, all groundwork)

- [ ] Extend `src/shared/types.ts` with `AgentEmbed`, `AgentType`, `AgentChannelMeta`, extended `RoutingConfig` and `AgentReply`
- [ ] Write `src/daemon/embeds.ts` with all embed builders (no discord.js dependency, just `EmbedBuilder` construction)
- [ ] Write `tests/embeds.test.ts` — all builders covered
- [ ] Write `src/daemon/stats.ts` with full CRUD
- [ ] Write `tests/stats.test.ts`
- [ ] Extend `src/daemon/routing.ts` with `addAgentChannel`, `removeAgentChannel`, `saveRouting`
- [ ] Write `tests/routing-dynamic.test.ts`
- [ ] Extend shim tool schema (backwards compatible — `embed` is optional)

Phase 1 has no runtime risk. It adds types and pure functions. Existing tests must still pass.

### Phase 2 — HTTP API Extensions

- [ ] Add `POST /agent/spawn`, `POST /agent/died`, `POST /agent/work-completed`, `POST /agent/heartbeat` to `http-api.ts`
- [ ] Extend `/reply` validation for embed support
- [ ] Extend `HttpApiDeps` interface to accept `ChannelManager` and `StatsStore`
- [ ] Write unit tests for new endpoints with mocked deps

At end of Phase 2: endpoints exist but ChannelManager is a stub that returns placeholder channel IDs. Stats are recorded to file. The `/reply` with embed works but sends as plain text fallback.

### Phase 3 — Discord Client Extensions

- [ ] Add `editMessage`, `sendEmbed` to `discord.ts` interface
- [ ] Add `GuildMessageReactions` intent
- [ ] Modify `sendToChannel` to handle `{ text?, embed? }` input shape (backwards compatible)
- [ ] Wire `messageReactionAdd` through to a callback

At end of Phase 3: the discord client can send embeds and handle reactions, but nothing calls it yet.

### Phase 4 — Channel Manager + Routing Wire-Up

- [ ] Write `src/daemon/channel-manager.ts` with full lifecycle
- [ ] Wire into `index.ts`: instantiate after login, pass to `http-api`
- [ ] `POST /agent/spawn` now calls real channel creation
- [ ] Reaction handler wired through `discord.ts` → `channel-manager.ts`
- [ ] `scripts/agents/spawn_teammate` curl call added
- [ ] `scripts/agents/kill_teammate` curl call added
- [ ] Write `tests/channel-cleanup.test.ts` (mock discord client)
- [ ] Add required env vars to `.env.example`

End of Phase 4: ephemeral channels are created on spawn, archived on death, reaction cleanup works.

### Phase 5 — Status Board

- [ ] Write `src/daemon/status-board.ts`
- [ ] Wire into `index.ts`: start after login with 60s interval
- [ ] `DISCORD_STATUS_CHANNEL_ID` env var
- [ ] Test: mock time, verify editMessage called on tick, verify fallback to sendEmbed on 404

### Phase 6 — Slash Commands

- [ ] Write `src/daemon/slash-commands.ts` — registration + all 6 handlers
- [ ] Wire `interactionCreate` in `index.ts`
- [ ] `DISCORD_GUILD_ID` env var
- [ ] Manual verification (slash commands can't be unit-tested without a real Discord guild)
- [ ] `/kill` authorization check (reuse `DISCORD_ALLOWED_USERS`)

### Phase 7 — Dispatch Notifications

- [ ] `POST /agent/spawn` handler sends spawn embed to new channel + `#code-status`
- [ ] Evaluator's `claudecord_reply` calls include PR review embed
- [ ] Heartbeat embed format defined, orchestrator CLAUDE.md updated to use it

### Phase 8 — Docs + Cleanup

- [ ] Update `docs/architecture.md` with new data flow
- [ ] Write `docs/patterns/rich-embeds.md` — how agents construct and send embeds
- [ ] Write `docs/patterns/ephemeral-channels.md` — lifecycle documentation
- [ ] Update `config/routing.example.json` with notes about dynamic channels
- [ ] Add `config/channel-state.example.json`
- [ ] Verify all existing tests pass

---

## 11. Complexity Estimates

| Feature | Phase | LOC Added/Changed | Complexity | Risk |
|---|---|---|---|---|
| Types extension | 1 | ~80 | Low | None — purely additive |
| Embeds module | 1 | ~200 | Low | Low — pure functions |
| Stats module | 1-2 | ~150 | Low | Low — JSON file I/O |
| Dynamic routing | 1-2 | ~60 | Low | Medium — atomic file write race |
| HTTP API extensions | 2 | ~120 | Low | Low — additive endpoints |
| Discord client extensions | 3 | ~80 | Low | Low — additive methods |
| Channel manager | 4 | ~250 | High | High — Discord API rate limits, permission edge cases |
| Reaction cleanup flow | 4 | ~100 | Medium | Medium — state machine, timer correctness |
| Script curl additions | 4 | ~20 | Low | Low — non-fatal, gracefully degraded |
| Status board | 5 | ~100 | Medium | Low — straightforward polling loop |
| Slash commands | 6 | ~300 | Medium | Medium — Discord registration is guild-scoped, easy to test manually |
| Dispatch notifications | 7 | ~50 | Low | Low — reuses embed builder + sendEmbed |
| Total | | ~1,510 | Medium | Channel manager is the high-risk piece |

The highest-risk piece is `channel-manager.ts`. Discord's channel creation API has a guild limit of 500 channels. Category creation has edge cases when two agents spawn simultaneously and both try to create the same category. Mitigation: use a mutex (simple async queue) around category creation, and check existence before creating.

Discord rate limits for channel management are 5 actions per 10 seconds per guild. For typical usage (1-3 agents spawning per day) this is not a concern. If many coders spawn in a burst, a queue with 250ms delay between channel creations is sufficient.

---

## 12. Critical Details

### Backwards Compatibility

Every change is additive. The `embed` field on `AgentReply` is optional. The `text` field becomes optional only when `embed` is present, and validation enforces that at least one is provided. Existing agents sending `{ channelId, text }` to `/reply` continue to work identically.

The `routing.json` file gains optional `meta` fields on agents, but existing entries without `meta` are handled by existing code paths. No migration needed.

### Error Handling

Channel creation failures in `channel-manager.ts` must not crash the daemon. Use `try/catch` around all Discord API calls, log errors to console, and return a fallback (e.g., fall back to `defaultAgent` routing if channel creation fails). The `POST /agent/spawn` endpoint should return `{ ok: true, channelId: null, error: "..." }` on failure rather than a 500, so `spawn_teammate` doesn't block on this.

Reaction handling errors (e.g., Discord rate limit on removing a bot reaction) are non-critical and can be silently swallowed after logging.

### Security

The `/agent/spawn`, `/agent/died`, and `/agent/work-completed` endpoints must be protected by the existing `CLAUDECORD_API_SECRET` Bearer token auth. These are shell-internal endpoints but they have side effects (channel creation). The existing auth middleware in `http-api.ts` already handles this.

The `/kill` slash command is restricted to users in `DISCORD_ALLOWED_USERS`. This list is already enforced for message routing; reuse it for slash commands.

The channel manager must not allow arbitrary channel names from untrusted input. The `agentName` comes from `spawn_teammate`, which is called by the orchestrator — trusted. But defensively: validate `agentName` matches `/^[a-z0-9-]{1,80}$/` before using it as a Discord channel name.

### State Persistence

`channel-state.json` is the source of truth for channel lifecycle across daemon restarts. On startup, the daemon reconciles this file against Discord's actual channel list. Channels in `channel-state.json` that no longer exist in Discord are pruned. Channels in Discord's category list that aren't in `channel-state.json` are left alone (they may have been manually created).

`stats.json` is append-heavy. Daily entries are pruned to last 90 days on write to prevent unbounded growth.

`routing.json` is written atomically: `write to routing.json.tmp` → `rename to routing.json`. This prevents corrupted config on daemon crash mid-write.

### Testing Strategy

Pure modules (`embeds.ts`, `stats.ts`, routing extensions) are fully unit-testable with vitest. The existing test patterns in `tests/routing.test.ts` and `tests/shim-tools.test.ts` show the style: plain describe/it/expect, no mocking framework needed.

`channel-manager.ts` requires a mock discord.js `Client`. Create a minimal mock type in `tests/helpers/mock-discord.ts` that implements the subset of `Client` methods used: `channels.create`, `channels.fetch`, `channels.edit`, `channels.delete`. This is ~50 lines of mocked interface.

Slash commands cannot be tested without a real guild. Document this in the test file as intentional. Integration-test them manually against a dev Discord server.

### Performance

The status board polls every 60 seconds and edits one message. This is 1 Discord API call per minute — well within rate limits.

The channel manager's 10-minute cleanup timer scans `channel-state.json`. With up to ~100 entries (years of archived channels), this is a trivial linear scan.

The `/reply` path is unchanged in the hot path. Embed construction adds ~1ms of synchronous work. No performance concern.

### Agent CLAUDE.md Updates Required

After Phase 4 ships, update agent CLAUDE.md files:
- `agents/evaluator/CLAUDE.md` — use embed format for PR review verdicts
- `agents/coder/template.md` — completion report should use embed format
- `agents/researcher/CLAUDE.md` — research delivery should use embed format

Each agent gets a new section: "Rich Embeds — use `claudecord_reply` with an `embed` parameter for structured results."

Document the embed field contract in `docs/patterns/rich-embeds.md` so agents know exactly what fields to populate for each notification type.

---

**Relevant files for implementation:**

- `/tmp/claudecord-oss/src/daemon/discord.ts` — extend this first (Phase 3)
- `/tmp/claudecord-oss/src/daemon/http-api.ts` — new endpoints in Phase 2
- `/tmp/claudecord-oss/src/daemon/routing.ts` — dynamic routing in Phase 1
- `/tmp/claudecord-oss/src/daemon/index.ts` — wiring hub for all new modules
- `/tmp/claudecord-oss/src/shared/types.ts` — all new types start here
- `/tmp/claudecord-oss/src/shim/tools.ts` — embed schema extension
- `/tmp/claudecord-oss/src/shim/index.ts` — Zod schema + sendReply extension
- `/tmp/claudecord-oss/scripts/agents/spawn_teammate` — add curl call
- `/tmp/claudecord-oss/scripts/agents/kill_teammate` — add curl call
- `/tmp/claudecord-oss/.env.example` — new env vars