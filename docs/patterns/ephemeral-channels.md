# Ephemeral Agent Channels

Each ephemeral agent (coder, researcher, evaluator) gets its own Discord channel when spawned. The channel is created automatically, kept alive while the agent works, then archived or deleted when the agent exits.

---

## How spawn triggers channel creation

`spawn_teammate` is a bash script. After writing to `registry.tsv` and creating the tmux pane, it POSTs to the daemon:

```bash
curl -s -X POST http://localhost:3000/agent/spawn \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLAUDECORD_API_SECRET" \
  -d '{
    "agentName": "coder-fix-49",
    "agentType": "coder",
    "task": "Fix issue #49: null pointer in routing",
    "issueNumber": 49,
    "worktreePath": "/tmp/claudecord-wt-fix-49"
  }'
```

The daemon creates the Discord channel, posts a spawn embed, adds the channel to `routing.json`, and returns `{ ok: true, channelId: "..." }`. The script treats a failure here as non-fatal — the agent still runs, it just won't have a dedicated channel.

---

## Channel naming

The channel name equals `agentName` exactly. Discord channel name constraints (lowercase, hyphens, max 100 chars) are already satisfied by the naming convention for agent names.

| agentName            | Discord channel        |
|----------------------|------------------------|
| `coder-fix-49`       | `#coder-fix-49`        |
| `coder-pricing`      | `#coder-pricing`       |
| `researcher-spacex`  | `#researcher-spacex`   |
| `evaluator-pr-52`    | `#evaluator-pr-52`     |

Agent names are validated against `/^[a-z0-9-]{1,80}$/` before the channel is created.

---

## Category mapping

Channels are placed in category channels by agent type:

| agentType   | Discord category |
|-------------|-----------------|
| `coder`     | Coders          |
| `researcher`| Research        |
| `evaluator` | Reviews         |
| `persistent`| (no category)   |

Categories are created on first use if they don't exist, then reused. The category names are configured via `ChannelManagerDeps.config.categories`.

---

## Archive flow

When `kill_teammate` runs (or an agent calls `POST /agent/died`), the daemon:

1. Calls `ChannelManager.archiveAgentChannel(channelId, agentName, cleanupData)`
2. Sets channel permissions: `SendMessages: false` for `@everyone` (read-only)
3. Posts a cleanup embed to the channel:

```
┌─────────────────────────────────────────────────┐
│  coder-fix-49 completed                         │
│  Task finished. What should happen to this      │
│  channel?                                       │
│                                                 │
│  Duration      Worktree                         │
│  2h 14m        /tmp/claudecord-wt-fix-49        │
│                                                 │
│  PR                                             │
│  #52                                            │
│─────────────────────────────────────────────────│
│  React: 📦 Archive forever  |  🗑️ Delete 24h   │
│  No reaction = archived in 48h                  │
└─────────────────────────────────────────────────┘
```

4. Adds 📦 and 🗑️ reactions to the cleanup message
5. Saves `diedAt` and `cleanupMessageId` to `channel-state.json`

---

## Reaction-based cleanup

After archiving, the user can react to the cleanup embed to choose the fate of the channel:

| Reaction | Effect                                      |
|----------|---------------------------------------------|
| 📦       | Keep as read-only archive indefinitely      |
| 🗑️       | Status → `pending-cleanup` (delete after 24h) |
| (none)   | Auto-archived after 48h with no action      |

The daemon listens for `messageReactionAdd` events on the Discord client and calls `channelManager.handleCleanupReaction(channelId, emoji)`.

---

## channel-state.json

The channel manager persists all lifecycle state to `$CLAUDECORD_HOME/channel-state.json`. This file survives daemon restarts.

Structure: an array of `ChannelLifecycle` objects:

```typescript
interface ChannelLifecycle {
  channelId: string
  agentName: string
  agentType: 'coder' | 'researcher' | 'evaluator' | 'persistent'
  status: 'active' | 'archived' | 'pending-cleanup'
  spawnedAt: string       // ISO timestamp
  diedAt?: string         // ISO timestamp, set on archive
  cleanupMessageId?: string  // Discord message ID of cleanup embed
  scheduledDeleteAt?: string // ISO timestamp for deferred deletion
}
```

See `config/channel-state.example.json` for a minimal example.

---

## Dynamic routing

When a channel is created, the daemon calls `routing.addAgentChannel(config, agentName, channelId, meta, routingPath)` which:

1. Adds the channel ID to `config.agents[agentName].channels` in memory
2. Writes the updated config back to `routing.json` atomically

From that point on, messages sent to `#coder-fix-49` are routed to the `coder-fix-49` agent session. When the channel is archived, routing is not automatically removed — the channel is read-only so no new messages arrive, but the routing entry stays until explicitly cleaned up.
