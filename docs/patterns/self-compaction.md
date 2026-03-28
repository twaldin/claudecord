# Pattern: Self-Compaction

Persistent Claude Code agents accumulate context over time. Without management, an agent that has been running for hours will hit its context limit and crash — losing all in-flight state.

Self-compaction is the pattern where an agent proactively saves its state and resets its context window before hitting the limit.

## Why This Matters

Claude Code's context window is finite. A persistent agent that:
- Runs heartbeat crons every 5 minutes
- Processes dozens of messages per hour
- Spawns and coordinates sub-agents

...will fill its context window in 4-8 hours under normal load. Without compaction, the agent either errors out or starts dropping earlier context, losing track of what it was doing.

## The Protocol

### Step 1: Detect the need to compact

Check after every 10 tool calls, or if:
- You've been running for 4+ hours since last compaction
- Context feels heavy (responses are slower, you're losing track of earlier messages)
- You're about to start a large multi-step task

### Step 2: Save state

Write current state to `state.md` before compacting:

```markdown
# Agent State
Last updated: 2026-03-28T14:30:00Z

## Active work
- Reviewing PR #42 (approved, pending merge command)

## Pending items
- Spawn coder for issue #45 once PR #42 is deployed
- Check in with researcher at 16:00

## Recent context
- Orchestrator asked me to prioritize security review
- User mentioned they're deploying to prod tomorrow
```

### Step 3: Save and delete crons

**Critical:** Crons persist across `/clear`. If you don't delete them, they'll fire into your fresh context and clutter your restart. But you also need to remember what crons to recreate.

```
# Save cron list
CronList → write to crons.md

# Delete every cron
CronList → for each cron: CronDelete(id)
```

`crons.md` format:
```markdown
# Active Crons (saved before compaction)
- heartbeat: every 5 minutes — check messages, check agent health
- daily-audit: every day at 09:00 — run architect review
```

### Step 4: Notify

Post to your Discord channel so the user knows you're briefly offline:

```
claudecord_reply(chat_id="CHANNEL_ID", text="Compacting — back in 30s")
```

### Step 5: Compact

Run `/clear` to reset the context window. This terminates your current context chain.

### Step 6: Restart cleanly

On the first turn after `/clear`:

1. Read `CLAUDE.md` — re-establish your role and tools
2. Read `state.md` — resume from where you left off
3. Read `crons.md` — recreate all crons exactly as they were
4. Check message queue for anything that arrived during compaction
5. Post to Discord: 'Back online.'

**Then go idle.** Don't immediately process a backlog of messages or spawn agents. Read state first, get oriented, then act.

## Anti-Patterns

**Ghost crons** — forgetting to delete crons before `/clear`. They fire into your fresh context with no state, causing confusion or duplicate work.

**Silent compaction** — compacting without notifying the user. They see your agent go quiet and don't know why.

**Over-eager compaction** — compacting after every task. This wastes time. Only compact when context is actually getting heavy.

**Stateless compaction** — running `/clear` without writing `state.md`. You lose everything.

**Post-clear work** — doing tool calls or sending messages immediately after `/clear` before reading state. You'll act on stale assumptions.

## Implementation Checklist

When adding self-compaction to a persistent agent's `CLAUDE.md`:

- [ ] Define what goes in `state.md` for this agent's role
- [ ] Define what crons this agent maintains
- [ ] Add the compaction trigger (tool call count or time check)
- [ ] Add the startup checklist (read CLAUDE.md → state.md → crons.md → recreate crons → check queue)
- [ ] Add `.gitignore` entry for `agents/*/state.md` (state is local, not committed)
