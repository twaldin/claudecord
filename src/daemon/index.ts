import { resolve } from 'path'
import { homedir } from 'os'
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'fs'
import { config } from 'dotenv'
import { createDiscordClient } from './discord.js'
import { createHttpApi, persistState } from './http-api.js'
import { loadRouting, resolveAgent } from './routing.js'
import { createChannelManager, type ChannelManagerDeps, type ChannelManager } from './channel-manager.js'
import { createStatusBoard } from './status-board.js'
import { registerSlashCommands, handleInteraction } from './slash-commands.js'
import { loadStats, getStatsForPeriod } from './stats.js'
import type { AgentStateEntry, AgentType } from '../shared/types.js'
import type { SlashCommandDeps } from './slash-commands.js'

const PID_FILE = resolve(homedir(), '.claudecord-daemon.pid')

function cleanupOldPid() {
  if (!existsSync(PID_FILE)) return

  const oldPid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)
  if (isNaN(oldPid)) {
    unlinkSync(PID_FILE)
    return
  }

  try {
    // Check if process is still running (signal 0 doesn't kill, just checks)
    process.kill(oldPid, 0)
    console.log(`[daemon] Killing old daemon process ${oldPid}`)
    process.kill(oldPid, 'SIGTERM')
  } catch {
    // Process not running, just clean up the file
  }

  unlinkSync(PID_FILE)
}

function writePid() {
  writeFileSync(PID_FILE, String(process.pid), 'utf8')
  console.log(`[daemon] PID ${process.pid} written to ${PID_FILE}`)
}

function removePid() {
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE)
    }
  } catch {
    // Best effort
  }
}

