# Claudecord Core Spec v1

*Written 2026-03-28. This is the authoritative design document for the Claudecord framework.*

---

## 0. Design Principles

1. **Daemon is the authority.** All agent state lives in daemon memory. Scripts push events to the daemon via HTTP; they never write state files directly.
2. **One file, one owner.** `~/.claudecord-agent-state.json` is the only persistent agent registry. The daemon writes it; nothing else does.
3. **Observability reads from memory.** Status board, slash commands, and `GET /agents` all read daemon in-memory state. No file parsing on the hot path.
4. **Failures are logged, not silently dropped.** Every step in spawn/kill that can fail logs the error and returns a clear HTTP status. No silent swallowing.
5. **Atomicity via ordering.** Steps that can't be rolled back (tmux window creation) happen before steps with side effects (Discord channel creation). If Discord fails, the agent still has a window and can work; the missing channel is an observable gap, not silent corruption.

---

## 1. Agent State — Single Source of Truth

### 1.1 The Authority

The daemon's **in-memory agent registry** is the single source of truth for all agent state. It is populated at startup from `~/.claudecord-agent-state.json` and updated in real time as agents spawn, die, and send heartbeats.

All other state stores are subordinate:

| Store | Role | Owner |
|---|---|---|
| `~/.claudecord-agent-state.json` | Durable backup of daemon memory | Daemon (writes only) |
| `config/routing.json` | Static channel config for persistent agents | Operator (hand-edited) |
| `~/.claudecord-channels.json` | Channel lifecycle details (cleanup reactions, scheduled deletes) | ChannelManager (internal) |
| `registry.tsv` | **Deprecated.** Replaced by agent-state.json. | — |

`registry.tsv` is no longer written or read by any component after this spec is implemented.

### 1.2 Agent State Entry Schema

```typescript
interface AgentStateEntry {
  name: string                  // unique identifier, matches tmux window name
  lifecycle: AgentLifecycle     // 'persistent' | 'ephemeral' (v2 — scheduled removed)
  type: AgentType               // 'coder' | 'researcher' | 'evaluator' | 'persistent'
  status: 'alive' | 'dead'
  directory: string             // absolute path where claude runs
  spawnedAt: string             // ISO 8601
  diedAt: string | null         // ISO 8601, set on death
  model: 'opus' | 'sonnet' | 'haiku'
  channelId: string | null      // Discord channel ID; null for pre-configured persistent agents
  contextPct: number | null     // last heartbeat value; null if no heartbeat received
  agentStatus: 'idle' | 'working' | 'compacting' | 'dead' | null
  task: string | null           // task description (ephemeral and on-demand persistent agents)
  shimConnected: boolean        // true once shim calls POST /register
  lastHeartbeatAt: string | null // ISO 8601 timestamp of last heartbeat; null if none received
}
```

### 1.3 agent-state.json File Format

```json
{
  "schemaVersion": 1,
  "agents": {
    "coder-fix-49": { ...AgentStateEntry },
    "trader":        { ...AgentStateEntry }
  }
}
```

File is written atomically: write to `.tmp`, then `rename`. The daemon is the only writer.

### 1.4 Write Owners

| Event | Who calls | Effect on agent-state |
|---|---|---|
| `POST /agent/spawn` | `spawn_teammate` script | Creates entry, status: 'alive' |
| `POST /agent/died` | `kill_teammate` script | Sets status: 'dead', diedAt |
| `POST /agent/heartbeat` | Shim (every 30s) | Updates contextPct, agentStatus |
| `POST /register` | Shim (on boot) | Sets shimConnected: true |

### 1.5 Daemon Startup Hydration

On daemon start:

1. Load `~/.claudecord-agent-state.json` → populate in-memory registry
2. Load `config/routing.json` → for persistent agents listed there but absent from agent-state, create synthetic entries with `lifecycle: 'persistent'`, `channelId` from routing config, `status: 'alive'`, and `shimConnected: false`
3. Build in-memory routing table: all alive entries with a `channelId` → `{ channelId → agentName }`
4. Begin accepting HTTP traffic

