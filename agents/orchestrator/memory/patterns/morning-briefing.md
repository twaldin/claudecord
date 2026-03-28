# Pattern: Morning Briefing

Runs at 7:27 AM daily. Collects data, formats a briefing, posts to #daily.

## Data Collection (in order)

### 1. Calendar
```
If calendar tool available:
  Fetch today's events
  Note: time, title, location/link for each
Else:
  Skip section, note "calendar unavailable"
```

### 2. Email
```
If email tool available:
  Fetch unread from last 12 hours
  Identify: urgent (needs reply today), actionable (needs to do something), FYI (just note it)
  Summarize each category in 1 line
Else:
  Skip section, note "email unavailable"
```

### 3. Tasks Due Today
```
Read memory/tasks.md
Filter: due = today OR due = overdue AND status != done
Sort by priority
List each with status
```

### 4. Deadlines This Week
```
If deadlines file exists:
  Filter: due within 7 days
  Sort ascending
  List with time remaining
```

### 5. Agent Status
```
Run: list_teammates
Summarize: who's running, any failures overnight
```

### 6. Habit Streaks
```
Run: habit_check
Report: current streak for each tracked habit
Flag: any streak at risk (not marked yesterday)
```

## Briefing Format

```
**Morning Briefing — {weekday}, {date}**

**📅 Calendar today:**
{events or "nothing scheduled"}

**📬 Email:**
{urgent items or "nothing urgent"}

**✅ Tasks due today:**
{tasks or "nothing due today"}

**⏰ Deadlines this week:**
{deadlines or "none"}

**🤖 Agents:**
{status summary}

**🔥 Habits:**
{streak summary}

{any other notes worth surfacing}
```

## Notes
- If nothing interesting in a section, collapse it to one line or omit it
- Keep total briefing under 20 lines — {{user_name}} reads this quickly
- Anything urgent should also get a separate Tier 1 alert to #alerts
