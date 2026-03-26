# Claudecord Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Discord ↔ Claude Code routing system where one daemon owns the Discord connection and per-agent MCP channel shims bridge messages to individual Claude Code sessions.

**Architecture:** A Node.js router daemon connects to Discord with one bot token and exposes a local HTTP API. Each Claude Code agent session loads a lightweight MCP channel shim that connects to the daemon's API, receives messages routed to its channels, and exposes a `discord_reply` tool. Inter-agent communication uses existing `send_message` bash script via tmux send-keys.

**Tech Stack:** TypeScript, discord.js, @modelcontextprotocol/sdk, Express (HTTP API for daemon ↔ shim IPC), vitest

---

## File Structure

```
~/claudecord/
├── src/
│   ├── daemon/                    # Router daemon (standalone process)
│   │   ├── index.ts               # Entry point — starts Discord client + HTTP server
│   │   ├── discord.ts             # Discord.js client connection + message handling
│   │   ├── http-api.ts            # Express server for shim ↔ daemon communication
│   │   └── routing.ts             # Channel ID → agent name routing config + logic
│   ├── shim/                      # MCP channel shim (one per agent, spawned by Claude Code)
│   │   ├── index.ts               # Entry point — MCP server + connects to daemon HTTP API
│   │   └── tools.ts               # discord_reply, discord_react, discord_fetch tools
│   └── shared/
│       └── types.ts               # Shared types (message format, routing config, etc.)
├── agents/
│   ├── lifeos/
│   │   ├── CLAUDE.md              # LifeOS manager agent definition
│   │   └── .claude/
│   │       └── settings.local.json # dontAsk permissions for LifeOS
│   └── trader/
│       ├── CLAUDE.md              # Already exists
│       ├── trades.md              # Already exists
│       └── .claude/
│           └── settings.local.json # dontAsk permissions for trader
├── scripts/                       # Already built: spawn_teammate, send_message, etc.
├── config/
│   └── routing.json               # Channel → agent routing map
├── tests/
│   ├── routing.test.ts            # Routing logic unit tests
│   ├── shim.test.ts               # Shim MCP tools tests
│   └── daemon.test.ts             # Daemon HTTP API tests
└── docs/superpowers/plans/        # This file
```

---

### Task 1: Shared Types + Routing Config

**Files:**
- Create: `src/shared/types.ts`
- Create: `config/routing.json`
- Test: `tests/routing.test.ts`

- [ ] **Step 1: Write the failing test for routing lookup**

```typescript
// tests/routing.test.ts
import { describe, it, expect } from 'vitest'
import { resolveAgent, loadRouting } from '../src/daemon/routing.js'

describe('resolveAgent', () => {
  const config = {
    agents: {
      lifeos: { channels: ['1485084226926940307', '1485084277203800145', '1485084342073163957', '1485688049051369592'] },
      trader: { channels: ['TRADING_CHANNEL_ID'] },
      coder: { channels: ['1485084317272244274'] },
    },
    defaultAgent: 'lifeos',
  }

  it('routes lifeos channel to lifeos agent', () => {
    expect(resolveAgent(config, '1485084226926940307')).toBe('lifeos')
  })

  it('routes trading channel to trader agent', () => {
    expect(resolveAgent(config, 'TRADING_CHANNEL_ID')).toBe('trader')
  })

  it('routes unknown channel to default agent', () => {
    expect(resolveAgent(config, 'unknown_id')).toBe('lifeos')
  })

  it('returns null when no default and unknown channel', () => {
    const noDefault = { agents: config.agents }
    expect(resolveAgent(noDefault, 'unknown_id')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/claudecord && npx vitest run tests/routing.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Write shared types**

```typescript
// src/shared/types.ts
export interface RoutingConfig {
  agents: Record<string, AgentRouting>
  defaultAgent?: string
}

export interface AgentRouting {
  channels: string[]
}

export interface ChannelMessage {
  content: string
  channelId: string
  messageId: string
  userId: string
  username: string
  timestamp: string
  attachments?: Array<{ name: string; url: string; size: number }>
}

export interface AgentReply {
  channelId: string
  text: string
  replyTo?: string
  files?: string[]
}
```

- [ ] **Step 4: Write routing logic**

```typescript
// src/daemon/routing.ts
import { readFileSync } from 'fs'
import { join } from 'path'
import type { RoutingConfig } from '../shared/types.js'

