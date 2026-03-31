#!/usr/bin/env bun
/**
 * Claudecord MCP server.
 *
 * Bridges Discord and Claude Code agents. Routes incoming Discord messages:
 *   - Orchestrator's channels → MCP notifications (Claude reads them directly)
 *   - Other agent channels   → tmux send_message script
 *
 * Also binds an HTTP side-channel on localhost so reply_discord scripts in
 * agent sessions (which don't load this plugin) can POST replies.
 *
 * Single-bot design: install claudecord only on the orchestrator session
 * (project-scope .claude/settings.json). Agents use reply_discord → curl →
 * HTTP side-channel → this server → Discord.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  Client,
  GatewayIntentBits,
  ChannelType,
  EmbedBuilder,
  type Message,
  type TextChannel,
} from 'discord.js'
import { execFile } from 'child_process'
import { readFileSync, writeFileSync, existsSync, renameSync, readdirSync } from 'fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { homedir } from 'os'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { loadRouting, resolveAgent, addAgentChannel, removeAgentChannel } from '../daemon/routing.js'
import { buildSpawnEmbed, buildCleanupEmbed } from '../daemon/embeds.js'
import type { RoutingConfig, AgentType, AgentStateEntry } from '../shared/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolve(__dirname, '../..')

// ---- Config ----------------------------------------------------------------

interface ClaudecordConfig {
  discordBotToken?: string
  discordGuildId?: string
  routingConfigPath?: string
  primaryAgent?: string
  httpPort?: number
  allowedUsers?: string[]
}

function loadConfig(): ClaudecordConfig {
  const configFile = process.env['CLAUDECORD_CONFIG'] ?? join(homedir(), '.claudecord', 'config.json')
  try {
    return JSON.parse(readFileSync(configFile, 'utf8')) as ClaudecordConfig
  } catch {}

  // Fall back to .env in plugin root
  const envFile = join(PLUGIN_ROOT, '.env')
  try {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^(\w+)=(.*)$/)
      if (m?.[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? ''
    }
  } catch {}

  return {}
}

const cfg = loadConfig()

const TOKEN        = cfg.discordBotToken  ?? process.env['DISCORD_BOT_TOKEN']
const GUILD_ID     = cfg.discordGuildId   ?? process.env['DISCORD_GUILD_ID']
const PRIMARY      = cfg.primaryAgent     ?? process.env['CLAUDECORD_PRIMARY_AGENT'] ?? 'orchestrator'
const HTTP_PORT    = cfg.httpPort         ?? parseInt(process.env['CLAUDECORD_HTTP_PORT'] ?? '19532', 10)
const ALLOWED_USERS = cfg.allowedUsers    ?? process.env['DISCORD_ALLOWED_USERS']?.split(',').map(s => s.trim()).filter(Boolean) ?? []

if (!TOKEN) {
  process.stderr.write(
    'claudecord: DISCORD_BOT_TOKEN required\n' +
    '  Run /claudecord:setup to configure, or set in ~/.claudecord/config.json\n',
  )
  process.exit(1)
}

// ---- Routing ---------------------------------------------------------------

const ROUTING_PATH = cfg.routingConfigPath
  ?? process.env['ROUTING_CONFIG']
  ?? join(PLUGIN_ROOT, 'config', 'routing.json')

let routing: RoutingConfig = existsSync(ROUTING_PATH)
  ? loadRouting(ROUTING_PATH)
  : { agents: {}, defaultAgent: PRIMARY }

// In-memory agent registry (mirrors daemon's agentRegistry for ephemeral channel lookup)
const agentRegistry = new Map<string, AgentStateEntry>()

function resolveAgentForChannel(channelId: string): string | null {
  // Check static routing.json first
  const fromRouting = resolveAgent(routing, channelId)
  if (fromRouting) return fromRouting

  // Check ephemeral agent registry
  for (const [name, entry] of agentRegistry) {
    if (entry.channelId === channelId && entry.status === 'alive') return name
  }
  return null
}

function isPrimaryChannel(channelId: string): boolean {
  const primaryConfig = routing.agents[PRIMARY]
  if (primaryConfig?.channels.includes(channelId)) return true
  // If no static routing exists for this channel, default to primary
  return resolveAgentForChannel(channelId) === null || resolveAgentForChannel(channelId) === PRIMARY
}

// ---- Discord client --------------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
})

async function fetchTextChannel(id: string): Promise<TextChannel> {
  const ch = await client.channels.fetch(id)
  if (!ch || !ch.isTextBased() || !('send' in ch)) {
    throw new Error(`channel ${id} not found or not text-based`)
  }
  return ch as TextChannel
}

const DISCORD_MAX = 2000

function chunkText(text: string): string[] {
  if (text.length <= DISCORD_MAX) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > DISCORD_MAX) {
    const slice = rest.slice(0, DISCORD_MAX)
    const cut = slice.lastIndexOf('\n')
    const at = cut > DISCORD_MAX / 2 ? cut : DISCORD_MAX
    out.push(rest.slice(0, at))
    rest = rest.slice(at).replace(/^\n/, '')
  }
  if (rest) out.push(rest)
  return out
}

async function sendToChannel(channelId: string, text: string, replyTo?: string): Promise<string[]> {
  const ch = await fetchTextChannel(channelId)
  const chunks = chunkText(text)
  const ids: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const opts: Parameters<typeof ch.send>[0] = { content: chunks[i] }
    if (i === 0 && replyTo) {
      opts.reply = { messageReference: replyTo, failIfNotExists: false }
    }
    const sent = await ch.send(opts)
    ids.push(sent.id)
  }
  return ids
}

// ---- tmux routing ----------------------------------------------------------

/** Locate the tmux-orchestrator send_message script.
 *  Priority: TMUX_ORCHESTRATOR_SCRIPTS env → plugin cache glob → PATH. */
