# Agent Lifecycle v2 — Channel-Defined Model

*Written 2026-03-29. Supersedes the 3-type model (persistent/scheduled/ephemeral) from Core Spec v1.*

---

## The Rule

An agent's lifecycle is defined by its relationship to its Discord channel.

| Lifecycle | Channel behavior | Memory | Examples |
|-----------|-----------------|--------|----------|
| **Ephemeral** | Channel created on spawn, archived on kill | None — fresh context every time | coder-fix-61, researcher-spacex |
| **Persistent** | Channel exists before agent, survives after agent exits | state.md, past history in channel | evaluator, monitor, researcher, trader, stock-monitor |

That's it. Two types.

---

## Ephemeral Agents

**Channel:** Born and dies with the agent. Created by daemon on spawn, archived on kill with 📦/🗑️ cleanup reactions.

**Memory:** None. Each spawn is a blank slate. The task prompt contains all needed context.

**Spawn pattern:** On-demand by orchestrator.

**Exit:** Completion protocol (post results → message orchestrator → /exit). Reconcile detects exited agents and archives channels.

**Examples:**
- `coder-fix-61` — spawned for a specific PR, gets a #coder-fix-61 channel, does the work, exits
- `researcher-spacex` — spawned for a one-off research task, gets its own channel, posts findings, exits

---

## Persistent Agents

**Channel:** Pre-configured in routing.json. The channel exists independently of whether the agent is running. Multiple agent sessions post to the same channel over time, building a readable history.

**Memory:** `agents/<name>/state.md` persists across sessions. Agent reads it on boot, writes it before exit. The Discord channel itself is also memory — past embeds, reports, and conversations are visible.

**Spawn patterns** (all valid for persistent agents):
- **Always-on:** Orchestrator (LifeOS/cairn). Runs continuously, self-compacts.
- **Scheduled:** Stock-monitor. Spawned by cron at market open, killed at close. Channel persists between sessions.
- **On-demand:** Evaluator, researcher. Spawned when there's work (PR to review, topic to research). Channel accumulates history across sessions. Killed when task complete.

**Exit:** Save state.md → post summary to channel → exit (or get killed by cron/orchestrator). Channel stays. Next session picks up where this one left off.

**Examples:**
- `evaluator` → #evals — spawned per PR, reads state.md (past reviews, known patterns), reviews, saves state, exits. #evals has the full review history.
- `monitor` → #code-status — always-on, posts health checks. Self-compacts at high context.
- `stock-monitor` → #investing — spawned 9:25 AM, killed 4:05 PM. #investing accumulates daily price updates.
- `trader` → #trading — always-on during active markets, posts position updates.
- `researcher` → #research — spawned when research is needed, posts findings, exits.

---

## What Changed from v1

| v1 | v2 | Why |
|----|-----|-----|
| 3 lifecycles: persistent, scheduled, ephemeral | 2 lifecycles: persistent, ephemeral | Scheduled is just a spawn pattern, not a separate type |
| Persistent = always running | Persistent = has a permanent channel + memory | Evaluator and researcher don't need to idle |
| `AgentLifecycle = 'persistent' \| 'scheduled' \| 'ephemeral'` | `AgentLifecycle = 'persistent' \| 'ephemeral'` | Simpler type, cleaner code |
| Channel creation: persistent=never, scheduled/ephemeral=always | Channel creation: persistent=never (pre-configured), ephemeral=always (created on spawn) | Same behavior, fewer categories |

---

## Channel Setup

### Persistent channels (create once, in routing.json)

| Channel | Agent(s) | Purpose |
|---------|----------|---------|
| #main / #lifeos | orchestrator | User messages, coordination |
| #alerts | orchestrator | Urgent notifications |
| #daily | orchestrator | Briefings, reflections |
| #code-status | monitor | System health, deploy status |
| #evals | evaluator | PR review history |
| #research | researcher | Research reports |
| #investing | stock-monitor | Portfolio updates |
| #trading | trader | Prediction market positions |

### Ephemeral channels (auto-created per agent)

Created under category folders (Coders, Research, Reviews). Archived with cleanup reactions on agent death.

---

## Implementation Changes

### TypeScript
```ts
// Before
type AgentLifecycle = 'persistent' | 'scheduled' | 'ephemeral'

// After
type AgentLifecycle = 'persistent' | 'ephemeral'
```

### Daemon spawn handler
- `lifecycle === 'persistent'` → skip channel creation (uses routing.json)
- `lifecycle === 'ephemeral'` → create channel (same as before)
- No `scheduled` case needed

### Scripts
- `spawn_teammate --lifecycle persistent` → for evaluator, researcher, monitor, trader, stock-monitor
- `spawn_teammate --lifecycle ephemeral` → for coders, one-off tasks
- Default remains `ephemeral`

### Crons
- Stock-monitor spawn cron: `--lifecycle persistent` (channel persists, agent is scheduled)
- Evaluator: spawned on-demand by orchestrator with `--lifecycle persistent`

### routing.json
- Add `#evals` channel for evaluator
- Keep all existing persistent channels
