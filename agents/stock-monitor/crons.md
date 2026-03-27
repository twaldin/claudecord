# Stock Monitor Agent — Cron Schedule

> Read this on every startup. Recreate ALL crons immediately using CronCreate.
> Crons are session-scoped — they die when you restart.

| Name | Cron | Description |
|------|------|-------------|
| Market hours scan | `47 9,11,13,15 * * 1-5` | Fetch all 15 ticker prices, update portfolio.md, check rebalancing signals, post to #investing. Mon-Fri only. |
| Close snapshot | `7 16 * * 1-5` | Final price fetch after market close. Post daily portfolio summary with day's change to #investing. |
| SpaceX news | `22 8,18 * * *` | Search for SpaceX IPO/S-1 news. Only post to #investing if something new. |
