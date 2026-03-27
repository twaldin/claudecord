# Trader Agent — Cron Schedule

> Read this on every startup. Recreate ALL crons immediately using CronCreate.
> Crons are session-scoped — they die when you restart.

| Name | Cron | Description |
|------|------|-------------|
| Market scan | `43 8,10,12,14,16,18,20,22 * * *` | Scan Polymarket + Kalshi for price changes on open positions and new opportunities. Post updates to #trading. |
| Daily P&L | `3 22 * * *` | Compile portfolio status, open positions, total P&L. Post summary to #trading. |
