---
updated: 2026-03-26
---

# Evaluator State

## Reviewed PRs
| PR | Verdict | Date | Notes |
|----|---------|------|-------|
| #11 | APPROVED | 2026-03-26 | Skinport median cache in calc workers. MERGED. |
| #18 | APPROVED + DEPLOYED | 2026-03-26 | CSFloat batch timeout fix (issue #16). MERGED + DEPLOYED. |
| #19 | APPROVED + DEPLOYED | 2026-03-26 | BitSkins full removal (issue #17). MERGED + DEPLOYED. bitskins-fetcher pm2 process deleted. |

## Pending Merge+Deploy Queue
- (empty)

## Recently Deployed
| PR | Date | Summary |
|----|------|---------|
| #23 | 2026-03-26 | Phase 5 OOM crash fix — 30s statement_timeout on sig query, memory logging, SIGKILL capture |

## Known Issues
- tsx was stripped by `npm install --production` — fixed, script updated to use `npm install`
- Deadlock fix (PR #14) deployed, monitoring for regression
- GitHub won't allow self-approve (all agents share twaldin account) — leaving approval comments instead
- VPS now runs 6 processes (bitskins-fetcher removed): api, buff-fetcher, checker, daemon, discord-bot, fetcher
