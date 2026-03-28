# Claudecord — Shared Agent Context

> All agents spawned inside the Claudecord directory inherit this file. Keep it lean — agent-specific instructions go in each agent's own CLAUDE.md.

## Architecture

- **Daemon** (`src/daemon/`): Express HTTP API + Discord.js bot. Routes Discord messages to agents, relays agent replies back. PID at `~/.claudecord-daemon.pid`.
- **Shim** (`src/shim/`): MCP server declaring `claude/channel` capability. Polls daemon every 2s for messages. Exposes `claudecord_reply` tool.
- **Scripts** (`scripts/`): tmux-based agent lifecycle management.
- **Config** (`config/routing.json`): Channel ID → agent name mapping.
- **Agent dirs** (`agents/<name>/`): Each agent's CLAUDE.md, crons.md, state files.

## How Agents Communicate

| Method | Usage |
|--------|-------|
| `claudecord_reply` MCP tool | Post a message to Discord (pass channel ID as `chat_id`) |
| `send_message <name> <msg>` | Send a message to another agent via tmux |
| `message_orchestrator <msg>` | Message the orchestrator (your manager) directly |

Messages from Discord arrive via the MCP shim as tool input. Agents reply with `claudecord_reply`.

Messages arrive with envelope prefix: `[SENDER_NAME]: message`. Never impersonate another agent.

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `spawn_teammate <name> <dir>` | Spawn an agent in a tmux pane |
| `spawn_teammate <name> --project <dir>` | Spawn an ephemeral coder in a worktree |
| `send_message <name> <msg>` | Send a message to another agent |
| `kill_teammate <name>` | Stop an agent |
| `list_teammates` | Show all agents with liveness check |
| `agent_status [name]` | Show context % and status line |
| `capture_pane <name> [lines]` | Capture an agent's terminal output |
| `reconcile_registry [--fix]` | Sync registry with tmux state |
| `message_orchestrator <msg>` | Message the orchestrator |

## Completion Protocol (Ephemeral Agents)

When your task is finished (PR created, review done, deploy complete), you MUST:

1. Post results to the relevant Discord channel (e.g. #code-status) via `claudecord_reply`
2. Message the orchestrator: `message_orchestrator "Done. <what you did, PR link if any>"`
3. Run `/exit` to terminate — do NOT stay alive after completing your task

**All three steps are required.** Agents that stay alive waste resources. Agents that skip `message_orchestrator` leave the orchestrator unaware of completion.

## Agent Lifecycle

- **Persistent agents** (orchestrator, evaluator, researcher, architect): long-running, have `crons.md`, self-compact when context > 60%.
- **Ephemeral agents** (coder-*, reviewer-*): spawned for a task, die when done. No crons, no state.

## Startup Checklist (Persistent Agents)

On every boot:

1. Read your `CLAUDE.md`
2. Read `crons.md` → recreate all crons with CronCreate
3. Read `state.md` if it exists → resume where you left off
4. Start working

## Self-Compaction (Persistent Agents)

When your context exceeds ~60%, compact:

1. Write current state to `state.md` (open work, key findings, what to do next)
2. Post a brief status update to your Discord channel
3. Run `/clear` to reset context
4. On fresh boot, the startup checklist picks up from `state.md`

## Rules

- Never use plan mode or AskUserQuestion — users read Discord, not the terminal
- Be concise in Discord posts — users read on mobile
- The orchestrator is the manager. If you need something outside your scope, use `message_orchestrator`.
- No `as any` or `as unknown as` casts in TypeScript
