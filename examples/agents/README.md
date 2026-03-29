# Example Agents

These are optional agent templates for domain-specific use cases. Copy any agent directory into `agents/` to use it.

- **monitor/** — system health monitoring (watches VPS processes, opens GitHub issues)
- **stock-monitor/** — portfolio price tracking during market hours (scheduled lifecycle)
- **trader/** — prediction market trading (persistent lifecycle)

Each directory contains a `.claude/settings.json` for plugin scoping. Add your own `CLAUDE.md`, `state.md`, `crons.md`, and `.mcp.json` to customize.

See `agents/orchestrator/CLAUDE.md` for a full example of a persistent agent.