export function resolveAgent(config: RoutingConfig, channelId: string): string | null {
  for (const [agentName, agentRouting] of Object.entries(config.agents)) {
    if (agentRouting.channels.includes(channelId)) {
      return agentName
    }
  }
  return config.defaultAgent ?? null
}

export function loadRouting(configPath?: string): RoutingConfig {
  const path = configPath ?? join(process.cwd(), 'config', 'routing.json')
  return JSON.parse(readFileSync(path, 'utf8'))
}
```

- [ ] **Step 5: Write routing config**

```json
// config/routing.json
{
  "agents": {
    "lifeos": {
      "channels": [
        "1485084226926940307",
        "1485084277203800145",
        "1485084342073163957",
        "1485688049051369592"
      ]
    },
    "trader": {
      "channels": []
    },
    "coder": {
      "channels": [
        "1485084317272244274"
      ]
    }
  },
  "defaultAgent": "lifeos"
}
```

Note: trader channel ID will be added after #trading is created in Discord.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd ~/claudecord && npx vitest run tests/routing.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
cd ~/claudecord
git add src/shared/types.ts src/daemon/routing.ts config/routing.json tests/routing.test.ts
git commit -m "feat: add routing config and channel-to-agent resolution"
```

---

### Task 2: Router Daemon — Discord Client + HTTP API

**Files:**
- Create: `src/daemon/discord.ts`
- Create: `src/daemon/http-api.ts`
- Create: `src/daemon/index.ts`
- Modify: `package.json` (add express dependency)
- Test: `tests/daemon.test.ts`

- [ ] **Step 1: Add express dependency**

Run: `cd ~/claudecord && npm install express && npm install -D @types/express`

- [ ] **Step 2: Write the failing test for HTTP API**

```typescript
// tests/daemon.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHttpApi } from '../src/daemon/http-api.js'

describe('daemon HTTP API', () => {
  let server: ReturnType<typeof createHttpApi>
  const PORT = 19532

  beforeAll(() => {
    server = createHttpApi(PORT)
  })

  afterAll(() => {
    server.close()
  })

  it('registers an agent via POST /register', async () => {
    const res = await fetch(`http://localhost:${PORT}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'test-agent' }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.agentName).toBe('test-agent')
  })

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`http://localhost:${PORT}/nonexistent`)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/claudecord && npx vitest run tests/daemon.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write HTTP API server**

```typescript
// src/daemon/http-api.ts
import express from 'express'
import type { Server } from 'http'
import type { ChannelMessage, AgentReply } from '../shared/types.js'

type MessageHandler = (agentName: string, message: ChannelMessage) => void
type ReplyHandler = (reply: AgentReply) => Promise<void>

interface ApiState {
  registeredAgents: Set<string>
  pendingMessages: Map<string, ChannelMessage[]>
  onReply?: ReplyHandler
}

export function createHttpApi(port: number, onReply?: ReplyHandler) {
  const app = express()
  app.use(express.json())

  const state: ApiState = {
    registeredAgents: new Set(),
    pendingMessages: new Map(),
    onReply,
  }

  // Agent registers itself
  app.post('/register', (req, res) => {
    const { agentName } = req.body
    state.registeredAgents.add(agentName)
    state.pendingMessages.set(agentName, [])
    res.json({ agentName, registered: true })
  })

  // Agent polls for messages
  app.get('/messages/:agentName', (req, res) => {
    const { agentName } = req.params
    const messages = state.pendingMessages.get(agentName) ?? []
    state.pendingMessages.set(agentName, [])
    res.json({ messages })
  })

  // Agent sends a reply to Discord
  app.post('/reply', async (req, res) => {
    const reply: AgentReply = req.body
    if (state.onReply) {
      await state.onReply(reply)
    }
    res.json({ sent: true })
  })

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agents: [...state.registeredAgents] })
  })

  // Catch-all 404
  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' })
  })

  const server = app.listen(port)

  return Object.assign(server, {
    pushMessage(agentName: string, message: ChannelMessage) {
      const queue = state.pendingMessages.get(agentName)
      if (queue) queue.push(message)
    },
    state,
  })
}
```

- [ ] **Step 5: Write Discord client wrapper**

