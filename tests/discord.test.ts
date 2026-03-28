import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentEmbed } from '../src/shared/types.js'

// Hoisted mock state accessible in both vi.mock factory and tests
const mocks = vi.hoisted(() => {
  const mockSend = vi.fn()
  const mockEdit = vi.fn()
  const mockReact = vi.fn()
  const mockMessageReply = vi.fn()
  const mockMessagesFetch = vi.fn()
  const mockChannelFetch = vi.fn()
  const mockClientOn = vi.fn()
  const mockEmbedInstance = {
    setTitle: vi.fn().mockReturnThis(),
    setDescription: vi.fn().mockReturnThis(),
    setColor: vi.fn().mockReturnThis(),
    addFields: vi.fn().mockReturnThis(),
    setFooter: vi.fn().mockReturnThis(),
    setURL: vi.fn().mockReturnThis(),
    setThumbnail: vi.fn().mockReturnThis(),
  }

  return {
    mockSend, mockEdit, mockReact, mockMessageReply,
    mockMessagesFetch, mockChannelFetch, mockClientOn, mockEmbedInstance,
  }
})

vi.mock('discord.js', () => ({
  Client: vi.fn(() => ({
    on: mocks.mockClientOn,
    login: vi.fn().mockResolvedValue('token'),
    channels: { fetch: mocks.mockChannelFetch },
    user: { tag: 'TestBot#0000' },
    destroy: vi.fn().mockResolvedValue(undefined),
  })),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 512,
    MessageContent: 32768,
    GuildMessageReactions: 64,
  },
  EmbedBuilder: vi.fn(() => mocks.mockEmbedInstance),
}))

// Import after mocks are set up
import { createDiscordClient } from '../src/daemon/discord.js'
import { Client } from 'discord.js'

