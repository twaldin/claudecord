---
updated: 2026-03-26
---

# Monitor Agent Crons

## System Health Check
- **Schedule**: `*/10 * * * *` — every 10 minutes
- **Task**: Run full monitoring checklist: process health, coverage metrics, top trade-ups, pricing anomalies, log analysis, daemon cycle health. Compare against previous state.md values for trend detection. Open GitHub issues for new problems. Auto-fix simple issues via LifeOS. Post summary to #code-status if anything changed.
- **Note**: This is the core monitoring loop. Every check should be thorough but fast.

## Daily Coverage Report
- **Schedule**: `0 8 * * *` — 8:00 AM daily
- **Task**: Generate full coverage report with all metrics, trends vs yesterday, open issues summary. Post to #code-status. Message LifeOS with daily summary.
- **Note**: The daily anchor for monitoring — gives Tim a daily health snapshot.