```typescript
// src/daemon/discord.ts
import { Client, GatewayIntentBits, Partials, type Message } from 'discord.js'
import type { ChannelMessage } from '../shared/types.js'

export function createDiscordClient(
  token: string,
  onMessage: (msg: ChannelMessage) => void,
) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  })

  client.on('messageCreate', (msg: Message) => {
    if (msg.author.bot) return

    const channelMessage: ChannelMessage = {
      content: msg.content,
      channelId: msg.channelId,
      messageId: msg.id,
      userId: msg.author.id,
      username: msg.author.username,
      timestamp: msg.createdAt.toISOString(),
      attachments: msg.attachments.map(a => ({
        name: a.name,
        url: a.url,
        size: a.size,
      })),
    }

    onMessage(channelMessage)
  })

  client.login(token)

  return {
    client,
    async sendToChannel(channelId: string, text: string, replyTo?: string) {
      const channel = await client.channels.fetch(channelId)
      if (!channel?.isTextBased()) return
      if (replyTo) {
        const originalMsg = await channel.messages.fetch(replyTo)
        await originalMsg.reply(text)
      } else {
        await channel.send(text)
      }
    },
  }
}
```

- [ ] **Step 6: Write daemon entry point**

```typescript
// src/daemon/index.ts
import 'dotenv/config'
import { createDiscordClient } from './discord.js'
import { createHttpApi } from './http-api.js'
import { loadRouting, resolveAgent } from './routing.js'
import type { AgentReply } from '../shared/types.js'

const PORT = parseInt(process.env.ROUTER_PORT ?? '19532', 10)
const TOKEN = process.env.DISCORD_BOT_TOKEN

if (!TOKEN) {
  console.error('DISCORD_BOT_TOKEN required in .env')
  process.exit(1)
}

const routing = loadRouting()

const discord = createDiscordClient(TOKEN, (message) => {
  const agentName = resolveAgent(routing, message.channelId)
  if (!agentName) {
    console.log(`[router] No agent for channel ${message.channelId}, dropping`)
    return
  }
  console.log(`[router] ${message.username} in #${message.channelId} → ${agentName}`)
  api.pushMessage(agentName, message)
})

const api = createHttpApi(PORT, async (reply: AgentReply) => {
  await discord.sendToChannel(reply.channelId, reply.text, reply.replyTo)
})

console.log(`[router] Claudecord router listening on port ${PORT}`)
console.log(`[router] Routing: ${JSON.stringify(Object.keys(routing.agents))}`)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd ~/claudecord && npx vitest run tests/daemon.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd ~/claudecord
git add src/daemon/ tests/daemon.test.ts package.json package-lock.json
git commit -m "feat: add router daemon with Discord client and HTTP API"
```

---

### Task 3: MCP Channel Shim

**Files:**
- Create: `src/shim/index.ts`
- Create: `src/shim/tools.ts`
- Test: `tests/shim.test.ts`
- Modify: `package.json` (add @modelcontextprotocol/sdk)

- [ ] **Step 1: Add MCP SDK dependency**

Run: `cd ~/claudecord && npm install @modelcontextprotocol/sdk`

- [ ] **Step 2: Write the failing test for shim tools**

```typescript
// tests/shim.test.ts
import { describe, it, expect } from 'vitest'
import { formatChannelMessage } from '../src/shim/tools.js'

