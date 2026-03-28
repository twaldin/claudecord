import { EmbedBuilder } from 'discord.js'
import type {
  SpawnEmbedData,
  CompletionEmbedData,
  HeartbeatEmbedData,
  PRReviewEmbedData,
  DeployEmbedData,
  CleanupEmbedData,
  StatusBoardData,
} from '../shared/types.js'

export const AGENT_COLORS = {
  coder:      0x5865F2,
  researcher: 0xED7D31,
  evaluator:  0xED4245,
  persistent: 0x57F287,
} as const

const GREEN  = 0x57F287
const RED    = 0xED4245
const YELLOW = 0xFEE75C
const GRAY   = 0x95A5A6

function healthColor(health: 'healthy' | 'degraded' | 'critical'): number {
  if (health === 'healthy') return GREEN
  if (health === 'degraded') return YELLOW
  return RED
}

export function buildSpawnEmbed(data: SpawnEmbedData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${data.agentName} spawned`)
    .setColor(AGENT_COLORS[data.agentType])
    .addFields({ name: 'Type', value: data.agentType, inline: true })
    .addFields({ name: 'Task', value: data.task, inline: false })

  if (data.issueNumber !== undefined) {
    embed.addFields({ name: 'Issue', value: `#${data.issueNumber}`, inline: true })
  }
  if (data.prNumber !== undefined) {
    embed.addFields({ name: 'PR', value: `#${data.prNumber}`, inline: true })
  }
  if (data.worktreePath) {
    embed.addFields({ name: 'Worktree', value: data.worktreePath, inline: false })
  }
  if (data.model) {
    embed.addFields({ name: 'Model', value: data.model, inline: true })
  }

  embed.addFields({ name: 'Spawned', value: `<t:${Math.floor(new Date(data.spawnedAt).getTime() / 1000)}:R>`, inline: true })

  const footerText = data.channelName
    ? `Watch progress in #${data.channelName}`
    : `Agent ${data.agentName} is now running`
  embed.setFooter({ text: footerText })

  return embed
}

export function buildCompletionEmbed(data: CompletionEmbedData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${data.agentName} completed`)
    .setColor(data.success ? GREEN : RED)

  if (data.duration) {
    embed.addFields({ name: 'Duration', value: data.duration, inline: true })
  }
  if (data.filesChanged !== undefined) {
    embed.addFields({ name: 'Files Changed', value: String(data.filesChanged), inline: true })
  }
  if (data.prNumber !== undefined) {
    embed.addFields({ name: 'PR', value: `#${data.prNumber}`, inline: true })
  }
  if (data.summary) {
    embed.addFields({ name: 'Summary', value: data.summary, inline: false })
  }

  const footerParts = [data.agentName]
  if (data.exitReason) footerParts.push(data.exitReason)
  embed.setFooter({ text: footerParts.join(' • ') })

  return embed
}

export function buildHeartbeatEmbed(data: HeartbeatEmbedData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('System Heartbeat')
    .setColor(healthColor(data.systemHealth))
    .addFields({
      name: 'Tasks',
      value: `P0: ${data.taskCounts.p0}  P1: ${data.taskCounts.p1}  P2: ${data.taskCounts.p2}`,
      inline: false,
    })

  for (const agent of data.agents) {
    const ctxStr = agent.contextPct !== undefined ? `  ctx: ${agent.contextPct}%` : ''
    embed.addFields({
      name: agent.name,
      value: `${agent.status}${ctxStr}`,
      inline: true,
    })
  }

  embed.addFields({ name: 'Active Agents', value: String(data.agents.length), inline: true })

  return embed
}

export function buildPRReviewEmbed(data: PRReviewEmbedData): EmbedBuilder {
  const verdictColor =
    data.verdict === 'approved' ? GREEN :
    data.verdict === 'changes-requested' ? RED :
    AGENT_COLORS.researcher

  const embed = new EmbedBuilder()
    .setTitle(`PR #${data.prNumber}: ${data.prTitle}`)
    .setColor(verdictColor)
    .addFields({ name: 'Verdict', value: data.verdict, inline: true })

  if (data.confidence !== undefined) {
    embed.addFields({ name: 'Confidence', value: `${data.confidence}%`, inline: true })
  }
  if (data.testsStatus) {
    embed.addFields({ name: 'Tests', value: data.testsStatus, inline: true })
  }
  if (data.blockers && data.blockers.length > 0) {
    embed.addFields({ name: 'Blockers', value: data.blockers.join('\n'), inline: false })
  }
  if (data.prUrl) {
    embed.setURL(data.prUrl)
  }

  return embed
}

export function buildDeployEmbed(data: DeployEmbedData): EmbedBuilder {
  const success = data.prMerged && data.testsPass
  const embed = new EmbedBuilder()
    .setTitle('Deploy Result')
    .setColor(success ? GREEN : RED)
    .addFields(
      { name: 'PR Merged', value: data.prMerged ? 'yes' : 'no', inline: true },
      { name: 'Tests', value: data.testsPass ? 'passing' : 'failing', inline: true },
    )

  if (data.vpsTarget) {
    embed.addFields({ name: 'Target', value: data.vpsTarget, inline: true })
  }
  if (data.restartStatus) {
    embed.addFields({ name: 'Restart', value: data.restartStatus, inline: true })
  }
  if (data.duration) {
    embed.addFields({ name: 'Duration', value: data.duration, inline: true })
  }
  if (data.prUrl) {
    embed.setURL(data.prUrl)
  }

  return embed
}

export function buildCleanupEmbed(data: CleanupEmbedData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${data.agentName} completed`)
    .setColor(GRAY)
    .setDescription('Task finished. What should happen to this channel?')

  if (data.duration) {
    embed.addFields({ name: 'Duration', value: data.duration, inline: true })
  }
  if (data.worktreePath) {
    embed.addFields({ name: 'Worktree', value: data.worktreePath, inline: false })
  }
  if (data.prNumber !== undefined) {
    embed.addFields({ name: 'PR', value: `#${data.prNumber}`, inline: true })
  }

  embed.setFooter({ text: 'React to choose: 📦 Archive forever  |  🗑️ Delete after 24h  |  No reaction = archived in 48h' })

  return embed
}

export function buildStatusBoardEmbed(data: StatusBoardData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('Claudecord — System Status')
    .setColor(healthColor(data.systemHealth))
    .setDescription(`Updated <t:${Math.floor(new Date(data.lastUpdated).getTime() / 1000)}:R>`)

  for (const agent of data.agents) {
    const ctxStr = agent.contextPct !== undefined ? `  |  ctx: ${agent.contextPct}%` : ''
    embed.addFields({
      name: agent.name,
      value: `${agent.status}${ctxStr}`,
      inline: true,
    })
  }

  embed.addFields({
    name: 'Tasks',
    value: `P0: ${data.taskCounts.p0}  P1: ${data.taskCounts.p1}  P2: ${data.taskCounts.p2}`,
    inline: false,
  })

  embed.setFooter({ text: 'Auto-updates every 60s  •  /status for details' })

  return embed
}
