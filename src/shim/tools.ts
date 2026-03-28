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
  description: 'Send a reply to a Discord channel via the Claudecord daemon.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      chat_id: {
        type: 'string' as const,
        description: 'The Discord channel ID to send the reply to.',
      },
      text: {
        type: 'string' as const,
        description: 'The message text to send.',
      },
      reply_to: {
        type: 'string' as const,
        description: 'Optional message ID to reply to.',
      },
    },
    required: ['chat_id', 'text'] as const,
  },
}
