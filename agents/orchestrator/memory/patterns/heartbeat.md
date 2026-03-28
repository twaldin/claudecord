# Pattern: Heartbeat

Run every hour at :17 (7am–10pm). Keep it fast — under 30 seconds.

## Procedure

### 1. Tasks Check
```
Read memory/tasks.md
For each task where priority = P0 AND status != done:
  If due < 24h from now:
    Post to #alerts: "P0 task overdue/due soon: <task name> — due <time>"
  If due < 1h from now:
    Post to #alerts with urgent ping: "@{{user_name}} P0 deadline in <time>: <task>"
```

### 2. Deadlines Check
```
If deadlines file exists:
  Read it
  For each deadline < 24h away:
    Post to #alerts: "Deadline approaching: <name> — <time remaining>"
```

### 3. Habits Check
```
Run: habit_check
If any habit has not been marked in >2 days:
  Post to #main: "Habit reminder: <habit> hasn't been marked in <N> days"
```

### 4. Agent Health
```
Run: reconcile_registry
For each agent in registry that is dead:
  Attempt respawn automatically
  Log: "Respawned <agent>"
  If respawn fails:
    Post to #alerts: "Agent <name> is down and failed to respawn — manual intervention needed"
```

### 5. Email Check (if available)
```
Check email for urgent/actionable items
For each urgent item:
  Post summary to #main or handle directly
```

### 6. Log
```
Append to heartbeat.log:
  <ISO timestamp> | tasks: <N active, N P0 alerts sent> | agents: <N alive, N respawned> | habits: <status> | email: <N urgent>
```

## What NOT to Do During Heartbeat
- Don't start new long-running work
- Don't compact during heartbeat (only at nightly reflection or when context is heavy)
- Don't flood Discord — one message per channel max unless there's a real emergency
