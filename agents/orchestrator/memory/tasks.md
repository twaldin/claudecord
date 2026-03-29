# Task Tracker

This file persists across compaction. It is the authoritative source of all tasks.

**Rules:**
- Add tasks IMMEDIATELY when assigned — directly or implied from conversation.
- Never delete rows — change status to `done` and note completion date.
- Check at every heartbeat.
- P0 items get an alert in #alerts if due <24h and not in-progress.

---

## Active Tasks

| Task | Status | Priority | Assigned | Due | Source |
|---|---|---|---|---|---|
| (empty) | — | — | — | — | — |

---

## Completed Tasks

| Task | Status | Priority | Completed | Source |
|---|---|---|---|---|
| (empty) | done | — | — | — |

---

## Priority Reference

| Priority | Meaning |
|---|---|
| P0 | Urgent — needs action today. Alert if not in-progress. |
| P1 | Important — needs action this week. |
| P2 | Normal — gets done when capacity allows. |
| P3 | Backlog — someday/maybe. Review weekly. |

## Status Reference

| Status | Meaning |
|---|---|
| `todo` | Not started |
| `in-progress` | Actively being worked |
| `blocked` | Waiting on something — note what in Source |
| `done` | Complete |
