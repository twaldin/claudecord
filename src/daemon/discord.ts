import { Client, GatewayIntentBits, type Message } from 'discord.js'
import type { ChannelMessage } from '../shared/types.js'

const DISCORD_MAX_LENGTH = 2000

export interface DiscordClientDeps {
  token: string
  onMessage: (msg: ChannelMessage) => void
}

export function createDiscordClient(deps: DiscordClientDeps) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  })

  client.on('messageCreate', (message: Message) => {
    if (message.author.bot) return

    const channelMessage: ChannelMessage = {
      content: message.content,
      channelId: message.channelId,
      messageId: message.id,
      userId: message.author.id,
      username: message.author.username,
      timestamp: message.createdAt.toISOString(),
      attachments: message.attachments.size > 0
        ? message.attachments.map(a => ({
            name: a.name,
            url: a.url,
            size: a.size,
            contentType: a.contentType ?? 'application/octet-stream',
          }))
        : undefined,
    }

    deps.onMessage(channelMessage)
  })

  async function login() {
    await client.login(deps.token)
    console.log(`[discord] Logged in as ${client.user?.tag ?? 'unknown'}`)
  }

  async function sendToChannel(channelId: string, text: string, replyTo?: string) {
    const channel = await client.channels.fetch(channelId)
    if (!channel?.isTextBased() || !('send' in channel)) {
      throw new Error(`Channel ${channelId} is not a text channel`)
    }

    const chunks = splitMessage(text)

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!
      if (i === 0 && replyTo) {
        try {
          const original = await channel.messages.fetch(replyTo)
          await original.reply(chunk)
        } catch {
          // If we can't fetch the original message, just send normally
          await channel.send(chunk)
        }
      } else {
        await channel.send(chunk)
      }
    }
  }

  async function destroy() {
    await client.destroy()
  }

  return { login, sendToChannel, destroy }
}

export function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_LENGTH) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_LENGTH) {
      chunks.push(remaining)
      break
    }

    // Find last newline within the limit
    const slice = remaining.slice(0, DISCORD_MAX_LENGTH)
    const lastNewline = slice.lastIndexOf('\n')

    if (lastNewline > 0) {
      chunks.push(remaining.slice(0, lastNewline))
      remaining = remaining.slice(lastNewline + 1)
    } else {
      // No newline found — hard split
      chunks.push(slice)
      remaining = remaining.slice(DISCORD_MAX_LENGTH)
    }
  }

  return chunks
}
