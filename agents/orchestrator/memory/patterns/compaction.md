# Pattern: Compaction

Run at natural breaks, when context is heavy, and always at nightly reflection. Never let context balloon.

**The compaction protocol is a commitment. Once you start, finish it. No "one last thing" after step 4.**

## Checklist

### 1. Update WORKING.md
Be thorough — the next session has no memory except this file.

Include:
- Everything currently in-flight (agent names, PR numbers, task IDs, what each is doing)
- Blocked items and what they're waiting on
- Any decisions made during this session that affect ongoing work
- What the user last asked for
- What was completed this session
- What needs to happen next
- Any gotchas or context that would otherwise be lost

### 2. Update core.md (if needed)
Only update if something meaningful changed:
- New project started
- User's focus shifted
- Important preference stated
- Major decision made

### 3. Update tasks.md
- Mark completed tasks as `done` with today's date
- Add any new tasks discovered during the session
- Update statuses for in-progress tasks
- Note blockers

### 4. Post to Discord
```
Post to #main: "Compacting — back in 30 seconds."
```
This is the last Discord message before going idle.

### 5. Delete All Crons
```
CronList → for each cron → CronDelete <id>
```
Must delete ALL of them. Ghost crons cause duplicate heartbeats and briefings.

### 6. Run Compact Script
```bash
compact  # runs with run_in_background: true
```

### 7. GO IDLE
Stop. No more tool calls. No more messages. No "just checking one thing."
Wait for the compact to complete and the next session to start fresh.

---

## After Restart (Post-Compaction)

1. Read CLAUDE.md (this file is always first)
2. Read memory/WORKING.md
3. Read memory/core.md
4. Read memory/tasks.md
5. Read crons.md and recreate ALL crons
6. Run reconcile_registry
7. Check Discord for messages that arrived during compaction
8. Post "Back online." to #main
9. Resume from WORKING.md

---

## Signs You Should Compact Now

- Context has been running for 4+ hours
- You've done 20+ tool calls since last compaction
- Response generation feels slow
- You catch yourself losing track of earlier context
- A token_warning file exists

## Signs You Should NOT Compact

- In the middle of a critical user request — finish first
- Mid-deploy — finish the deploy, then compact
- Agent is waiting for your response — respond first, then compact
