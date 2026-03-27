---
updated: 2026-03-27T02:35:00Z
---

# Monitor State

## Last Check
- Timestamp: 2026-03-27 ~02:35 UTC

## Schema Notes
- `buff_listings` table DROPPED — Buff data in `listings` table (source='buff')
- `dmarket` listings also in `listings` table (source='dmarket')
- Coverage queries use COUNT(*) FROM listings WHERE source=X (no condition column)
- market_snapshots timestamp column is `snapshot_at` (not `created_at`)

## Coverage Baselines
- CSFloat listings: 38,582 (prev: 38,619, -37 churn ✅)
- Buff listings: 106,598 (prev: 106,385, +213 ✅)
- DMarket listings: 346,483 (prev: 346,495, -12 ✅)
- Skinport price pairs: 12,937 (unchanged ✅)
- Price observations (KNN data): 338,637 (prev: 338,175, +462 growing ✅)

## CSFloat Cyclic Pattern (confirmed)
- CSFloat oscillates ~38K baseline → +4K flush when rate limit clears → purges back to ~38K
- Normal range: 37,800–42,200. Alert only if sustained drop below ~36,000

## Stale EV Tracking
- Raw stale count: 7,568 (prev: 7,556, +12 — flat)
- High-profit (>$50) freshness: 802/1,252 (64%) — improving post-restart reprice ✅

## Daemon Cycle Health
- Last snapshot: ~11 min ago ✅
- Avg cycle time: 33.4 min ✅

## Process Health (pm2 restart counts)
- daemon: online, **557 restarts** — ⚠️ restart #557 at 02:10 UTC (silent Phase 5 crash, GH #22)
- api: online, 195 restarts ✅
- buff-fetcher: online, 559 restarts ✅
- bitskins-fetcher: REMOVED from pm2 (known 429 loop)
- checker: online, 7 restarts ✅
- fetcher (dmarket): online, 8 restarts ✅
- discord-bot: online, 7 restarts ✅

## Deadlock Tracking (PR #14)
- Fix deployed: 2026-03-26 ~22:52 UTC
- Current: **557 restarts** — PR #14 holding for deadlocks ✅, but new silent crash type emerging (GH #22)
- Silent crash pattern: #555 (23:28), #557 (02:10) — ~2-3hr interval, Phase 5 knife signature load
- Alert threshold: >3 new restarts in any 30-min cycle

## Open Issues
- GH #20: Thin KNN data for gloves outputs — LOW priority. https://github.com/twaldin/trade-up-bot/issues/20
- GH #21: Phase 5 worker timeouts (knife/restricted) when budget <21 min — LOW priority. https://github.com/twaldin/trade-up-bot/issues/21
- GH #22: Recurring silent Phase 5 crashes (restarts #555, #557) — HIGH priority, needs investigation. Knife sig load 174s (20x slow) → crash. https://github.com/twaldin/trade-up-bot/issues/22

## Active Alerts
- ⚠️ HIGH: Silent Phase 5 crashes recurring (~2-3hr interval). GH #22 open. Watch for restart #558. Avg profitable dropped 52→36, avg top profit $213→$161 post-restart.
