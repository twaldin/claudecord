import type { ChannelMessage } from '../shared/types.js'

export function formatChannelMessage(msg: ChannelMessage): {
  content: string
  meta: {
    chat_id: string
    message_id: string
    user: string
    user_id: string
    ts: string
    source: string
  }
} {
  return {
    content: msg.content,
    meta: {
      chat_id: msg.channelId,
      message_id: msg.messageId,
      user: msg.username,
      user_id: msg.userId,
      ts: msg.timestamp,
      source: 'discord',
    },
  }
}

export const REPLY_TOOL = {
  name: 'claudecord_reply',
  description: 'Send a reply to a Discord channel via the Claudecord daemon. Provide text, embed, or both.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      chat_id: {
        type: 'string' as const,
        description: 'The Discord channel ID to send the reply to.',
      },
      text: {
        type: 'string' as const,
        description: 'The message text to send. Optional if embed is provided.',
      },
      embed: {
        type: 'object' as const,
        description: 'Optional rich embed to include in the reply.',
        properties: {
          title: { type: 'string' as const },
          description: { type: 'string' as const },
          color: { type: 'number' as const },
          fields: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                name: { type: 'string' as const },
                value: { type: 'string' as const },
                inline: { type: 'boolean' as const },
              },
              required: ['name', 'value'] as const,
            },
          },
          footer: { type: 'string' as const },
          url: { type: 'string' as const },
          thumbnailUrl: { type: 'string' as const },
        },
      },
      reply_to: {
        type: 'string' as const,
        description: 'Optional message ID to reply to.',
      },
    },
    required: ['chat_id'] as const,
  },
}
