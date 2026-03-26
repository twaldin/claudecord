# Claudecord — Project Instructions

## What This Is
Discord bot that routes messages to independent Claude agent sessions via the Claude Code SDK. Open source, MIT licensed.

## Architecture
- **Bot layer** (`src/bot/`): discord.js client, event handlers, channel-to-agent routing
- **Agent layer** (`src/agents/`): lifecycle management, Claude Code SDK session wrappers
- **Config layer** (`src/config/`): channel mappings, bot settings
- **Agent definitions** (`agents/`): markdown files defining each agent's persona, tools, and system prompt

## Coding Standards
- TypeScript strict mode, no exceptions
- No `as any` or `as unknown as` casts ever
- TDD — write failing tests first, then implement
- No over-engineering. Only build what's needed now.
- Use zod for all external data validation (env vars, Discord payloads, config)
- Prefer explicit types over inference for function signatures
- No classes unless they genuinely manage state. Prefer plain functions + closures.

## Dependencies
- `discord.js` — Discord bot client
- `@anthropic-ai/claude-agent-sdk` — Claude agent sessions (streaming)
- `zod` — runtime validation
- `dotenv` — env loading
- `vitest` — testing

## Key Decisions
- Claude Code SDK (not raw Anthropic API) — agents get tool use, file access, full agentic loop
- One agent session per channel (Phase 1). Multi-agent per channel in Phase 2.
- Agent definitions are markdown files in `agents/` — easy to edit, version, and swap
- No persistence layer yet. Sessions die on restart. Phase 2 concern.

## File Layout
| Path | Purpose |
|------|---------|
| `src/index.ts` | Entry point |
| `src/bot/client.ts` | Discord.js client setup |
| `src/bot/events.ts` | Message/interaction handlers |
| `src/bot/router.ts` | Channel → agent routing |
| `src/agents/manager.ts` | Agent lifecycle (spawn, resume, kill) |
| `src/agents/session.ts` | Claude Code SDK session wrapper |
| `src/agents/types.ts` | Agent type definitions |
| `src/config/channels.ts` | Channel-to-agent mapping |
| `src/config/settings.ts` | Bot settings (validated with zod) |
| `src/utils/logger.ts` | Logging |
| `src/utils/discord.ts` | Discord helpers |
| `agents/default.md` | Default agent system prompt |
| `tests/` | Test files |
