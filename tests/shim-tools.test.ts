import { describe, it, expect } from 'vitest'
import { formatChannelMessage } from '../src/shim/tools.js'
import type { ChannelMessage } from '../src/shared/types.js'

describe('formatChannelMessage', () => {
  it('formats a message with correct meta fields', () => {
    const msg: ChannelMessage = {
      content: 'hello world',
      channelId: '123456',
      messageId: 'msg789',
      userId: 'user42',
      username: 'testuser',
      timestamp: '2026-03-25T12:00:00.000Z',
    }

    const result = formatChannelMessage(msg)

    expect(result.content).toBe('hello world')
    expect(result.meta).toEqual({
      chat_id: '123456',
      message_id: 'msg789',
      user: 'testuser',
      user_id: 'user42',
      ts: '2026-03-25T12:00:00.000Z',
      source: 'discord',
    })
  })

  it('preserves attachment info in the original message', () => {
    const msg: ChannelMessage = {
      content: 'file attached',
      channelId: '123',
      messageId: 'msg1',
      userId: 'u1',
      username: 'testuser',
      timestamp: '2026-03-25T12:00:00.000Z',
      attachments: [
        { name: 'test.png', url: 'https://cdn.discord.com/test.png', size: 1024, contentType: 'image/png' },
      ],
    }

    const result = formatChannelMessage(msg)
    expect(result.content).toBe('file attached')
    expect(result.meta.source).toBe('discord')
  })
})
