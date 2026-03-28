import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  validateAgentName,
  getCategoryName,
  loadChannelState,
  saveChannelState,
  createChannelManager,
} from '../src/daemon/channel-manager.js'
import type { RoutingConfig } from '../src/shared/types.js'

let tmpDir: string
let statePath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'claudecord-cm-'))
  statePath = join(tmpDir, 'channel-state.json')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true })
  vi.clearAllMocks()
})

describe('loadChannelState', () => {
  it('returns empty array when file missing', () => {
    expect(loadChannelState(join(tmpDir, 'nonexistent.json'))).toEqual([])
  })
})

describe('saveChannelState + loadChannelState', () => {
  it('round-trips state correctly', () => {
    const state = [
      {
        channelId: 'ch-1',
        agentName: 'coder-fix-49',
        agentType: 'coder' as const,
        status: 'active' as const,
        spawnedAt: '2026-03-28T12:00:00.000Z',
      },
    ]
    saveChannelState(state, statePath)
    expect(loadChannelState(statePath)).toEqual(state)
  })
})

describe('validateAgentName', () => {
  it('accepts valid lowercase hyphenated names', () => {
    expect(validateAgentName('coder-fix-49')).toBe(true)
    expect(validateAgentName('researcher-spacex')).toBe(true)
    expect(validateAgentName('a')).toBe(true)
  })

  it('rejects names with uppercase letters', () => {
    expect(validateAgentName('Coder-Fix')).toBe(false)
  })

  it('rejects names with spaces', () => {
    expect(validateAgentName('coder fix')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(validateAgentName('')).toBe(false)
  })

  it('rejects names longer than 80 characters', () => {
    expect(validateAgentName('a'.repeat(81))).toBe(false)
  })

  it('accepts names with numbers and hyphens', () => {
    expect(validateAgentName('coder-123-fix')).toBe(true)
  })
})

describe('getCategoryName', () => {
  it('maps coder to Coders', () => {
    expect(getCategoryName('coder')).toBe('Coders')
  })

  it('maps researcher to Research', () => {
    expect(getCategoryName('researcher')).toBe('Research')
  })

  it('maps evaluator to Reviews', () => {
    expect(getCategoryName('evaluator')).toBe('Reviews')
  })

  it('returns null for persistent', () => {
    expect(getCategoryName('persistent')).toBeNull()
  })
})

function makeDeps(dir: string) {
  const guildId = 'test-guild'
  const everyoneRoleId = 'everyone-role'
  const routingPath = join(dir, 'routing.json')
  const sp = join(dir, 'channel-state.json')

  const mockChannel = {
    id: 'new-channel-id',
    permissionOverwrites: { create: vi.fn().mockResolvedValue(undefined) },
  }

  const mockGuild = {
    channels: {
      create: vi.fn().mockResolvedValue(mockChannel),
      cache: new Map<string, typeof mockChannel>([['existing-channel-id', mockChannel]]),
    },
  }

  const mockClient = {
    guilds: { cache: new Map([[guildId, mockGuild]]) },
  }

  const mockSendEmbed = vi.fn().mockResolvedValue('embed-msg-id')
  const mockAddReactions = vi.fn().mockResolvedValue(undefined)

  const routingConfig: RoutingConfig = { agents: {} }

  return {
    deps: {
      guildId,
      everyoneRoleId,
      routingConfig,
      routingPath,
      statePath: sp,
      client: mockClient,
      sendEmbed: mockSendEmbed as (channelId: string, embed: unknown) => Promise<string>,
      addReactions: mockAddReactions as (channelId: string, messageId: string, emojis: string[]) => Promise<void>,
    },
    mockChannel,
    mockGuild,
    mockSendEmbed,
    mockAddReactions,
    routingConfig,
  }
}

describe('createAgentChannel', () => {
  it('throws for persistent agents', async () => {
    const { deps } = makeDeps(tmpDir)
    const manager = createChannelManager(deps)
    await expect(manager.createAgentChannel('trader', 'persistent', 'trade')).rejects.toThrow(
      /persistent/
    )
  })

  it('calls guild.channels.create with agent name', async () => {
    const { deps, mockGuild } = makeDeps(tmpDir)
    const manager = createChannelManager(deps)
    await manager.createAgentChannel('coder-fix-49', 'coder', 'Fix bug')
    expect(mockGuild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'coder-fix-49' })
    )
  })

  it('posts spawn embed to the new channel', async () => {
    const { deps, mockSendEmbed } = makeDeps(tmpDir)
    const manager = createChannelManager(deps)
    await manager.createAgentChannel('coder-fix-49', 'coder', 'Fix bug')
    expect(mockSendEmbed).toHaveBeenCalledWith('new-channel-id', expect.anything())
  })

  it('updates routing config with new channel', async () => {
    const { deps, routingConfig } = makeDeps(tmpDir)
    const manager = createChannelManager(deps)
    await manager.createAgentChannel('coder-fix-49', 'coder', 'Fix bug')
    expect(routingConfig.agents['coder-fix-49']?.channels).toContain('new-channel-id')
  })

  it('saves channel lifecycle to state file', async () => {
    const { deps } = makeDeps(tmpDir)
    const manager = createChannelManager(deps)
    await manager.createAgentChannel('coder-fix-49', 'coder', 'Fix bug')
    const state = loadChannelState(deps.statePath)
    expect(state[0]?.channelId).toBe('new-channel-id')
    expect(state[0]?.agentName).toBe('coder-fix-49')
    expect(state[0]?.status).toBe('active')
  })

  it('returns the new channel id', async () => {
    const { deps } = makeDeps(tmpDir)
    const manager = createChannelManager(deps)
    const channelId = await manager.createAgentChannel('coder-fix-49', 'coder', 'Fix bug')
    expect(channelId).toBe('new-channel-id')
  })
})