describe('formatChannelMessage', () => {
  it('formats a Discord message as a channel notification', () => {
    const msg = {
      content: 'hello from discord',
      channelId: '123',
      messageId: '456',
      userId: '789',
      username: 'tim',
      timestamp: '2026-03-26T03:00:00Z',
    }
    const formatted = formatChannelMessage(msg)
    expect(formatted.content).toContain('hello from discord')
    expect(formatted.meta.chat_id).toBe('123')
    expect(formatted.meta.user).toBe('tim')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/claudecord && npx vitest run tests/shim.test.ts`
Expected: FAIL

- [ ] **Step 4: Write shim tools (message formatting + reply tool)**

```typescript
// src/shim/tools.ts
import type { ChannelMessage } from '../shared/types.js'

export function formatChannelMessage(msg: ChannelMessage) {
  let content = msg.content
  if (msg.attachments && msg.attachments.length > 0) {
    const attList = msg.attachments.map(a => `${a.name} (${a.size} bytes)`).join('; ')
    content += `\n[Attachments: ${attList}]`
  }

  return {
    content,
    meta: {
      chat_id: msg.channelId,
      message_id: msg.messageId,
      user: msg.username,
      user_id: msg.userId,
      ts: msg.timestamp,
      source: 'claudecord',
    },
  }
}

export const REPLY_TOOL = {
  name: 'claudecord_reply',
  description: 'Reply to a Discord channel. Pass chat_id from the inbound message.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      chat_id: { type: 'string', description: 'Discord channel ID' },
      text: { type: 'string', description: 'Message text' },
      reply_to: { type: 'string', description: 'Message ID to reply to (optional)' },
    },
    required: ['chat_id', 'text'],
  },
}
```

- [ ] **Step 5: Write shim MCP server entry point**

```typescript
// src/shim/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { formatChannelMessage, REPLY_TOOL } from './tools.js'
import type { ChannelMessage, AgentReply } from '../shared/types.js'

const AGENT_NAME = process.env.CLAUDECORD_AGENT_NAME ?? 'default'
const ROUTER_PORT = parseInt(process.env.CLAUDECORD_ROUTER_PORT ?? '19532', 10)
const ROUTER_URL = `http://localhost:${ROUTER_PORT}`
const POLL_INTERVAL_MS = 2000

const server = new Server(
  { name: `claudecord-shim-${AGENT_NAME}`, version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {} },
    },
    instructions: `Messages from Discord arrive as <channel source="claudecord" chat_id="..." user="..." ts="...">. Reply using the claudecord_reply tool.`,
  },
)

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [REPLY_TOOL],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'claudecord_reply') {
    const { chat_id, text, reply_to } = request.params.arguments as Record<string, string>
    const reply: AgentReply = { channelId: chat_id, text, replyTo: reply_to }
    await fetch(`${ROUTER_URL}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reply),
    })
    return { content: [{ type: 'text', text: `sent to ${chat_id}` }] }
  }
  return { content: [{ type: 'text', text: 'unknown tool' }] }
})

// Register with daemon and start polling
async function start() {
  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Register with the router daemon
  await fetch(`${ROUTER_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName: AGENT_NAME }),
  })

  // Poll for messages
  setInterval(async () => {
    try {
      const res = await fetch(`${ROUTER_URL}/messages/${AGENT_NAME}`)
      const { messages } = await res.json() as { messages: ChannelMessage[] }
      for (const msg of messages) {
        const formatted = formatChannelMessage(msg)
        await server.notification({
          method: 'notifications/claude/channel',
          params: formatted,
        })
      }
    } catch {
      // Daemon not reachable — silent retry
    }
  }, POLL_INTERVAL_MS)
}

start().catch(console.error)
```

- [ ] **Step 6: Run tests**

Run: `cd ~/claudecord && npx vitest run tests/shim.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd ~/claudecord
git add src/shim/ tests/shim.test.ts package.json package-lock.json
git commit -m "feat: add MCP channel shim for per-agent Discord routing"
```

---

### Task 4: Agent Configurations

**Files:**
- Create: `agents/lifeos/CLAUDE.md`
- Create: `agents/lifeos/.claude/settings.local.json`
- Create: `agents/trader/.claude/settings.local.json`
- Modify: `scripts/spawn_teammate` (update launch command)
- Modify: `scripts/start.sh` (start daemon first)

- [ ] **Step 1: Write LifeOS manager CLAUDE.md**

Write `agents/lifeos/CLAUDE.md` — migrated from current LifeOS CLAUDE.md with added manager responsibilities (spawn/monitor teammates, registry management).

- [ ] **Step 2: Write per-agent permission configs**

```json
// agents/lifeos/.claude/settings.local.json
{
  "permissions": {
    "defaultMode": "dontAsk",
    "allow": [
      "Bash(~/claudecord/scripts/*)",
      "Bash(~/.lifeos/system/bin/*)",
      "Read(~/.lifeos/**)",
      "Read(~/obsidian/lifeos/**)",
      "Write(~/.lifeos/**)",
      "Write(~/obsidian/lifeos/**)",
      "Edit(~/.lifeos/**)",
      "Edit(~/obsidian/lifeos/**)",
      "WebSearch",
      "WebFetch"
    ]
  }
}
```

```json
// agents/trader/.claude/settings.local.json
{
  "permissions": {
    "defaultMode": "dontAsk",
    "allow": [
      "Bash(~/claudecord/scripts/*)",
      "Read(~/claudecord/agents/trader/**)",
      "Write(~/claudecord/agents/trader/**)",
      "Edit(~/claudecord/agents/trader/**)",
      "Read(~/obsidian/lifeos/life/finance/**)",
      "WebSearch",
      "WebFetch"
    ]
  }
}
```

- [ ] **Step 3: Update spawn_teammate to use dontAsk + shim**

Update `scripts/spawn_teammate` line 47-49 to:
```bash
PANE_INDEX=$(tmux split-window -t "$SESSION" -h -P -F '#{pane_index}' \
  -c "$DIR" \
  "claude --permission-mode dontAsk 2>&1; echo '[AGENT $NAME EXITED]'; read")
