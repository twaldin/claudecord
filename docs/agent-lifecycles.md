# Agent Lifecycle Types (v2)

Agents in Claudecord have **two** lifecycle types, defined by channel behavior. The lifecycle determines whether the agent's Discord channel persists beyond the agent's runtime.

## 1. Persistent

Channel outlives the agent. Has state files and memory between sessions. Can be always-on, on-demand (spawned per task), or cron-scheduled — the defining trait is the channel persists.

**Examples:** orchestrator, trader, stock-monitor, monitor, evaluator, researcher

**Spawn:** System startup, manual `spawn_teammate`, or cron job (e.g., stock-monitor at market open).

**Death:** Manual `kill_teammate`, cron kill (e.g., stock-monitor at market close), or self-exit after task completion. On-demand persistent agents (evaluator, researcher) exit when done.

**Compaction:** Writes current state to `state.md` or `WORKING.md`, posts status update to Discord, runs `/clear`. On next boot, startup checklist reads state and resumes.

**Crash recovery:** `reconcile_agents` detects dead persistent agents and respawns them.

**Config:**
```json
{ "lifecycle": "persistent" }
```

**Channel:** Uses pre-configured channels from `config/routing.json`. No dynamic channel creation.

## 2. Ephemeral

Channel is born and dies with the agent. Spawned for a single task. No persistent state.

**Examples:** coder-fix-54, coder-pricing, one-off research tasks

**Spawn:** An orchestrator calls `spawn_teammate` for a specific task.

**Death:** Agent completes task, runs the completion protocol, then `/exit`.

**Completion protocol (required):**
1. Post results to relevant channel via `claudecord_reply`
2. Message the orchestrator with a summary via `scripts/message_lifeos`
3. Run `/exit`

**Config:**
```json
{ "lifecycle": "ephemeral" }
```

**Channel:** Dynamic Discord channel created on spawn, archived on kill. Cleanup embed posted with 📦 (keep) / 🗑️ (delete) reactions.

---

## reconcile_agents Behavior by Lifecycle

`scripts/reconcile_agents` checks the daemon's agent registry against live tmux windows:

| Lifecycle | Agent found dead | Agent found alive |
|-----------|-----------------|-------------------|
| `persistent` | Respawn immediately | No action |
| `ephemeral` | Prune registry entry — do NOT respawn | No action |

Rationale:
- Persistent agents must always be available; any unexpected death is recovered.
- Ephemeral agents completed their work (or crashed); respawning would re-run a finished or broken task.

---

## Channel Creation Policy

`channel-manager.ts` enforces that `createAgentChannel` is never called for persistent agents. Persistent agents use pre-configured channels defined in `config/routing.json`. Calling `createAgentChannel` with `agentType: 'persistent'` throws an error.

Only ephemeral agents get dynamically created Discord channels.

---

## Spawn Patterns (Not Lifecycles)

How an agent is spawned is independent of its lifecycle:

| Spawn Pattern | Description | Example |
|---------------|-------------|---------|
| **Always-on** | Runs continuously, self-compacts | trader, monitor |
| **On-demand** | Spawned fresh per task, exits when done | evaluator (per PR), researcher (per query) |
| **Cron-scheduled** | Spawned/killed by cron at fixed times | stock-monitor (market hours) |

All three patterns can be persistent (channel persists, state files kept). The spawn pattern determines WHEN the agent runs; the lifecycle determines WHAT HAPPENS TO ITS CHANNEL.

---

## Type Reference

```typescript
// src/shared/types.ts
export type AgentLifecycle = 'persistent' | 'ephemeral'

export interface AgentStateEntry {
  name: string
  lifecycle: AgentLifecycle
  type: AgentType          // 'coder' | 'researcher' | 'evaluator' | 'persistent'
  status: 'alive' | 'dead'
  model?: string           // 'opus' | 'sonnet' | 'haiku'
  channelId?: string
  contextPct?: number
  agentStatus?: string
  task?: string
}
```