Synthetic entries from step 2 are held in memory only until the agent's shim connects and the agent calls `POST /register` or `POST /agent/heartbeat`, at which point a real entry is persisted to agent-state.json.

---

## 2. Spawn Flow

### 2.1 Sequence

```
spawn_teammate <name> <dir> [--model M] [--task T] [--type T] [--lifecycle L]
```

**Step 1 — Script validation**
- `name` is non-empty and matches `/^[a-z0-9-]{1,80}$/`
- `dir` exists on disk
- tmux session `claudecord` exists
- `type` defaults to `coder`; `lifecycle` defaults to `ephemeral`

**Step 2 — Create tmux window**
```bash
tmux new-window -t claudecord -n <name> -c <dir> \
  "export CLAUDECORD_AGENT_NAME='<name>'; \
   export PATH=\"$HOME/claudecord/scripts:$PATH\"; \
   claude --dangerously-load-development-channels server:claudecord \
          --dangerously-skip-permissions --model <model> 2>&1; \
   echo '[AGENT <name> EXITED]'; read"
```
Sleep 3s, send Enter to clear any dev-channel prompt. If `--task` provided, sleep 2s then send task text + Enter.

*This step is irreversible. If any later step fails, the window exists and the agent will boot — it just won't have a Discord channel yet.*

**Step 3 — Register with daemon**
```http
POST /agent/spawn
{
  "agentName": "<name>",
  "agentType": "<type>",
  "lifecycle": "<lifecycle>",
  "task": "<task>",
  "model": "<model>",
  "directory": "<dir>",
  "worktreePath": "<dir>",   // optional
  "issueNumber": <n>,        // optional
  "prNumber": <n>            // optional
}
```

**Step 4 — Daemon handles spawn**

```
a. Validate: agentName, agentType, lifecycle are present and valid
b. Check: no alive entry for agentName → 409 Conflict if duplicate
c. Create AgentStateEntry { status: 'alive', shimConnected: false, channelId: null, ... }
d. Persist agent-state.json (atomic write)
e. If lifecycle != 'persistent':
     channelId = await channelManager.createAgentChannel(name, type, task)
     → creates Discord channel under appropriate category
     → posts spawn embed to new channel
     → updates ChannelLifecycle in channel-state.json
   Update in-memory routing: channelId → agentName
   Update agent-state entry: channelId = channelId
   Persist agent-state.json
f. Post spawn summary embed to #code-status channel
g. Return { ok: true, channelId }
```

If step (e) fails (Discord API error): log `[spawn] channel creation failed for <name>: <error>`, return `{ ok: true, channelId: null, warning: 'channel creation failed' }`. Agent is alive but has no channel — operator must investigate.

**Step 5 — Script receives response**

Prints `Spawned <name> (<lifecycle>, <model>) at <dir>` (with channel link if channelId returned).

**Step 6 — Status board picks up on next tick**

Status board calls `getSnapshot()` which reads daemon in-memory registry. New agent appears within ≤60s.

### 2.2 What Makes It "Atomic"

There is no two-phase rollback. Instead:
- Failure before Step 2: nothing created, error returned
- Failure at Step 2: window exists, no daemon entry — reconcile will find this as UNREGISTERED
- Failure at Step 4d (disk write): in-memory entry exists, disk write failed — daemon logs error; next successful heartbeat will re-trigger a persist
- Failure at Step 4e (Discord): agent alive with no channel — surfaced in status board as `no channel`

Every failure state is observable. None silently corrupts state.

---

## 3. Kill Flow

### 3.1 Sequence

```
kill_teammate <name>
```

**Step 1 — Script validation**
- `name` is non-empty
- Name is not the orchestrator (`lifeos` or the configured orchestrator name)

**Step 2 — Notify daemon**
```http
POST /agent/died
{ "agentName": "<name>" }
```

**Step 3 — Daemon handles death**

