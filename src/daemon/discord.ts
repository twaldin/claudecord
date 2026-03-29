import { Client, GatewayIntentBits, EmbedBuilder, type Message } from 'discord.js'
import type { MessageCreateOptions, MessageEditOptions } from 'discord.js'
import type { ChannelMessage, AgentEmbed } from '../shared/types.js'

const DISCORD_MAX_LENGTH = 2000

export interface DiscordClientDeps {
  token: string
  onMessage: (msg: ChannelMessage) => void
  onReaction?: (messageId: string, emoji: string, userId: string) => void
}

function buildEmbedFromAgentEmbed(agentEmbed: AgentEmbed): EmbedBuilder {
  const embed = new EmbedBuilder()
  if (agentEmbed.title !== undefined) embed.setTitle(agentEmbed.title)
  if (agentEmbed.description !== undefined) embed.setDescription(agentEmbed.description)
  if (agentEmbed.color !== undefined) embed.setColor(agentEmbed.color)
  if (agentEmbed.fields) {
    for (const field of agentEmbed.fields) {
      embed.addFields({ name: field.name, value: field.value, inline: field.inline })
    }
  }
  if (agentEmbed.footer !== undefined) embed.setFooter({ text: agentEmbed.footer })
  if (agentEmbed.url !== undefined) embed.setURL(agentEmbed.url)
  if (agentEmbed.thumbnailUrl !== undefined) embed.setThumbnail(agentEmbed.thumbnailUrl)
  return embed
}

export function createDiscordClient(deps: DiscordClientDeps) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
  })

  const allowedUsers = process.env['DISCORD_ALLOWED_USERS']
    ?.split(',')
    .map(s => s.trim())
    .filter(Boolean)

  client.on('messageCreate', (message: Message) => {
    if (message.author.bot) return
    if (allowedUsers && allowedUsers.length > 0 && !allowedUsers.includes(message.author.id)) return

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

  client.on('messageReactionAdd', (reaction, user) => {
    if (user.bot) return
    if (!deps.onReaction) return
    const emoji = reaction.emoji.name ?? reaction.emoji.id ?? ''
    deps.onReaction(reaction.message.id, emoji, user.id)
  })

  async function login() {
    await client.login(deps.token)
    console.log(`[discord] Logged in as ${client.user?.tag ?? 'unknown'}`)
  }

  async function sendToChannel(
    channelId: string,
    content: string | { text?: string; embed?: AgentEmbed },
    replyTo?: string
  ): Promise<void> {
    const channel = await client.channels.fetch(channelId)
    if (!channel?.isTextBased() || !('send' in channel)) {
      throw new Error(`Channel ${channelId} is not a text channel`)
    }

    if (typeof content === 'string') {
      const chunks = splitMessage(content)
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!
        if (i === 0 && replyTo) {
          try {
            const original = await channel.messages.fetch(replyTo)
            await original.reply(chunk)
          } catch {
            await channel.send(chunk)
          }
        } else {
          await channel.send(chunk)
        }
      }
      return
    }

    // Object content path — embed present
    const builtEmbed = content.embed ? buildEmbedFromAgentEmbed(content.embed) : undefined
    const opts: MessageCreateOptions = {}
    if (content.text !== undefined) opts.content = content.text
    if (builtEmbed !== undefined) opts.embeds = [builtEmbed]

    if (replyTo) {
      try {
        const original = await channel.messages.fetch(replyTo)
        await original.reply(opts)
      } catch {
        await channel.send(opts)
      }
    } else {
      await channel.send(opts)
    }
  }

  async function editMessage(
    channelId: string,
    messageId: string,
    content: { text?: string; embed?: AgentEmbed }
  ): Promise<void> {
    const channel = await client.channels.fetch(channelId)
    if (!channel?.isTextBased() || !('messages' in channel)) {
      throw new Error(`Channel ${channelId} is not a text channel`)
    }
    const message = await channel.messages.fetch(messageId)
    const opts: MessageEditOptions = {}
    if (content.text !== undefined) opts.content = content.text
    if (content.embed !== undefined) opts.embeds = [buildEmbedFromAgentEmbed(content.embed)]
    await message.edit(opts)
  }

  async function sendEmbed(channelId: string, embed: AgentEmbed): Promise<string> {
    const channel = await client.channels.fetch(channelId)
    if (!channel?.isTextBased() || !('send' in channel)) {
      throw new Error(`Channel ${channelId} is not a text channel`)
    }
    const built = buildEmbedFromAgentEmbed(embed)
    const msg = await channel.send({ embeds: [built] })
    return msg.id
  }

  async function addReactions(channelId: string, messageId: string, emojis: string[]): Promise<void> {
    const channel = await client.channels.fetch(channelId)
    if (!channel?.isTextBased() || !('messages' in channel)) {
      throw new Error(`Channel ${channelId} is not a text channel`)
    }
    const message = await channel.messages.fetch(messageId)
    for (const emoji of emojis) {
      await message.react(emoji)
    }
  }

  async function sendBuiltEmbed(channelId: string, embed: EmbedBuilder): Promise<string> {
    const channel = await client.channels.fetch(channelId)
    if (!channel?.isTextBased() || !('send' in channel)) {
      throw new Error(`Channel ${channelId} is not a text channel`)
    }
    const msg = await channel.send({ embeds: [embed] })
    return msg.id
  }

  async function editBuiltEmbed(channelId: string, messageId: string, embed: EmbedBuilder): Promise<void> {
    const channel = await client.channels.fetch(channelId)
    if (!channel?.isTextBased() || !('messages' in channel)) {
      throw new Error(`Channel ${channelId} is not a text channel`)
    }
    const message = await channel.messages.fetch(messageId)
    await message.edit({ embeds: [embed] })
  }

  async function fetchRecentBotEmbed(channelId: string, limit = 10): Promise<string | null> {
    const channel = await client.channels.fetch(channelId)
    if (!channel?.isTextBased() || !('messages' in channel)) return null
    const messages = await channel.messages.fetch({ limit })
    const botId = client.user?.id
    const botMsg = messages.find(m => m.author.id === botId && m.embeds.length > 0)
    return botMsg?.id ?? null
  }

  async function destroy() {
    await client.destroy()
  }

  return {
    login,
    sendToChannel,
    editMessage,
    sendEmbed,
    addReactions,
    sendBuiltEmbed,
    editBuiltEmbed,
    fetchRecentBotEmbed,
    destroy,
    client,
  }
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