```

- [ ] **Step 4: Update start.sh to launch daemon first**

```bash
#!/bin/bash
SESSION="claudecord"
REGISTRY="$HOME/claudecord/registry.tsv"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Session '$SESSION' already exists."
  exit 1
fi

echo "# name|pane|status|directory|spawned_at" > "$REGISTRY"

# Start router daemon in background
cd ~/claudecord && npx tsx src/daemon/index.ts &
DAEMON_PID=$!
echo "Router daemon started (PID $DAEMON_PID)"
sleep 2

# Start LifeOS in tmux
tmux new-session -d -s "$SESSION" -c "$HOME/claudecord/agents/lifeos" \
  "CLAUDECORD_AGENT_NAME=lifeos CLAUDECORD_ROUTER_PORT=19532 claude --permission-mode dontAsk --dangerously-load-development-channels 'npx tsx ~/claudecord/src/shim/index.ts'"

echo "lifeos|0|alive|$HOME/claudecord/agents/lifeos|$(date -Iseconds)" >> "$REGISTRY"
echo "Claudecord started. Attach: tmux attach -t $SESSION"
```

- [ ] **Step 5: Commit**

```bash
cd ~/claudecord
git add agents/ scripts/ config/
git commit -m "feat: add agent configs, update scripts for router + dontAsk mode"
```

---

### Task 5: Integration Test

**Files:**
- No new files — manual testing

- [ ] **Step 1: Start the router daemon**

Run: `cd ~/claudecord && DISCORD_BOT_TOKEN=<token> npx tsx src/daemon/index.ts`
Expected: `[router] Claudecord router listening on port 19532`

- [ ] **Step 2: Verify health endpoint**

Run: `curl http://localhost:19532/health`
Expected: `{"status":"ok","agents":[]}`

- [ ] **Step 3: Register a test agent**

Run: `curl -X POST http://localhost:19532/register -H 'Content-Type: application/json' -d '{"agentName":"test"}'`
Expected: `{"agentName":"test","registered":true}`

- [ ] **Step 4: Verify agents list**

Run: `curl http://localhost:19532/health`
Expected: `{"status":"ok","agents":["test"]}`

- [ ] **Step 5: Send a test message to Discord**

Send a message in #lifeos on Discord. Check daemon logs for:
`[router] tim in #1485084226926940307 → lifeos`

- [ ] **Step 6: Verify message queued**

Run: `curl http://localhost:19532/messages/lifeos`
Expected: JSON with the message content

- [ ] **Step 7: Test full pipeline with Claude Code**

Start a Claude Code session with the shim:
```bash
cd ~/claudecord/agents/trader
CLAUDECORD_AGENT_NAME=trader CLAUDECORD_ROUTER_PORT=19532 \
  claude --permission-mode dontAsk \
  --dangerously-load-development-channels 'npx tsx ~/claudecord/src/shim/index.ts'
```

Send a message in the trader's Discord channel. Verify it appears in the Claude Code session.

- [ ] **Step 8: Commit any fixes**

```bash
cd ~/claudecord && git add -A && git commit -m "fix: integration test fixes"
```

---

## Execution Notes

- Tasks 1-3 are independent code modules — they can be worked on in parallel by separate agents
- Task 4 depends on Tasks 1-3 being complete (references their file paths)
- Task 5 depends on all prior tasks
- The router daemon and shim will need Tim's Discord bot token from `~/.claude/channels/discord/.env`
- If `--dangerously-load-development-channels` doesn't accept inline commands, the shim may need to be packaged as a proper MCP server binary

## Post-MVP Improvements (Not in this plan)

- SSE/WebSocket instead of polling (eliminate 2s latency)
- Permission relay via Discord DM buttons
- Attachment download support in shim
- Daemon auto-restart via launchd/systemd
- Multi-guild support