```
a. Find entry for agentName → 404 if not found
b. Set entry.status = 'dead', entry.diedAt = now
c. Set entry.agentStatus = 'dead', entry.contextPct = null
d. Persist agent-state.json
e. If entry.channelId exists:
     channelManager.archiveAgentChannel(channelId, agentName)
     → sets Discord channel read-only (deny @everyone SendMessages)
     → posts cleanup embed with 📦 / 🗑️ reactions
     → updates channel-state.json: status → 'archived', diedAt set
f. Remove channelId → agentName from in-memory routing
g. Return { ok: true }
```

If step (e) fails: log `[kill] archive failed for <name>: <error>`, still return `{ ok: true }`. Channel is left active — visible inconsistency surfaced in Discord.

**Step 4 — Script kills tmux window**
```bash
tmux kill-window -t claudecord:<name> 2>/dev/null || true
```

**Step 5 — Script prints confirmation**

`Killed <name>`

### 3.2 Self-Exit (Ephemeral Completion Protocol)

Ephemeral agents that complete their task do NOT call `kill_teammate`. They run the completion protocol:

1. `claudecord_reply` — post results to their channel and/or `#code-status`
2. `scripts/message_orchestrator "Done. <summary>"` — notify orchestrator
3. `/exit` — Claude session exits

When Claude exits, the tmux window stays open (shows `[AGENT <name> EXITED]`). `reconcile_agents` (run periodically or by the operator) detects window-alive + claude-dead → calls `POST /agent/died` → daemon archives channel → status board updates.

*Rationale: ephemeral agents cannot reliably make HTTP calls at the moment `/exit` runs.*

---

## 4. Communication Patterns

### 4.1 Discord → Agent

```
1. discord.js fires messageCreate
2. routing.resolveAgent(inMemoryConfig, channelId) → agentName
3. ChannelMessage pushed to per-agent in-memory queue
4. Shim polls GET /messages/:agentName every 2s
5. Daemon dequeues, returns { messages: [...] }
6. Shim emits notifications/claude/channel into Claude's context
```

Messages arriving before the shim connects are buffered. On `POST /register`, the daemon returns `{ bufferedMessages: N }` so the shim knows to poll immediately.

### 4.2 Agent → Discord

```
1. Agent calls claudecord_reply MCP tool: { chat_id, text?, embed?, reply_to? }
2. Shim POSTs to POST /reply { channelId, text?, embed?, replyTo? }
3. Daemon calls discord.sendToChannel or discord.sendEmbed
```

### 4.3 Agent → Agent

```
scripts/send_message <targetName> "<message>"
  → tmux send-keys -t claudecord:<targetName> "<message>" Enter
```

Messages are prefixed with `[<SENDER_NAME>]: ` by convention. Never impersonate another agent.

### 4.4 Agent → Orchestrator

```
scripts/message_orchestrator "<message>"
  → tmux send-keys -t claudecord:<orchestratorWindow> "<message>" Enter
```

The orchestrator window name is configured in the script (default: first window / `lifeos`).

### 4.5 Heartbeat (Shim → Daemon)

The shim sends a heartbeat every 30 seconds:

```http
POST /agent/heartbeat
{
  "agentName": "<name>",
  "contextPct": <0-100>,
  "status": "idle | working | compacting | dead"
}
```

Daemon updates the in-memory entry and persists agent-state.json. Status board reflects the new values on the next tick. If a heartbeat fails (daemon unreachable), the shim logs a warning and continues — it does not crash.

---

## 5. Agent Lifecycle Types

### 5.1 Persistent

Always alive. Survives restarts. Has dedicated, pre-configured Discord channels in `config/routing.json`.

**Spawn:** `scripts/start.sh` or manual `spawn_teammate`. Calls `POST /agent/spawn` with `lifecycle: 'persistent'`. Daemon creates a state entry but does NOT create a new Discord channel.

**Death:** Only via `kill_teammate` or full system shutdown. Never self-exits.

**Compaction:** When context > ~60%:
1. Write current state to `agents/<name>/state.md`
2. `claudecord_reply` — post brief status update to own channel
3. `/clear` — resets context
4. On next boot, startup checklist reads `state.md` and resumes

