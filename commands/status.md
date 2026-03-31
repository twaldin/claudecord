---
name: status
description: "Check Claudecord daemon health, agent connections, and Discord routing status."
user-invocable: true
---

# Claudecord Status

Check the health of the Claudecord system.

## Quick Health Check

Run this to check daemon health:

```bash
curl -s http://localhost:19532/health 2>/dev/null || echo "Daemon not running"
```

## What to Check

### 1. Daemon Process
```bash
ps aux | grep "claudecord.*daemon" | grep -v grep
```

### 2. Registered Agents
The `/health` endpoint returns the list of currently connected agents.

### 3. Discord Bot Status
- Check if the bot is online in your Discord server
- Verify channels exist for registered agents

### 4. Shim Connections
Each agent running the shim polls the daemon every 2 seconds. If an agent's shim is connected, it appears in the agents list from `/health`.

## Common Issues

| Symptom | Diagnosis |
|---------|-----------|
| Daemon returns empty agents | No shims connected — agents may not have CLAUDECORD_AGENT_NAME set |
| Bot offline in Discord | Daemon crashed or token expired — check logs |
| Messages not routing | Check agent routing config and channel allowlists |
| High latency | Shim poll interval is 2s — this is normal |

## Restart Daemon

```bash
# Kill existing
pkill -f "claudecord.*daemon" 2>/dev/null

# Restart
cd ~/claudecord && nohup npm run daemon > /tmp/claudecord-daemon.log 2>&1 &

# Verify
sleep 2 && curl -s http://localhost:19532/health
```