function findSendMessage(): string {
  // 1. Explicit env var
  const fromEnv = process.env['TMUX_ORCHESTRATOR_SCRIPTS']
  if (fromEnv) {
    const p = join(fromEnv, 'send_message')
    if (existsSync(p)) return p
  }

  // 2. ~/.claude/plugins/cache/tmux-orchestrator/*/scripts/send_message
  const cacheBase = join(homedir(), '.claude', 'plugins', 'cache', 'tmux-orchestrator')
  if (existsSync(cacheBase)) {
    try {
      for (const entry of readdirSync(cacheBase)) {
        const candidate = join(cacheBase, entry, 'scripts', 'send_message')
        if (existsSync(candidate)) return candidate
      }
    } catch {}
  }

  // 3. Fall back to PATH
  return 'send_message'
}

const SEND_MESSAGE_PATH = findSendMessage()

function sendToAgent(agentName: string, msg: Message): void {
  const text = msg.content || '(attachment)'
  const envelope = `[DISCORD:${msg.author.username}]: ${text}`
  execFile(SEND_MESSAGE_PATH, [agentName, envelope], (err) => {
    if (err) {
      process.stderr.write(`claudecord: send_message to ${agentName} failed: ${err.message}\n`)
    }
  })
}

// ---- MCP server ------------------------------------------------------------

