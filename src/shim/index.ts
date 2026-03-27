import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { formatChannelMessage } from './tools.js'
import type { ChannelMessage, AgentReply } from '../shared/types.js'

const AGENT_NAME = process.env['CLAUDECORD_AGENT_NAME'] ?? 'default'
const DAEMON_URL = process.env['CLAUDECORD_DAEMON_URL'] ?? 'http://localhost:19532'
const POLL_INTERVAL_MS = 2000

async function daemonFetch(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${DAEMON_URL}${path}`, init)
  } catch {
    // Daemon unreachable — silent retry next poll
    return null
  }
}

async function registerWithDaemon(): Promise<boolean> {
  const res = await daemonFetch('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName: AGENT_NAME }),
  })
  if (!res) return false
  const data = await res.json() as { ok: boolean; bufferedMessages: number }
  if (data.ok) {
    console.error(`[shim] Registered as "${AGENT_NAME}" (${data.bufferedMessages} buffered messages)`)
  }
  return data.ok
}

async function pollMessages(): Promise<ChannelMessage[]> {
  const res = await daemonFetch(`/messages/${encodeURIComponent(AGENT_NAME)}`)
  if (!res) return []
  const data = await res.json() as { messages: ChannelMessage[] }
  return data.messages
}

async function sendReply(reply: AgentReply): Promise<boolean> {
  const res = await daemonFetch('/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reply),
  })
  if (!res) return false
  const data = await res.json() as { ok?: boolean; error?: string }
  if (data.error) {
    console.error(`[shim] Reply error: ${data.error}`)
    return false
  }
  return data.ok === true
}

async function main() {
  const server = new McpServer(
    {
      name: `claudecord-shim-${AGENT_NAME}`,
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        experimental: {
          'claude/channel': {},
        },
      },
    },
  )

  // Register the reply tool
  server.tool(
    'claudecord_reply',
    'Send a reply to a Discord channel via the Claudecord daemon.',
    {
      chat_id: z.string().describe('The Discord channel ID to send the reply to.'),
      text: z.string().describe('The message text to send.'),
      reply_to: z.string().optional().describe('Optional message ID to reply to.'),
    },
    async ({ chat_id, text, reply_to }) => {
      const success = await sendReply({
        channelId: chat_id,
        text,
        replyTo: reply_to,
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: success ? 'Reply sent.' : 'Failed to send reply — daemon may be unreachable.',
          },
        ],
      }
    },
  )

  // Connect transport
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[shim] MCP server started for agent "${AGENT_NAME}"`)

  // Register with daemon
  let registered = false
  while (!registered) {
    registered = await registerWithDaemon()
    if (!registered) {
      console.error('[shim] Daemon not reachable, retrying in 5s...')
      await new Promise(r => setTimeout(r, 5000))
    }
  }

  // Poll loop
  const poll = async () => {
    const messages = await pollMessages()
    for (const msg of messages) {
      const formatted = formatChannelMessage(msg)

      const meta: Record<string, string> = {
        chat_id: formatted.meta.chat_id,
        message_id: formatted.meta.message_id,
        user: formatted.meta.user,
        user_id: formatted.meta.user_id,
        ts: formatted.meta.ts,
      }

      if (msg.attachments && msg.attachments.length > 0) {
        meta['attachment_count'] = String(msg.attachments.length)
        meta['attachments'] = msg.attachments.map(a => `${a.name}(${a.contentType},${a.size})`).join(',')
      }

      try {
        await server.server.notification({
          method: 'notifications/claude/channel',
          params: {
            content: formatted.content,
            meta,
          },
        })
      } catch (err) {
        console.error('[shim] Failed to emit notification:', err instanceof Error ? err.message : err)
      }
    }
  }

  setInterval(() => void poll(), POLL_INTERVAL_MS)
}

main().catch((err) => {
  console.error('[shim] Fatal error:', err)
  process.exit(1)
})