describe('archiveAgentChannel', () => {
  it('sets channel read-only via permissionOverwrites', async () => {
    const { deps, mockChannel } = makeDeps(tmpDir)
    const manager = createChannelManager(deps)
    await manager.archiveAgentChannel('existing-channel-id', 'coder-fix-49')
    expect(mockChannel.permissionOverwrites.create).toHaveBeenCalledWith(
      'everyone-role',
      expect.objectContaining({ SendMessages: false })
    )
  })

  it('posts cleanup embed to the channel', async () => {
    const { deps, mockSendEmbed } = makeDeps(tmpDir)
    const manager = createChannelManager(deps)
    await manager.archiveAgentChannel('existing-channel-id', 'coder-fix-49')
    expect(mockSendEmbed).toHaveBeenCalledWith('existing-channel-id', expect.anything())
  })

  it('adds archive and delete reactions to cleanup message', async () => {
    const { deps, mockAddReactions } = makeDeps(tmpDir)
    const manager = createChannelManager(deps)
    await manager.archiveAgentChannel('existing-channel-id', 'coder-fix-49')
    expect(mockAddReactions).toHaveBeenCalledWith('existing-channel-id', 'embed-msg-id', ['📦', '🗑️'])
  })
})

describe('handleCleanupReaction', () => {
  it('sets status to archived for 📦 emoji', async () => {
    const { deps } = makeDeps(tmpDir)
    const manager = createChannelManager(deps)
    await manager.createAgentChannel('coder-fix-49', 'coder', 'Fix bug')
    manager.handleCleanupReaction('new-channel-id', '📦')
    const entry = manager.getState().find(e => e.channelId === 'new-channel-id')
    expect(entry?.status).toBe('archived')
  })

  it('sets status to pending-cleanup for 🗑️ emoji', async () => {
    const { deps } = makeDeps(tmpDir)
    const manager = createChannelManager(deps)
    await manager.createAgentChannel('coder-fix-49', 'coder', 'Fix bug')
    manager.handleCleanupReaction('new-channel-id', '🗑️')
    const entry = manager.getState().find(e => e.channelId === 'new-channel-id')
    expect(entry?.status).toBe('pending-cleanup')
  })
})