**Crash recovery:** `reconcile_agents --fix` detects window-dead persistent agents and respawns via `spawn_teammate`. This can be run periodically via cron.

**Channel policy:** Uses pre-configured channels. `createAgentChannel` throws if called for a persistent agent.

### 5.2 Ephemeral

Spawned for a single task. Dies when the task is complete.

**Spawn:** Orchestrator calls `spawn_teammate` with `lifecycle: 'ephemeral'`. Daemon creates a channel.

**Death:** Agent runs the completion protocol and `/exit`. `reconcile_agents` cleans up the dead window.

**reconcile behavior:** If found dead → mark dead in daemon, archive channel. Never respawn.

---

## 6. Observability

### 6.1 Status Board

- **Module:** `src/daemon/status-board.ts`
- **Source:** daemon in-memory agent registry (`getSnapshot()`)
- **Frequency:** edits a single Discord embed every 60s
- **Content:** all agents with `status: 'alive'`, showing name, type, agentStatus, contextPct, channel link

`buildSnapshot()` reads from the daemon's agent registry directly — no file I/O, no merging of multiple sources. It includes:
- All alive entries from agent-state.json (loaded into memory at startup)
- Any synthetic persistent-agent entries bootstrapped from routing.json

### 6.2 GET /agents

New endpoint. Returns current agent registry for external scripts:

```http
GET /agents
→ {
    "agents": [
      {
        "name": "trader",
        "lifecycle": "persistent",
        "status": "alive",
        "agentStatus": "working",
        "contextPct": 42,
        "channelId": "...",
        "spawnedAt": "..."
      }
    ]
  }
```

### 6.3 reconcile_agents

Renamed from `reconcile_registry`. Updated to use daemon endpoints instead of registry.tsv.

```bash
reconcile_agents [--fix]

1. GET /agents → daemon's view of alive agents
2. tmux list-windows → actual running windows
3. For each alive agent in daemon:
   a. No tmux window → stale entry
      - lifecycle == 'persistent': respawn via spawn_teammate (if --fix)
      - lifecycle == 'ephemeral': POST /agent/died (if --fix)
4. For each tmux window running claude:
   a. Not in daemon alive list → UNREGISTERED, report only
5. Print summary
```

### 6.4 agent_status Script

Reads from `GET /agents` for context% and status. No tmux pane scraping for registered agents (fallback to tmux scrape for unregistered windows).

### 6.5 Heartbeat as Health Signal

If an agent's last heartbeat is > 5 minutes ago, the status board marks it `stale`. The daemon does not automatically kill stale agents — that's the operator's call via `/kill` or `kill_teammate`.

---

## 7. Error Handling

| Failure | Behavior |
|---|---|
| Spawn: tmux create fails | Script exits with error before calling daemon. Nothing created. |
| Spawn: daemon unreachable | Script logs warning, prints `WARNING: daemon unreachable — agent spawned without channel`. Agent runs; has no Discord channel. |
| Spawn: Discord channel creation fails | Daemon logs error, returns `{ ok: true, warning }`. Agent is alive, channelId null, shows as `no channel` in status board. |
| Spawn: agent-state.json write fails | Daemon logs error. In-memory state is correct. Next persist attempt triggered by heartbeat. |
| Kill: daemon unreachable | Script kills tmux window anyway. Agent dies silently. reconcile_agents will find the discrepancy. |
| Kill: Discord archive fails | Daemon logs error, returns ok. Channel left active. Visible inconsistency. |
| Heartbeat: daemon unreachable | Shim logs warning, continues polling. No crash. |
| Daemon restart | Reloads agent-state.json. Alive agents continue running; shims reconnect on next poll cycle. |

---

## 8. Directory Structure

