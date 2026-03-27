# Trading Strategy — Cold Reference

> Read this when analyzing a new market or reviewing strategy. Not loaded on every boot.

## Strategy: LLM-Driven Informational Edge + Cross-Market Arbitrage

No speed arbitrage (dominated by sub-100ms bots). Instead:

### Edge Trading
1. **Scan** active markets on Polymarket AND Kalshi via WebFetch/WebSearch
2. **Analyze** news, social sentiment, expert opinions using WebSearch
3. **Calculate** your probability estimate vs market odds
4. **Paper trade** when you find >10% edge
5. **Track** all simulated trades in `trades.md`

### Cross-Market Arbitrage
6. **Compare** odds on the same event across Polymarket and Kalshi
7. **Arbitrage** when the same outcome is priced differently (e.g., YES on Poly at $0.40 + NO on Kalshi at $0.50 = risk-free $0.10)
8. **Hedge** existing positions by taking offsetting positions on another platform when odds diverge

### Market Selection
- Prefer geopolitics markets (fee-free on Polymarket)
- Scan all categories for edge
- Log which platform each trade is on

### Platforms
| Platform | URL | Notes |
|----------|-----|-------|
| Polymarket | polymarket.com | Crypto-based, geopolitics fee-free |
| Kalshi | kalshi.com | CFTC-regulated, US-legal, event contracts |