const mcp = new Server(
  { name: 'claudecord', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {} },
    },
    instructions: [
      'Claudecord routes Discord messages to your tmux agent team.',
      '',
      'Discord messages for the orchestrator arrive as MCP channel notifications.',
      'Use claudecord_reply to send messages. Use claudecord_fetch_messages to read history.',
      'Use claudecord_create_channel / claudecord_archive_channel for agent channel lifecycle.',
      '',
      'Agent sessions (without this plugin) use the reply_discord script to post messages.',
    ].join('\n'),
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'claudecord_reply',
      description: 'Send a message to a Discord channel. Pass channel_id from the routing config or an agent channel. Use reply_to (message_id) to thread.',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Discord channel ID' },
          text:       { type: 'string', description: 'Message text (auto-split at 2000 chars)' },
          reply_to:   { type: 'string', description: 'Message ID to reply to (optional)' },
        },
        required: ['channel_id', 'text'],
      },
    },
    {
      name: 'claudecord_fetch_messages',
      description: 'Fetch recent messages from a Discord channel. Returns oldest-first.',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Discord channel ID' },
          limit:      { type: 'number', description: 'Max messages (default 20, max 100)' },
        },
        required: ['channel_id'],
      },
    },
    {
      name: 'claudecord_create_channel',
      description: 'Create a Discord channel for an agent. Called by spawn_teammate when claudecord is active. Returns the new channel_id.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_name: { type: 'string', description: 'Agent name (used as channel name)' },
          agent_type: { type: 'string', description: 'coder | researcher | evaluator | persistent', enum: ['coder', 'researcher', 'evaluator', 'persistent'] },
          task:       { type: 'string', description: 'Task description shown in spawn embed' },
        },
        required: ['agent_name'],
      },
    },
    {
      name: 'claudecord_archive_channel',
      description: 'Archive a Discord channel when an agent completes its task. Locks the channel and posts a cleanup embed.',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Discord channel ID to archive' },
          agent_name: { type: 'string', description: 'Agent name (shown in cleanup embed)' },
          pr_number:  { type: 'number', description: 'PR number if applicable (optional)' },
          duration:   { type: 'string', description: 'Task duration string e.g. "12m" (optional)' },
        },
        required: ['channel_id', 'agent_name'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    switch (req.params.name) {
      case 'claudecord_reply': {
        const ids = await sendToChannel(
          args['channel_id'] as string,
          args['text'] as string,
          args['reply_to'] as string | undefined,
        )
        return { content: [{ type: 'text', text: ids.length === 1 ? `sent (id: ${ids[0]})` : `sent ${ids.length} parts` }] }
      }

      case 'claudecord_fetch_messages': {
        const ch = await fetchTextChannel(args['channel_id'] as string)
        const limit = Math.min((args['limit'] as number | undefined) ?? 20, 100)
        const msgs = await ch.messages.fetch({ limit })
        const me = client.user?.id
        const arr = [...msgs.values()].reverse()
        const out = arr.length === 0
          ? '(no messages)'
          : arr.map(m => {
              const who = m.author.id === me ? 'me' : m.author.username
              const atts = m.attachments.size > 0 ? ` +${m.attachments.size}att` : ''
              const text = m.content.replace(/[\r\n]+/g, ' ⏎ ')
              return `[${m.createdAt.toISOString()}] ${who}: ${text}  (id: ${m.id}${atts})`
            }).join('\n')
        return { content: [{ type: 'text', text: out }] }
      }

      case 'claudecord_create_channel': {
        const agentName = args['agent_name'] as string
        const agentType = (args['agent_type'] as AgentType | undefined) ?? 'coder'
        const task = (args['task'] as string | undefined) ?? ''

        if (!GUILD_ID) throw new Error('DISCORD_GUILD_ID not configured — run /claudecord:setup')

        const guild = client.guilds.cache.get(GUILD_ID)
        if (!guild) throw new Error(`Guild ${GUILD_ID} not in cache`)

        // Find or create category
        const categoryNames: Record<AgentType, string> = {
          coder: 'Coders', researcher: 'Research', evaluator: 'Reviews', persistent: 'Agents',
        }
        const categoryName = categoryNames[agentType]
        let parentId: string | undefined
        const existingCat = guild.channels.cache.find(
          ch => ch.name === categoryName && ch.type === ChannelType.GuildCategory,
        )
        if (existingCat) {
          parentId = existingCat.id
        } else {
          const created = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory })
          parentId = created.id
        }

        const channel = await guild.channels.create({
          name: agentName,
          type: ChannelType.GuildText,
          parent: parentId,
          topic: task || undefined,
        })

        // Post spawn embed
        const spawnedAt = new Date().toISOString()
        const embed = buildSpawnEmbed({ agentName, agentType, task, spawnedAt, channelName: agentName })
        await (channel as TextChannel).send({ embeds: [embed] })

        // Register in agent registry
        agentRegistry.set(agentName, {
          name: agentName,
          lifecycle: 'ephemeral',
          type: agentType,
          status: 'alive',
          directory: '',
          spawnedAt,
          diedAt: null,
          model: 'sonnet',
          channelId: channel.id,
          contextPct: null,
          agentStatus: null,
          task: task || null,
          shimConnected: false,
          lastHeartbeatAt: null,
        })

        return { content: [{ type: 'text', text: `created channel ${channel.id} (#${agentName})` }] }
      }

      case 'claudecord_archive_channel': {
        const channelId = args['channel_id'] as string
        const agentName = args['agent_name'] as string
        const prNumber  = args['pr_number'] as number | undefined
        const duration  = args['duration'] as string | undefined

        const ch = await fetchTextChannel(channelId)

        // Lock the channel (no more messages from @everyone)
        if (GUILD_ID) {
          await ch.permissionOverwrites.edit(GUILD_ID, { SendMessages: false })
        }

        // Post cleanup embed
        const embed = buildCleanupEmbed({ agentName, prNumber, duration })
        const msg = await ch.send({ embeds: [embed] })
        await msg.react('📦')
        await msg.react('🗑️')

        // Mark dead in registry
        const entry = agentRegistry.get(agentName)
        if (entry) {
          entry.status = 'dead'
          entry.diedAt = new Date().toISOString()
        }

        return { content: [{ type: 'text', text: `archived channel ${channelId}` }] }
      }

      default:
        return { content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }], isError: true }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: `${req.params.name} failed: ${msg}` }], isError: true }
  }
})