```
~/claudecord/                             # Framework root (git repo)
├── src/
│   ├── daemon/                           # Express + discord.js daemon
│   │   ├── index.ts                      # Wiring: discord, http-api, channel-manager, status-board
│   │   ├── http-api.ts                   # REST endpoints + in-memory agent registry
│   │   ├── channel-manager.ts            # Discord channel lifecycle (create/archive/cleanup)
│   │   ├── routing.ts                    # channelId → agentName resolution
│   │   ├── status-board.ts               # Self-editing Discord embed
│   │   ├── slash-commands.ts             # /spawn /kill /status /tasks /habits /stats
│   │   ├── embeds.ts                     # Embed builders (spawn, cleanup, status, heartbeat)
│   │   └── stats.ts                      # Event statistics (pure fns over stats.json)
│   ├── shim/
│   │   ├── index.ts                      # MCP server entry point
│   │   └── tools.ts                      # claudecord_reply tool + message poller
│   └── shared/
│       ├── types.ts                      # Shared TypeScript types
│       └── agent-lifecycle.ts            # AgentLifecycle type + lifecycle helper fns
├── scripts/
│   ├── spawn_teammate                    # Create tmux window + POST /agent/spawn
│   ├── kill_teammate                     # POST /agent/died + kill tmux window
│   ├── reconcile_agents                  # Sync daemon state vs tmux reality
│   ├── send_message                      # tmux send-keys to named agent
│   ├── message_orchestrator              # send_message shortcut to orchestrator
│   ├── list_teammates                    # GET /agents → formatted list
│   ├── agent_status                      # GET /agents → single agent detail
│   ├── capture_pane                      # tmux capture-pane for named agent
│   └── start.sh                          # Boot daemon + persistent agents
├── config/
│   └── routing.json                      # Persistent agent channel config (hand-edited)
├── agents/
│   ├── <name>/
│   │   ├── CLAUDE.md                     # Agent instructions + startup checklist
│   │   ├── .mcp.json                     # MCP server config (declares claudecord shim)
│   │   ├── state.md                      # Self-compaction state (persistent agents only)
│   │   └── crons.md                      # Spawn/kill schedule (persistent/scheduled only)
│   └── coder-template.md                 # Ephemeral coder bootstrap template
└── docs/
    ├── core-spec.md                      # This document
    ├── architecture.md                   # Component deep-dives, data flows
    ├── agent-lifecycles.md               # Lifecycle type reference
    └── patterns/                         # Specific implementation patterns

~/.claudecord-daemon.pid                  # Daemon PID (written on start, removed on shutdown)
~/.claudecord-agent-state.json            # Canonical agent registry (daemon writes only)
~/.claudecord-channels.json              # Channel lifecycle state (channel-manager writes only)
~/.claudecord-stats.json                  # Event statistics

~/ainame/                                 # User's orchestrator (outside framework, not in repo)
```

### routing.json stays read-only at runtime

`config/routing.json` is the static config for persistent agents. Ephemeral agent channel IDs live in agent-state.json. The channel-manager no longer mutates routing.json at spawn time — routing for ephemeral agents is derived from the in-memory agent registry.

---

## 9. Implementation Delta

What changes from today's code to implement this spec:

| Area | Change |
|---|---|
| `http-api.ts` | Agent registry moves from `registeredAgents: Set<string>` to `agentRegistry: Map<string, AgentStateEntry>`. New `GET /agents`. `POST /agent/spawn` creates full entry. `POST /agent/heartbeat` persists state. |
| `index.ts` | `buildSnapshot()` reads from agentRegistry instead of merging 3 sources. Load agent-state.json at startup. |
| `routing.ts` | Remove `addAgentChannel` mutation of routing.json. Ephemeral routing derived from agentRegistry. |
| `channel-manager.ts` | Remove `addAgentChannel` call. ChannelManager no longer touches routing.json. |
| `src/shim/index.ts` | Add 30s heartbeat timer alongside 2s message poll. |
| `scripts/spawn_teammate` | Add `--lifecycle` flag. Remove registry.tsv write. |
| `scripts/kill_teammate` | Remove `sed` on registry.tsv. |
| `scripts/reconcile_registry` | Rename to `reconcile_agents`. Replace file reads with `GET /agents`. |
| `scripts/list_teammates` | Replace registry.tsv parse with `GET /agents`. |
| `scripts/agent_status` | Replace tmux-only scrape with `GET /agents` primary. |
| `registry.tsv` | Deprecated. Remove file. |
