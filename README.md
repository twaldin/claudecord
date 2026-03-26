# Claudecord

Discord bot that routes messages to Claude agents via the Claude Code SDK. Each channel maps to an independent agent session with its own context and tools.

## Architecture

```
Discord Channel → Router → Agent Manager → Claude Code SDK Session
```

- **Bot**: discord.js client handles messages and interactions
- **Router**: maps channels to agent configs (which model, what system prompt, what tools)
- **Agent Manager**: spawns, resumes, and kills Claude sessions per channel
- **Sessions**: thin wrappers around the Claude Code SDK streaming API

## Phase 1 (current)

Single bot, message routing, one agent per channel. No persistence between restarts.

## Phase 2 (planned)

Multi-agent orchestration, persistent sessions, tool sharing, agent-to-agent communication.

## Setup

```bash
cp .env.example .env
# Fill in DISCORD_TOKEN and ANTHROPIC_API_KEY
npm install
npm run dev
```

## License

MIT
