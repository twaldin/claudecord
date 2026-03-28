# Orchestrator Cron Definitions

Recreate ALL of these on every startup (after /clear or first boot).
Crons are deleted during compaction to prevent ghost crons — this file is the authoritative source.

## How to Recreate

On startup, after reading WORKING.md, create each cron below using CronCreate.
After creating all crons, proceed with the startup checklist.

---

## Crons

### morning-briefing
- **Schedule:** `27 7 * * *` (7:27 AM daily)
- **Task:** Run morning briefing: read calendar, check email, summarize tasks due today, check deadlines this week, get agent status, check habit streaks. Post formatted briefing to #daily channel.
- **Notes:** Runs before most people start work. If calendar or email tools are unavailable, skip those sections and note it.

### heartbeat
- **Schedule:** `17 7-22 * * *` (every hour at :17, 7am–10pm)
- **Task:** Run heartbeat checklist: check tasks.md for P0 deadlines, check deadlines file, run habit_check, run reconcile_registry to respawn dead agents, check email for urgent items, log summary to heartbeat.log.
- **Notes:** Keep it fast — this should complete in under 30 seconds. If something requires action, do it after logging.

### nightly-reflection
- **Schedule:** `0 0 * * *` (midnight daily)
- **Task:** Run nightly reflection: review tasks completed today, check habit completion, note any agent issues, identify tomorrow's top 3 priorities. Post reflection to #daily. Then update WORKING.md, update tasks.md, and compact.
- **Notes:** This ALWAYS ends in compaction. After posting the reflection and updating state files, compact immediately.

### habit-nudge
- **Schedule:** `3 21 * * *` (9:03 PM daily)
- **Task:** Run habit_check. If any habits have not been marked today, post a gentle reminder to #main: "Habits not marked today: <list>. Don't forget before bed."
- **Notes:** Only post if habits are actually missing. Don't post if everything is marked.

### weekly-review
- **Schedule:** `0 20 * * 0` (8:00 PM Sunday)
- **Task:** Generate weekly review: habit completion rate (days completed / 7), task throughput (done this week vs added this week), deadline hit rate, agent reliability, notable wins and misses. Post to #daily.
- **Notes:** Pull data from tasks.md (filter by completion date this week), habit tracker, and heartbeat.log for agent failures.

---

## Recreating After Restart

```
# Template for recreating — replace description with actual task text above
CronCreate(schedule="27 7 * * *", prompt="<morning briefing task>")
CronCreate(schedule="17 7-22 * * *", prompt="<heartbeat task>")
CronCreate(schedule="0 0 * * *", prompt="<nightly reflection task>")
CronCreate(schedule="3 21 * * *", prompt="<habit nudge task>")
CronCreate(schedule="0 20 * * 0", prompt="<weekly review task>")
```
