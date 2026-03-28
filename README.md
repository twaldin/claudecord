# Claudecord

**DM your AI on Discord. It dispatches a team of persistent agents and keeps you updated.**

Built on Claude Code + MCP. No hosted service — runs on your laptop or a $6/month VPS.

---

## What It Does

You message your Discord bot. An orchestrator agent receives it, decides what needs to happen, and coordinates a team of specialist agents — coders, evaluators, architects, researchers. They work autonomously and update you when something is worth knowing.

```
You: "Fix the login bug and deploy when done"
      ↓
Orchestrator receives message, spawns coder agent
Coder reads the issue, implements fix, creates PR
Evaluator reviews PR, catches a race condition, requests changes
Coder fixes it, Evaluator approves and merges
      ↓
Bot: "Login bug fixed. PR #42 merged and deployed. Race condition in session refresh caught and fixed."
```

---

## Architecture

```
Discord ──→ Daemon (Node.js) ──→ HTTP API (:19532)
                                       │
                              ┌────────┼────────┐
                              ▼        ▼        ▼
                         Orchestrator Coder  Evaluator
                         (Claude Code agents in tmux)
                              │
                         Shim (MCP server)
                         polls messages, exposes claudecord_reply
```

See [docs/architecture.md](docs/architecture.md) for the full diagram.

---

## Quickstart

### Prerequisites
- Node.js 22+
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- A Discord bot with `MESSAGE_CONTENT` intent enabled
- An Anthropic API key

### 5 Steps

**1. Clone and install**
```bash
git clone https://github.com/twaldin/claudecord
cd claudecord && npm install
```

**2. Configure**
```bash
cp .env.example .env
# Edit .env: add DISCORD_BOT_TOKEN and ANTHROPIC_API_KEY

cp config/routing.example.json config/routing.json
# Edit routing.json: map your Discord channel IDs to agents
```

**3. Fill in your configuration**
```bash
bash scripts/setup.sh
```

This prompts for your name, Discord channel IDs, and project directory, then
substitutes all `{{placeholders}}` across the agent CLAUDE.md files and `.mcp.json`.
It also fills the install path into `agents/orchestrator/.mcp.json` so the shim loads correctly.

**4. Start**
```bash
bash scripts/start.sh
```

**5. Message your bot**

Send a message in your configured Discord channel. The orchestrator will respond.

---

## Agents

| Agent | Type | Role |
|-------|------|------|
| **Orchestrator** | Persistent | Receives all messages, routes tasks, coordinates team |
| **Coder** | Ephemeral | Implements features/fixes, creates PRs, then exits |
| **Evaluator** | Persistent | Reviews PRs adversarially, approves/rejects, merges |
| **Architect** | Persistent | Audits codebase for tech debt, security, performance |
| **Researcher** | On-demand | Deep research, delivers structured findings |

Persistent agents use [self-compaction](docs/patterns/self-compaction.md) to run indefinitely without hitting context limits.

---

## Key Patterns

- **[Self-Compaction](docs/patterns/self-compaction.md)** — How persistent agents manage context over hours/days
- **[Notification Tiers](docs/patterns/notification-tiers.md)** — When to ping vs. stay silent
- **[Agent Completion](docs/patterns/agent-completion.md)** — How ephemeral agents finish cleanly

---

## Screenshots

*Coming soon — contributions welcome*

<!-- Add screenshots showing:
- Discord conversation with the bot
- tmux session with multiple agent panes
- Example PR created by a coder agent
-->

---

## Deployment

**Local:** `bash scripts/start.sh` — runs on your laptop while it's open.

**VPS (24/7):** Deploy to a $6/month Ubuntu VPS for always-on operation. See [deploy/README.md](deploy/README.md) for a one-command setup script.

---

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_BOT_TOKEN` | required | Discord bot token |
| `ANTHROPIC_API_KEY` | required | Anthropic API key |
| `CLAUDECORD_PORT` | `19532` | Daemon HTTP API port |
| `CLAUDECORD_SESSION` | `claudecord` | tmux session name |
| `CLAUDECORD_HOME` | `$HOME/claudecord` | Claudecord install directory |

### Routing Config

```json
{
  "agents": {
    "orchestrator": { "channels": ["CHANNEL_ID"] },
    "coder": { "channels": ["CHANNEL_ID"] }
  },
  "defaultAgent": "orchestrator"
}
```

---

## How It Works (Technical)

The **daemon** connects to Discord via discord.js and exposes a small HTTP API. When a message arrives, the daemon routes it to the appropriate agent's queue based on channel ID.

Each agent runs **Claude Code** in a tmux pane. A **shim** (MCP server) loads inside the agent and polls the daemon for queued messages every 2 seconds. When a message arrives, the shim emits it into the agent's context as a `notifications/claude/channel` event. The agent processes it and calls `claudecord_reply` to send responses back through the daemon to Discord.

Agents communicate with each other via tmux `send-keys` — instant, no overhead. The orchestrator coordinates the team using a registry file that tracks which agent is in which pane.

---

## License

MIT

---

*Built by [@twaldin](https://github.com/twaldin)*
