# Claudecord

## First-Run Check

**Do this before anything else.** Run:

```bash
grep -c "^DISCORD_TOKEN=." .env 2>/dev/null || echo 0
```

- **Result `0`:** Follow [First-Time Setup](#first-time-setup) below.
- **Result `1`+:** Skip to [Agent Context](#agent-context).

---

## First-Time Setup

You are helping a new user configure Claudecord. Walk through each step conversationally — ask one question at a time, wait for the answer, then move to the next step. Do not rush ahead.

### Step 1 — Name your AI

Ask:

> Welcome to Claudecord! What would you like to name your AI assistant?
> (This becomes your orchestrator's identity and home directory — e.g. `jarvis`, `aria`, `atlas`. Lowercase, no spaces.)

Store the answer as `AI_NAME`.

### Step 2 — Discord Bot Token

Tell the user:

> I need a Discord bot token. Here's how to get one:
>
> 1. Go to https://discord.com/developers/applications
> 2. Click **New Application** → name it after your AI
> 3. Go to **Bot** tab → **Reset Token** → copy the token
> 4. Under **Privileged Gateway Intents**, enable:
>    - Message Content Intent
>    - Server Members Intent
> 5. Go to **OAuth2** → **URL Generator**
>    - Scopes: `bot`, `applications.commands`
>    - Bot Permissions: Send Messages, Manage Channels, Manage Roles, Add Reactions, Read Message History, Embed Links
> 6. Copy the generated URL → open it in a browser → invite the bot to your server

Ask: "Paste your bot token:"

Store as `DISCORD_TOKEN`.

### Step 3 — Anthropic API Key

Ask: "Paste your Anthropic API key (starts with `sk-ant-`):"

Store as `ANTHROPIC_API_KEY`.

### Step 4 — Discord Server ID

Tell the user:

> Enable Developer Mode in Discord: **Settings → Advanced → Developer Mode**. Then right-click your server icon and choose **Copy Server ID**.

Ask: "What's your Discord server ID?"

Store as `GUILD_ID`.

### Step 5 — Discord Channels

Tell the user:

> Create these channels in your Discord server, then right-click each one and choose **Copy Channel ID**:
>
> - `#main` — your AI's inbox (messages here go to the orchestrator)
> - `#alerts` — urgent notifications
> - `#code-status` — agent task updates and PR summaries
> - `#status` — live agent dashboard (auto-updates)

Ask for each in sequence:

1. "Paste the `#main` channel ID:" → store as `CHANNEL_MAIN`
2. "Paste the `#alerts` channel ID:" → store as `CHANNEL_ALERTS`
3. "Paste the `#code-status` channel ID:" → store as `CHANNEL_CODE_STATUS`
4. "Paste the `#status` channel ID:" → store as `CHANNEL_STATUS`

### Step 6 — Choose Agent Types

Ask:

> Which agent types do you want?
>
> - **coder** — spawned per coding task, writes tests, opens PRs, exits when done
> - **evaluator** — reviews PRs adversarially, triggers deploys
> - **researcher** — web research and structured reports
> - **reviewer** — full codebase audits on demand
>
> Type agent names comma-separated, or `all`:

Store as `AGENTS` (treat empty or `all` as `coder,evaluator,researcher,reviewer`).

### Step 7 — Run Setup

Say: "Setup complete! Creating your AI team now..."

Run the setup wizard with all collected values substituted in:

```bash
WIZARD_AI_NAME="<AI_NAME>" \
WIZARD_DISCORD_TOKEN="<DISCORD_TOKEN>" \
WIZARD_ANTHROPIC_KEY="<ANTHROPIC_API_KEY>" \
WIZARD_GUILD_ID="<GUILD_ID>" \
WIZARD_CHANNEL_MAIN="<CHANNEL_MAIN>" \
WIZARD_CHANNEL_ALERTS="<CHANNEL_ALERTS>" \
WIZARD_CHANNEL_CODE_STATUS="<CHANNEL_CODE_STATUS>" \
WIZARD_CHANNEL_STATUS="<CHANNEL_STATUS>" \
WIZARD_AGENTS="<AGENTS>" \
bash scripts/tools/setup_wizard
```

---

## Agent Context

> All agents spawned inside the Claudecord directory inherit this file. Keep it lean — agent-specific instructions go in each agent's own CLAUDE.md.

### Architecture

- **Daemon** (`src/daemon/`): Express HTTP API + Discord.js bot. Routes Discord messages to agents, relays agent replies back. PID at `~/.claudecord-daemon.pid`.
- **Shim** (`src/shim/`): MCP server declaring `claude/channel` capability. Polls daemon every 2s for messages. Exposes `claudecord_reply` tool.
- **Scripts** (`scripts/`): tmux-based agent lifecycle management.
- **Config** (`config/routing.json`): Channel ID → agent name mapping.
- **Agent dirs** (`agents/<name>/`): Each agent's CLAUDE.md, crons.md, state files.

### Inter-Agent Communication

| Method | Usage |
|--------|-------|
| `claudecord_reply` MCP tool | Post to Discord (pass channel ID as `chat_id`) |
| `scripts/send_message <name> <msg>` | Send message to another agent via tmux |
| `scripts/message_orchestrator <msg>` | Message the orchestrator directly |

Messages arrive with envelope prefix: `[SENDER_NAME]: message`. Never impersonate another agent.

### Agent Lifecycle

- **Persistent agents** (orchestrator, evaluator, researcher): long-running, have `crons.md`, self-compact when context > 60%.
- **Ephemeral agents** (coder-*, reviewer-*): spawned for a task, die when done. No crons, no state.

### Completion Protocol (Ephemeral Agents)

When your task is finished, you MUST:

1. Post results to the relevant Discord channel via `claudecord_reply`
2. Run `scripts/message_orchestrator "Done. <what you did, PR link if any>"`
3. Run `/exit` — do NOT stay alive after completing your task

All three steps are required.

### Scripts Reference

| Script | Purpose |
|--------|---------|
| `spawn_teammate <name> <dir>` | Spawn agent in tmux pane |
| `send_message <name> <msg>` | Send message to agent |
| `kill_teammate <name>` | Stop an agent |
| `list_teammates` | Show all agents with liveness check |
| `agent_status [name]` | Show context % and status line |
| `capture_pane <name> [lines]` | Capture agent's terminal output |
| `reconcile_registry [--fix]` | Sync registry with tmux state |
| `message_orchestrator <msg>` | Message the orchestrator |

### Startup Checklist (Persistent Agents)

On every boot:

1. Read your `CLAUDE.md`
2. Read `crons.md` → recreate all crons with CronCreate
3. Read `state.md` if it exists → resume where you left off
4. Start working

### Self-Compaction (Persistent Agents)

When your context exceeds ~60%:

1. Write current state to `state.md`
2. Post a brief status update to your Discord channel
3. Run `/clear` to reset context
4. On fresh boot, the startup checklist picks up from `state.md`

### Rules

- Never use plan mode or AskUserQuestion — users read Discord, not the terminal
- Be concise in Discord posts — users read on mobile
- The orchestrator is the manager. If you need something outside your scope, use `message_orchestrator`.
- No `as any` or `as unknown as` casts in TypeScript
