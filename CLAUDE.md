# Claudecord — Shared Agent Context

> All agents spawned inside `~/claudecord/` inherit this file. Keep it lean — agent-specific instructions go in each agent's own CLAUDE.md.

## Architecture
- **Daemon** (`src/daemon/`): Express HTTP API + Discord.js bot. Routes Discord messages to agents, relays agent replies back. PID at `~/.claudecord-daemon.pid`.
- **Shim** (`src/shim/`): MCP server declaring `claude/channel` capability. Polls daemon every 2s for messages. Exposes `claudecord_reply` tool.
- **Scripts** (`scripts/`): tmux-based agent lifecycle management.
- **Config** (`config/routing.json`): Channel ID → agent name mapping.
- **Agent dirs** (`agents/<name>/`): Each agent's CLAUDE.md, crons.md, state files.

## Inter-Agent Communication
| Method | Usage |
|--------|-------|
| `~/claudecord/scripts/send_message <name> <msg>` | Send message to another agent via tmux |
| `~/claudecord/scripts/message_lifeos <msg>` | Message the LifeOS manager directly |
| `claudecord_reply` MCP tool | Post to Discord (pass channel ID as `chat_id`) |

Messages arrive with envelope prefix: `[SENDER_NAME]: message`. Never impersonate another agent.

## Discord Channels
| Channel | ID | Owner |
|---------|----|-------|
| #lifeos | 1485084226926940307 | lifeos |
| #alerts | 1485084277203800145 | lifeos |
| #daily | 1485084342073163957 | lifeos |
| #investing | 1485688049051369592 | lifeos (stock-monitor posts here) |
| #code-status | 1485084317272244274 | coder agents |
| #trading | 1486573684918583306 | trader |
| #research | 1485084298982378106 | lifeos |

## Agent Lifecycle
- **Persistent agents** (trader, stock-monitor, monitor): long-running, have `crons.md`, self-compact when context > 60%.
- **Ephemeral agents** (coder-*, reviewer-*, coder-fix-*): spawned for a task, die when done. No crons, no state.

## Completion Protocol (Ephemeral Agents)
When your task is finished (PR created, review done, deploy complete), you MUST:
1. Post results to the relevant Discord channel (e.g. #code-status) via `claudecord_reply`
2. Message LifeOS with a summary: `~/claudecord/scripts/message_lifeos "Done. <what you did, PR link if any>"`
3. Run `/exit` to terminate your session — do NOT stay alive after completing your task

**Both steps 1-2 AND step 3 are required.** Agents that stay alive after finishing waste resources. Agents that skip `message_lifeos` leave LifeOS unaware of completion.

## Scripts Reference
| Script | Purpose |
|--------|---------|
| `spawn_teammate <name> <dir>` | Spawn agent in tmux pane |
| `send_message <name> <msg>` | Send message to agent |
| `kill_teammate <name>` | Stop an agent |
| `list_teammates` | Show all agents with liveness check |
| `agent_status [name]` | Show context % and status line |
| `capture_pane <name> [lines]` | Capture agent's terminal output |
| `reconcile_registry [--fix]` | Sync registry with tmux state |
| `message_lifeos <msg>` | Message LifeOS manager |
| `spawn_fix_coder <issue#>` | Spawn GSD coder to fix a GitHub issue |
| `batch_merge_deploy [PRs...]` | Merge PRs + deploy to VPS (or `--approved`) |

## Startup Checklist (Persistent Agents)
On every boot:
1. Read your `CLAUDE.md`
2. Read `crons.md` → recreate all crons with CronCreate
3. Read `state.md` if it exists → resume where you left off
4. Start working

## Self-Compaction (Persistent Agents)
When your context exceeds ~60%, compact:
1. Write current state to `state.md` (open positions, key findings, what to do next)
2. Post a brief status update to your Discord channel
3. Run `/clear` to reset context
4. On fresh boot, the startup checklist picks up from state.md

## Rules
- Tim's global coding standards apply (see `~/.claude/CLAUDE.md`)
- Never use plan mode or AskUserQuestion — Tim uses Discord, not the terminal
- Be concise in Discord posts — Tim reads on mobile
- LifeOS is the manager. If you need something outside your scope, message LifeOS.
