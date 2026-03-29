# Agent Lifecycle Types

Agents in Claudecord have three distinct lifecycle types. The type determines spawn/death behavior, channel creation, compaction, and crash recovery.

## 1. Persistent

Always alive. Survives restarts. Self-compacts when context grows.

**Examples:** orchestrator, trader, stock-monitor (when running), monitor

**Spawn:** System startup (`scripts/start.sh`) or manual `spawn_teammate`.

**Death:** Only via manual `kill_teammate` or system shutdown. Never self-exits.

**Compaction:** Writes current state to `WORKING.md` (open positions, key findings, next steps), posts status update to Discord, runs `/clear`. On next boot, startup checklist reads `WORKING.md` and resumes.

**Crash recovery:** `reconcile_registry` detects dead persistent agents and respawns them unconditionally.

**Config:**
```json
{ "lifecycle": "persistent" }
```

## 2. Scheduled

Spawned and killed on a defined time schedule. May also self-exit when their task finishes within the window.

**Examples:** stock-monitor (market hours only), weekly-reviewer

**Spawn:** A cron job calls `spawn_teammate` at the configured spawn time.

**Death:** A cron job calls `kill_teammate` at the configured kill time, or the agent self-exits after completing its task.

**Config:**
```json
{
  "lifecycle": "scheduled",
  "schedule": {
    "spawn": "25 9 * * 1-5",
    "kill": "5 16 * * 1-5"
  }
}
```

**Channel creation:** A dedicated Discord channel is created when the agent spawns and archived when it dies, same as ephemeral agents.

## 3. Ephemeral

Spawned for a single task. Dies when the task is complete.

**Examples:** coder-fix-54, researcher-spacex, evaluator

**Spawn:** An orchestrator (e.g., lifeos) calls `spawn_teammate` for a specific task.

**Death:** Agent completes task, runs the completion protocol, then `/exit`.

**Completion protocol (required):**
1. Post results to `#code-status` and any other relevant channels via `claudecord_reply`
2. Message the orchestrator with a summary via `scripts/message_orchestrator`
3. Run `/exit`

**Config:**
```json
{ "lifecycle": "ephemeral" }
```

---

## reconcile_registry Behavior by Lifecycle

`scripts/reconcile_registry` checks live tmux panes against `registry.tsv` entries. Its action depends on lifecycle type:

| Lifecycle | Agent found dead | Agent found alive |
|-----------|-----------------|-------------------|
| `persistent` | Respawn immediately | No action |
| `scheduled` | Check if within schedule window; respawn if yes, prune if no | No action |
| `ephemeral` | Prune registry entry — do NOT respawn | No action |

Rationale:
- Persistent agents must always be running; any gap is unintended.
- Scheduled agents have a defined window; respawning outside it would be incorrect.
- Ephemeral agents completed their work (or crashed); respawning would re-run a finished or broken task.

---

## Channel Creation Policy

`channel-manager.ts` enforces that `createAgentChannel` is never called for persistent agents. Persistent agents use pre-configured channels defined in `config/routing.json`. Calling `createAgentChannel` with `agentType: 'persistent'` throws an error.

Only ephemeral and scheduled agents get dynamically created Discord channels.

---

## Type Reference

```typescript
// src/shared/agent-lifecycle.ts
export type AgentLifecycle = 'persistent' | 'scheduled' | 'ephemeral'

export interface AgentDefinition {
  name: string
  lifecycle: AgentLifecycle
  type: AgentType          // 'coder' | 'researcher' | 'evaluator' | 'persistent'
  model?: string           // 'opus' | 'sonnet' | 'haiku'
  schedule?: {
    spawn: string          // cron expression
    kill: string           // cron expression
  }
  completionProtocol?: {
    postTo: string[]       // Discord channel IDs
    messageOrchestrator: boolean
    autoExit: boolean
  }
}
```