describe('discord client — Phase 3 extensions', () => {
  let discord: ReturnType<typeof createDiscordClient>

  beforeEach(() => {
    vi.clearAllMocks()

    // Re-setup EmbedBuilder chainable methods after clear
    mocks.mockEmbedInstance.setTitle.mockReturnValue(mocks.mockEmbedInstance)
    mocks.mockEmbedInstance.setDescription.mockReturnValue(mocks.mockEmbedInstance)
    mocks.mockEmbedInstance.setColor.mockReturnValue(mocks.mockEmbedInstance)
    mocks.mockEmbedInstance.addFields.mockReturnValue(mocks.mockEmbedInstance)
    mocks.mockEmbedInstance.setFooter.mockReturnValue(mocks.mockEmbedInstance)
    mocks.mockEmbedInstance.setURL.mockReturnValue(mocks.mockEmbedInstance)
    mocks.mockEmbedInstance.setThumbnail.mockReturnValue(mocks.mockEmbedInstance)

    // Default channel/message returns
    mocks.mockSend.mockResolvedValue({ id: 'msg-123' })
    mocks.mockEdit.mockResolvedValue({ id: 'msg-edited' })
    mocks.mockReact.mockResolvedValue(undefined)
    mocks.mockMessageReply.mockResolvedValue({ id: 'msg-reply' })
    mocks.mockMessagesFetch.mockResolvedValue({
      edit: mocks.mockEdit,
      react: mocks.mockReact,
      reply: mocks.mockMessageReply,
    })
    mocks.mockChannelFetch.mockResolvedValue({
      isTextBased: () => true,
      send: mocks.mockSend,
      messages: { fetch: mocks.mockMessagesFetch },
    })

    discord = createDiscordClient({
      token: 'test-token',
      onMessage: vi.fn(),
    })
  })

  describe('GuildMessageReactions intent', () => {
    it('includes GuildMessageReactions (64) in client intents', () => {
      expect(vi.mocked(Client)).toHaveBeenCalledWith(
        expect.objectContaining({
          intents: expect.arrayContaining([64]),
        })
      )
    })
  })

  describe('sendToChannel with string (backwards compat)', () => {
    it('sends plain text unchanged', async () => {
      await discord.sendToChannel('ch1', 'hello world')
      expect(mocks.mockSend).toHaveBeenCalledWith('hello world')
    })
  })

  describe('sendToChannel with embed object', () => {
    it('builds EmbedBuilder from AgentEmbed and sends it', async () => {
      const embed: AgentEmbed = { title: 'Test', description: 'Hello', color: 0x5865F2 }
      await discord.sendToChannel('ch1', { text: 'intro', embed })

      expect(mocks.mockEmbedInstance.setTitle).toHaveBeenCalledWith('Test')
      expect(mocks.mockEmbedInstance.setDescription).toHaveBeenCalledWith('Hello')
      expect(mocks.mockEmbedInstance.setColor).toHaveBeenCalledWith(0x5865F2)
      expect(mocks.mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'intro', embeds: [mocks.mockEmbedInstance] })
      )
    })

    it('sends embed without content key when text is absent', async () => {
      await discord.sendToChannel('ch1', { embed: { title: 'Only Embed' } })
      const callArg = mocks.mockSend.mock.calls[0]?.[0]
      expect(callArg.content).toBeUndefined()
      expect(callArg.embeds).toBeDefined()
    })

    it('sets fields on embed from AgentEmbed fields array', async () => {
      const embed: AgentEmbed = {
        fields: [{ name: 'Status', value: 'running', inline: true }],
      }
      await discord.sendToChannel('ch1', { embed })
      expect(mocks.mockEmbedInstance.addFields).toHaveBeenCalledWith({
        name: 'Status',
        value: 'running',
        inline: true,
      })
    })

    it('sets footer on embed when provided', async () => {
      await discord.sendToChannel('ch1', { embed: { footer: 'Agent done' } })
      expect(mocks.mockEmbedInstance.setFooter).toHaveBeenCalledWith({ text: 'Agent done' })
    })
  })

  describe('editMessage', () => {
    it('fetches the channel and message then edits with text', async () => {
      await discord.editMessage('ch1', 'msg1', { text: 'updated text' })

      expect(mocks.mockChannelFetch).toHaveBeenCalledWith('ch1')
      expect(mocks.mockMessagesFetch).toHaveBeenCalledWith('msg1')
      expect(mocks.mockEdit).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'updated text' })
      )
    })

    it('edits message with an embed', async () => {
      const embed: AgentEmbed = { title: 'Status Board', color: 0x57F287 }
      await discord.editMessage('ch1', 'msg1', { embed })

      expect(mocks.mockEmbedInstance.setTitle).toHaveBeenCalledWith('Status Board')
      expect(mocks.mockEmbedInstance.setColor).toHaveBeenCalledWith(0x57F287)
      expect(mocks.mockEdit).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: [mocks.mockEmbedInstance] })
      )
    })

    it('edits with both text and embed', async () => {
      await discord.editMessage('ch1', 'msg1', { text: 'header', embed: { title: 'Board' } })
      expect(mocks.mockEdit).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'header', embeds: [mocks.mockEmbedInstance] })
      )
    })
  })

  describe('sendEmbed', () => {
    it('sends embed to channel and returns the message ID', async () => {
      mocks.mockSend.mockResolvedValueOnce({ id: 'status-msg-456' })
      const embed: AgentEmbed = { title: 'Status', color: 0x57F287 }

      const msgId = await discord.sendEmbed('ch1', embed)

      expect(msgId).toBe('status-msg-456')
      expect(mocks.mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: [mocks.mockEmbedInstance] })
      )
    })

    it('does not include content key when calling sendEmbed', async () => {
      mocks.mockSend.mockResolvedValueOnce({ id: 'msg-789' })
      await discord.sendEmbed('ch1', { title: 'Only Embed' })
      const callArg = mocks.mockSend.mock.calls[0]?.[0]
      expect(callArg.content).toBeUndefined()
    })
  })

  describe('addReactions', () => {
    it('adds each emoji as a reaction to the message', async () => {
      await discord.addReactions('ch1', 'msg1', ['📦', '🗑️'])

      expect(mocks.mockMessagesFetch).toHaveBeenCalledWith('msg1')
      expect(mocks.mockReact).toHaveBeenCalledTimes(2)
      expect(mocks.mockReact).toHaveBeenNthCalledWith(1, '📦')
      expect(mocks.mockReact).toHaveBeenNthCalledWith(2, '🗑️')
    })

    it('does nothing when emojis array is empty', async () => {
      await discord.addReactions('ch1', 'msg1', [])
      expect(mocks.mockReact).not.toHaveBeenCalled()
    })
  })

  describe('reaction forwarding', () => {
    it('calls onReaction when messageReactionAdd fires', () => {
      const onReaction = vi.fn()
      createDiscordClient({
        token: 'test-token',
        onMessage: vi.fn(),
        onReaction,
      })

      // The second client's handler is the last messageReactionAdd registration
      const allReactionCalls = mocks.mockClientOn.mock.calls
        .filter((call) => call[0] === 'messageReactionAdd')
      const reactionHandler = allReactionCalls[allReactionCalls.length - 1]?.[1]

      expect(reactionHandler).toBeDefined()

      reactionHandler(
        { emoji: { name: '📦', id: null }, message: { id: 'cleanup-msg' } },
        { bot: false, id: 'user-abc' }
      )

      expect(onReaction).toHaveBeenCalledWith('cleanup-msg', '📦', 'user-abc')
    })

    it('does not call onReaction for bot reactions', () => {
      const onReaction = vi.fn()
      createDiscordClient({
        token: 'test-token',
        onMessage: vi.fn(),
        onReaction,
      })

      const allReactionCalls = mocks.mockClientOn.mock.calls
        .filter((call) => call[0] === 'messageReactionAdd')
      const reactionHandler = allReactionCalls[allReactionCalls.length - 1]?.[1]

      reactionHandler(
        { emoji: { name: '📦', id: null }, message: { id: 'cleanup-msg' } },
        { bot: true, id: 'bot-123' }
      )

      expect(onReaction).not.toHaveBeenCalled()
    })

    it('does not throw when onReaction is not provided', () => {
      // discord was created in beforeEach without onReaction
      const reactionHandler = mocks.mockClientOn.mock.calls
        .find((call) => call[0] === 'messageReactionAdd')?.[1]

      expect(() =>
        reactionHandler(
          { emoji: { name: '📦', id: null }, message: { id: 'msg' } },
          { bot: false, id: 'user-1' }
        )
      ).not.toThrow()
    })
  })
})