async function main() {
  config() // Load .env

  const discordToken = process.env['DISCORD_BOT_TOKEN']
  if (!discordToken) {
    console.error('[daemon] DISCORD_BOT_TOKEN not set')
    process.exit(1)
  }

  const port = parseInt(process.env['CLAUDECORD_ROUTER_PORT'] ?? '19532', 10)
  const routingPath = resolve(
    process.env['ROUTING_CONFIG'] ?? resolve(import.meta.dirname, '../../config/routing.json')
  )

  let routingConfig = loadRouting(routingPath)
  console.log(`[daemon] Loaded routing: ${Object.keys(routingConfig.agents).join(', ')}`)

  const agentStatePath = resolve(homedir(), '.claudecord-agent-state.json')

  const guildId = process.env['DISCORD_GUILD_ID']
  const codeStatusChannelId = process.env['DISCORD_CODE_STATUS_CHANNEL_ID']
  const channelStatePath = resolve(homedir(), '.claudecord-channels.json')

  // Clean up old daemon if running
  cleanupOldPid()
  writePid()

  let channelManager: ChannelManager | null = null

  const discord = createDiscordClient({
    token: discordToken,
    onMessage: (msg) => {
      let agentName = resolveAgent(routingConfig, msg.channelId)
      // Fallback: check agent registry for ephemeral channel routing
      if (!agentName) {
        const registry = api.getAgentRegistry()
        for (const [name, entry] of registry) {
          if (entry.channelId === msg.channelId && entry.status === 'alive') {
            agentName = name
            break
          }
        }
      }
      if (!agentName) {
        console.log(`[daemon] No agent for channel ${msg.channelId}, dropping message`)
        return
      }
      console.log(`[daemon] ${msg.username} → ${agentName} (${msg.channelId}): ${msg.content.slice(0, 80)}`)
      api.enqueueMessage(agentName, msg)
    },
    onReaction: (messageId, emoji) => {
      if (!channelManager) return
      const entry = channelManager.getState().find(e => e.cleanupMessageId === messageId)
      if (entry) channelManager.handleCleanupReaction(entry.channelId, emoji)
    },
  })

  const api = createHttpApi({
    agentStatePath,
    onReply: async (reply) => {
      if (reply.embed !== undefined) {
        await discord.sendToChannel(
          reply.channelId,
          { text: reply.text, embed: reply.embed },
          reply.replyTo
        )
      } else {
        await discord.sendToChannel(reply.channelId, reply.text ?? '', reply.replyTo)
      }
    },
    onAgentSpawn: async (data) => {
      if (!channelManager) return { channelId: '' }
      const channelId = await channelManager.createAgentChannel(data.agentName, data.agentType, data.task)
      return { channelId }
    },
    onAgentDied: async ({ agentName }) => {
      if (!channelManager) return
      const entry = channelManager.getState().find(e => e.agentName === agentName && e.status === 'active')
      if (!entry) return
      await channelManager.archiveAgentChannel(entry.channelId, agentName)
    },
    onWorkCompleted: async (data) => {
      console.log('[daemon] work-completed:', data.agentName)
    },
    onAgentHeartbeat: async (data) => {
      console.log('[daemon] heartbeat:', data.agentName, data.status, data.contextPct)
    },
  })

  // Hydrate registry from agent-state.json
  if (existsSync(agentStatePath)) {
    try {
      const raw = JSON.parse(readFileSync(agentStatePath, 'utf8')) as {
        schemaVersion: number
        agents: Record<string, AgentStateEntry>
      }
      if (raw.schemaVersion === 1 && raw.agents) {
        api.hydrateRegistry(raw.agents)
        console.log(`[daemon] Hydrated ${Object.keys(raw.agents).length} agents from agent-state.json`)
      }
    } catch (err) {
      console.error('[daemon] Failed to load agent-state.json:', err instanceof Error ? err.message : err)
    }
  }

  // Bootstrap synthetic entries for persistent agents in routing.json not already in registry
  const registry = api.getAgentRegistry()
  for (const [agentName, agentConfig] of Object.entries(routingConfig.agents)) {
    if (!registry.has(agentName)) {
      const channelId = agentConfig.channels[0] ?? null
      const syntheticEntry: AgentStateEntry = {
        name: agentName,
        lifecycle: 'persistent',
        type: (agentConfig.meta?.agentType ?? 'persistent') as AgentType,
        status: 'alive',
        directory: '',
        spawnedAt: agentConfig.meta?.spawnedAt ?? new Date().toISOString(),
        diedAt: null,
        model: 'sonnet',
        channelId: channelId ?? null,
        contextPct: null,
        agentStatus: null,
        task: agentConfig.meta?.task ?? null,
        shimConnected: false,
        lastHeartbeatAt: null,
      }
      registry.set(agentName, syntheticEntry)
      console.log(`[daemon] Bootstrapped synthetic entry for ${agentName}`)
    }
  }

  await discord.login()

  if (guildId) {
    registerSlashCommands(discord.client, guildId)

    if (codeStatusChannelId) {
      console.log(`[daemon] Code status channel: ${codeStatusChannelId}`)
    }
    const cmDeps: ChannelManagerDeps = {
      guildId,
      everyoneRoleId: guildId,
      routingConfig,
      routingPath,
      statePath: channelStatePath,
      client: discord.client as ChannelManagerDeps['client'],
      sendEmbed: discord.sendBuiltEmbed,
      addReactions: discord.addReactions,
    }
    channelManager = createChannelManager(cmDeps)
    console.log('[daemon] Channel manager initialized')
    const cm = channelManager as ChannelManager & { runCleanupTimer?: () => void }
    setInterval(() => cm.runCleanupTimer?.(), 10 * 60 * 1000)
  } else {
    console.warn('[daemon] DISCORD_GUILD_ID not set, channel manager disabled')
  }

  // Wire slash command interaction handler
  const statsFilePath = resolve(homedir(), '.claudecord-stats.json')
  const tasksFilePath = process.env['TASKS_PATH'] ?? resolve(import.meta.dirname, '../../agents/orchestrator/memory/tasks.md')
  const allowedUserIds = process.env['DISCORD_ALLOWED_USERS']
    ?.split(',').map(s => s.trim()).filter(Boolean) ?? []

  function buildSnapshot() {
    const now = new Date().toISOString()
    const agents = Array.from(registry.values())
      .filter(e => e.status === 'alive')
      .map(e => ({
        name: e.name,
        type: e.type,
        status: e.agentStatus ?? ('idle' as const),
        contextPct: e.contextPct ?? undefined,
        lastActivity: e.lastHeartbeatAt ?? e.spawnedAt,
        channelId: e.channelId ?? undefined,
      }))
    return { agents, taskCounts: { p0: 0, p1: 0, p2: 0 }, systemHealth: 'healthy' as const, lastUpdated: now }
  }

  const slashDeps: SlashCommandDeps = {
    getSnapshot: buildSnapshot,
    getStats: (period) => getStatsForPeriod(loadStats(statsFilePath), period),
    getRegisteredAgents: () => api.getRegisteredAgents(),
    channelManager: channelManager ?? undefined,
    allowedUsers: allowedUserIds,
    statsPath: statsFilePath,
    tasksPath: tasksFilePath,
  }

  discord.client.on('interactionCreate', (interaction) => {
    if (!interaction.isChatInputCommand() && !interaction.isAutocomplete()) return
    void handleInteraction(interaction, slashDeps)
  })

  if (process.env['DISCORD_STATUS_CHANNEL_ID']) {
    const statusBoard = createStatusBoard({
      sendEmbed: discord.sendBuiltEmbed,
      editMessage: discord.editBuiltEmbed,
      channelId: process.env['DISCORD_STATUS_CHANNEL_ID'],
      getSnapshot: buildSnapshot,
      intervalMs: 60000,
    })
    statusBoard.start()
    console.log('[daemon] Status board started')
  }

  const server = api.app.listen(port, () => {
    console.log(`[daemon] HTTP API listening on port ${port}`)
  })

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[daemon] Shutting down...')
    if (agentStatePath) {
      try {
        const agents: Record<string, AgentStateEntry> = {}
        for (const [name, entry] of registry) {
          agents[name] = entry
        }
        persistState({ schemaVersion: 1, agents }, agentStatePath)
        console.log('[daemon] Agent state persisted')
      } catch {}
    }
    removePid()
    server.close()
    await discord.destroy()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((err) => {
  console.error('[daemon] Fatal error:', err)
  removePid()
  process.exit(1)
})
