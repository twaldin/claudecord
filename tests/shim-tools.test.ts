import { describe, it, expect } from 'vitest'
import { formatChannelMessage, REPLY_TOOL } from '../src/shim/tools.js'
import type { ChannelMessage } from '../src/shared/types.js'

describe('formatChannelMessage', () => {
  it('formats a message with correct meta fields', () => {
    const msg: ChannelMessage = {
      content: 'hello world',
      channelId: '123456',
      messageId: 'msg789',
      userId: 'user42',
      username: 'timbot',
      timestamp: '2026-03-25T12:00:00.000Z',
    }

    const result = formatChannelMessage(msg)

    expect(result.content).toBe('hello world')
    expect(result.meta).toEqual({
      chat_id: '123456',
      message_id: 'msg789',
      user: 'timbot',
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
      username: 'user',
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

describe('REPLY_TOOL', () => {
  it('has claudecord_reply as name', () => {
    expect(REPLY_TOOL.name).toBe('claudecord_reply')
  })

  it('requires chat_id in schema', () => {
    expect(REPLY_TOOL.inputSchema.required).toContain('chat_id')
  })

  it('does not require text (optional for embed-only replies)', () => {
    expect(REPLY_TOOL.inputSchema.required).not.toContain('text')
  })

  it('has embed as an optional object property in schema', () => {
    const props = REPLY_TOOL.inputSchema.properties
    expect(props.embed).toBeDefined()
    expect(props.embed?.type).toBe('object')
  })

  it('embed schema has title, description, color, fields, footer as optional properties', () => {
    const embedProps = REPLY_TOOL.inputSchema.properties.embed?.properties
    expect(embedProps?.title).toBeDefined()
    expect(embedProps?.description).toBeDefined()
    expect(embedProps?.color).toBeDefined()
    expect(embedProps?.fields).toBeDefined()
    expect(embedProps?.footer).toBeDefined()
  })

  it('still has text as an optional property', () => {
    expect(REPLY_TOOL.inputSchema.properties.text).toBeDefined()
  })
})