// ---- HTTP side-channel for reply_discord script ----------------------------

interface ReplyBody {
  channelId?: string
  text?: string
  replyTo?: string
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

const httpServer = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    jsonResponse(res, 200, { status: 'ok', uptime: process.uptime() })
    return
  }

  if (req.method === 'POST' && req.url === '/reply') {
    try {
      const raw = await readBody(req)
      const body = JSON.parse(raw) as ReplyBody
      if (!body.channelId || !body.text) {
        jsonResponse(res, 400, { error: 'channelId and text required' })
        return
      }
      await sendToChannel(body.channelId, body.text, body.replyTo)
      jsonResponse(res, 200, { ok: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      jsonResponse(res, 500, { error: msg })
    }
    return
  }

  jsonResponse(res, 404, { error: 'not found' })
})

// ---- Inbound message handling ----------------------------------------------

client.on('messageCreate', (msg: Message) => {
  if (msg.author.bot) return
  if (ALLOWED_USERS.length > 0 && !ALLOWED_USERS.includes(msg.author.id)) return

  const channelId = msg.channelId
  const agentName = resolveAgentForChannel(channelId)

  // If no routing → deliver to primary agent (the orchestrator running this server)
  const target = agentName ?? PRIMARY

  // Orchestrator's channel: deliver as MCP notification
  if (isPrimaryChannel(channelId) || target === PRIMARY) {
    void mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: msg.content || (msg.attachments.size > 0 ? '(attachment)' : ''),
        meta: {
          chat_id: channelId,
          message_id: msg.id,
          user: msg.author.username,
          user_id: msg.author.id,
          ts: msg.createdAt.toISOString(),
          ...(msg.attachments.size > 0 ? { attachment_count: String(msg.attachments.size) } : {}),
        },
      },
    }).catch(e => process.stderr.write(`claudecord: MCP notification failed: ${e}\n`))
    return
  }

  // Other agents: route via tmux
  process.stderr.write(`claudecord: routing message to ${target} (channel ${channelId})\n`)
  sendToAgent(target, msg)
})

client.on('error', err => {
  process.stderr.write(`claudecord: discord client error: ${err}\n`)
})

// ---- Startup ---------------------------------------------------------------

process.on('unhandledRejection', err => {
  process.stderr.write(`claudecord: unhandled rejection: ${err}\n`)
})
process.on('uncaughtException', err => {
  process.stderr.write(`claudecord: uncaught exception: ${err}\n`)
})

await mcp.connect(new StdioServerTransport())

httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
  process.stderr.write(`claudecord: HTTP side-channel on 127.0.0.1:${HTTP_PORT}\n`)
})

const SUB_AGENT_MODE = Boolean(process.env['AGENT_NAME'])

if (SUB_AGENT_MODE) {
  process.stderr.write('claudecord: sub-agent mode — Discord gateway disabled\n')
} else {
  client.once('ready', c => {
    process.stderr.write(`claudecord: gateway connected as ${c.user.tag}\n`)
  })

  client.login(TOKEN!).catch(err => {
    process.stderr.write(`claudecord: login failed: ${err}\n`)
    process.exit(1)
  })
}

// ---- Graceful shutdown -----------------------------------------------------

let shuttingDown = false
function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write('claudecord: shutting down\n')
  httpServer.close()
  setTimeout(() => process.exit(0), 2000)
  if (!SUB_AGENT_MODE) {
    void client.destroy().finally(() => process.exit(0))
  }
}

process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
