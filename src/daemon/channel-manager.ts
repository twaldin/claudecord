import { writeFileSync, readFileSync, renameSync, existsSync } from 'fs'
import { ChannelType, type EmbedBuilder } from 'discord.js'
import type { AgentType, AgentChannelMeta, CleanupEmbedData, RoutingConfig } from '../shared/types.js'
import { buildSpawnEmbed, buildCleanupEmbed } from './embeds.js'
import { addAgentChannel } from './routing.js'

export interface ChannelLifecycle {
  channelId: string
  agentName: string
  agentType: AgentType
  status: 'active' | 'archived' | 'pending-cleanup'
  spawnedAt: string
  diedAt?: string
  cleanupMessageId?: string
  scheduledDeleteAt?: string
}

const CATEGORY_MAP: Record<string, string> = {
  coder: 'Coders',
  researcher: 'Research',
  evaluator: 'Reviews',
}

export function validateAgentName(name: string): boolean {
  return /^[a-z0-9-]{1,80}$/.test(name)
}

export function getCategoryName(agentType: AgentType): string | null {
  return CATEGORY_MAP[agentType] ?? null
}

export function loadChannelState(path: string): ChannelLifecycle[] {
  if (!existsSync(path)) return []
  return JSON.parse(readFileSync(path, 'utf8')) as ChannelLifecycle[]
}

export function saveChannelState(state: ChannelLifecycle[], path: string): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  renameSync(tmp, path)
}

interface DiscordChannelLike {
  permissionOverwrites: {
    create: (target: string, perms: Record<string, boolean>) => Promise<unknown>
  }
}

interface DiscordGuildLike {
  channels: {
    create: (opts: { name: string; type: number; parent?: string; topic?: string }) => Promise<{ id: string }>
    cache: { get(key: string): DiscordChannelLike | undefined }
  }
}

export interface ChannelManagerDeps {
  guildId: string
  everyoneRoleId: string
  routingConfig: RoutingConfig
  routingPath: string
  statePath: string
  client: { guilds: { cache: { get(key: string): DiscordGuildLike | undefined } } }
  sendEmbed: (channelId: string, embed: EmbedBuilder) => Promise<string>
  addReactions: (channelId: string, messageId: string, emojis: string[]) => Promise<void>
}

export interface ChannelManager {
  createAgentChannel(agentName: string, agentType: AgentType, task: string): Promise<string>
  archiveAgentChannel(channelId: string, agentName: string, cleanupData?: Partial<CleanupEmbedData>): Promise<void>
  handleCleanupReaction(channelId: string, emoji: string): void
  getState(): ChannelLifecycle[]
}

export function createChannelManager(deps: ChannelManagerDeps): ChannelManager {
  const { guildId, everyoneRoleId, routingConfig, routingPath, statePath, client, sendEmbed, addReactions } = deps
  let state = loadChannelState(statePath)

  function getGuild(): DiscordGuildLike {
    const guild = client.guilds.cache.get(guildId)
    if (!guild) throw new Error(`Guild ${guildId} not found`)
    return guild
  }

  async function createAgentChannel(agentName: string, agentType: AgentType, task: string): Promise<string> {
    const guild = getGuild()
    const channel = await guild.channels.create({ name: agentName, type: ChannelType.GuildText })

    const spawnedAt = new Date().toISOString()
    const embed = buildSpawnEmbed({ agentName, agentType, task, spawnedAt, channelName: agentName })
    await sendEmbed(channel.id, embed)

    const meta: AgentChannelMeta = { agentType, spawnedAt, task }
    addAgentChannel(routingConfig, agentName, channel.id, meta, routingPath)

    state = [...state, { channelId: channel.id, agentName, agentType, status: 'active', spawnedAt }]
    saveChannelState(state, statePath)

    return channel.id
  }

  async function archiveAgentChannel(
    channelId: string,
    agentName: string,
    cleanupData?: Partial<CleanupEmbedData>,
  ): Promise<void> {
    const guild = getGuild()
    const channel = guild.channels.cache.get(channelId)
    if (!channel) throw new Error(`Channel ${channelId} not found in guild cache`)

    await channel.permissionOverwrites.create(everyoneRoleId, { SendMessages: false })

    const diedAt = new Date().toISOString()
    const embed = buildCleanupEmbed({
      agentName,
      duration: cleanupData?.duration,
      worktreePath: cleanupData?.worktreePath,
      prNumber: cleanupData?.prNumber,
    })
    const cleanupMessageId = await sendEmbed(channelId, embed)
    await addReactions(channelId, cleanupMessageId, ['📦', '🗑️'])

    state = state.map(entry => {
      if (entry.channelId !== channelId) return entry
      return { ...entry, status: 'archived' as const, diedAt, cleanupMessageId }
    })
    saveChannelState(state, statePath)
  }

  function handleCleanupReaction(channelId: string, emoji: string): void {
    const newStatus = emoji === '📦' ? 'archived' : emoji === '🗑️' ? 'pending-cleanup' : null
    if (newStatus === null) return

    state = state.map(entry => {
      if (entry.channelId !== channelId) return entry
      return { ...entry, status: newStatus }
    })
    saveChannelState(state, statePath)
  }

  function getState(): ChannelLifecycle[] {
    return state
  }

  return { createAgentChannel, archiveAgentChannel, handleCleanupReaction, getState }
}
