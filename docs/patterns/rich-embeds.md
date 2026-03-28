# Rich Embeds

Agents can send structured Discord embeds via the `claudecord_reply` MCP tool. Embeds are optional — plain text replies continue to work as before.

---

## The AgentEmbed type

```typescript
interface AgentEmbed {
  title?: string
  description?: string
  color?: number        // hex color as integer, e.g. 0x5865F2
  fields?: EmbedField[]
  footer?: string
  url?: string
  thumbnailUrl?: string
}

interface EmbedField {
  name: string
  value: string
  inline?: boolean      // default false; set true for side-by-side fields
}
```

All fields are optional. An embed with only `description` is valid.

---

## Calling claudecord_reply with an embed

Pass the embed object as the `embed` parameter. You can include `text` alongside it, or omit text and send only the embed.

**Embed only:**
```json
{
  "chat_id": "000000000000000000",
  "embed": {
    "title": "PR #52 approved",
    "description": "All checks pass. Ready to merge.",
    "color": 5763719,
    "fields": [
      { "name": "Tests", "value": "167 passing", "inline": true },
      { "name": "Confidence", "value": "95%", "inline": true }
    ],
    "footer": "evaluator-pr-52 • 12m runtime"
  }
}
```

**Text + embed:**
```json
{
  "chat_id": "000000000000000000",
  "text": "Review complete.",
  "embed": {
    "title": "PR #52: Add status board",
    "color": 5763719
  }
}
```

At least one of `text` or `embed` must be present. The daemon rejects requests with neither.

---

## Color conventions

Use agent-type colors to make embeds visually consistent across channels:

| Agent type   | Color      | Hex value  |
|--------------|------------|------------|
| coder        | Blurple    | `0x5865F2` |
| researcher   | Orange     | `0xED7D31` |
| evaluator    | Red        | `0xED4245` |
| persistent   | Green      | `0x57F287` |

System colors (used by daemon-generated embeds):

| Meaning  | Color  | Hex value  |
|----------|--------|------------|
| success  | Green  | `0x57F287` |
| failure  | Red    | `0xED4245` |
| warning  | Yellow | `0xFEE75C` |
| neutral  | Gray   | `0x95A5A6` |

---

## Examples

### PR review embed (evaluator)

```json
{
  "chat_id": "000000000000000000",
  "embed": {
    "title": "PR #52: Add status board",
    "color": 15360581,
    "fields": [
      { "name": "Verdict", "value": "approved", "inline": true },
      { "name": "Confidence", "value": "92%", "inline": true },
      { "name": "Tests", "value": "167 passing", "inline": true }
    ],
    "url": "https://github.com/org/repo/pull/52",
    "footer": "evaluator-pr-52"
  }
}
```

### Completion embed (coder)

```json
{
  "chat_id": "000000000000000000",
  "embed": {
    "title": "coder-fix-49 completed",
    "color": 5763719,
    "fields": [
      { "name": "Duration", "value": "2h 14m", "inline": true },
      { "name": "Files Changed", "value": "8", "inline": true },
      { "name": "PR", "value": "#52", "inline": true },
      { "name": "Summary", "value": "Implemented status board with 60s auto-update loop and edit-in-place.", "inline": false }
    ],
    "footer": "coder-fix-49 • task complete"
  }
}
```

### Simple status update (persistent agent)

```json
{
  "chat_id": "000000000000000000",
  "embed": {
    "title": "Daily summary",
    "color": 5763719,
    "description": "3 tasks completed, 1 P0 open.\nNext: monitor earnings calendar."
  }
}
```

---

## Daemon-generated embeds

The daemon also generates embeds automatically for lifecycle events (spawn, cleanup, heartbeat, PR review, deploy). These are built by `src/daemon/embeds.ts` and posted without agent involvement. Agents do not need to post spawn or death notifications — those are handled by the daemon when `spawn_teammate` / `kill_teammate` call the HTTP API.
