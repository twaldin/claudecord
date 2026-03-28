import { REST, Routes, EmbedBuilder, ApplicationCommandOptionType } from 'discord.js'
import type { Client } from 'discord.js'
import { readFileSync } from 'fs'
import { buildStatusBoardEmbed } from './embeds.js'
import type { StatusBoardData, PeriodStats, AgentType } from '../shared/types.js'

// ------------------------------------------------------------------ types

export interface SlashCommandDeps {
  getSnapshot: () => StatusBoardData
  getStats: (period: 'today' | 'week' | 'all-time') => PeriodStats
  getRegisteredAgents: () => string[]
  channelManager?: {
    createAgentChannel: (agentName: string, agentType: AgentType, task: string) => Promise<string>
  }
  allowedUsers: string[]
  statsPath: string
  tasksPath: string
}

/** Minimal interface satisfied by real discord.js Interaction objects. */
export interface SlashInteraction {
  commandName: string
  user: { id: string }
  isChatInputCommand(): boolean
  isAutocomplete(): boolean
}

export interface TaskRow {
  priority: string
  title: string
  status: string
}

// Internal narrowed interfaces (real discord.js objects satisfy these structurally)
interface ChatInteraction extends SlashInteraction {
  options: {
    getString(name: string): string | null
    getInteger(name: string): number | null
  }
  reply(data: {
    content?: string
    embeds?: EmbedBuilder[]
    ephemeral?: boolean
  }): Promise<void>
}

interface AcInteraction extends SlashInteraction {
  respond(choices: ReadonlyArray<{ name: string; value: string }>): Promise<void>
}

// ------------------------------------------------------- command definitions

const COMMANDS = [
  {
    name: 'spawn',
    description: 'Spawn a new agent',
    options: [
      {
        name: 'type',
        description: 'Agent type',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'coder', value: 'coder' },
          { name: 'researcher', value: 'researcher' },
          { name: 'evaluator', value: 'evaluator' },
        ],
      },
      {
        name: 'task',
        description: 'Task description',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: 'issue',
        description: 'GitHub issue number',
        type: ApplicationCommandOptionType.Integer,
        required: false,
      },
    ],
  },
  {
    name: 'status',
    description: 'Show current agent status',
  },
  {
    name: 'tasks',
    description: 'List tasks from tasks.md',
    options: [
      {
        name: 'priority',
        description: 'Filter by priority',
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: 'all', value: 'all' },
          { name: 'P0', value: 'P0' },
          { name: 'P1', value: 'P1' },
          { name: 'P2', value: 'P2' },
        ],
      },
    ],
  },
  {
    name: 'habits',
    description: 'Mark habits as done',
    options: [
      {
        name: 'habits',
        description: 'Comma-separated habit names',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
  {
    name: 'kill',
    description: 'Kill a running agent',
    options: [
      {
        name: 'agent',
        description: 'Agent to kill',
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: 'stats',
    description: 'Show system stats',
    options: [
      {
        name: 'period',
        description: 'Time period',
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: 'today', value: 'today' },
          { name: 'week', value: 'week' },
          { name: 'all-time', value: 'all-time' },
        ],
      },
    ],
  },
]

// ------------------------------------------------- embed builders (internal)

const BLUE = 0x5865F2

function buildStatsEmbed(stats: PeriodStats): EmbedBuilder {
  const periodLabels: Record<string, string> = {
    today: "Today's Stats",
    week: "This Week's Stats",
    'all-time': 'All-Time Stats',
  }
  return new EmbedBuilder()
    .setTitle(periodLabels[stats.period] ?? `Stats — ${stats.period}`)
    .setColor(BLUE)
    .addFields(
      { name: 'PRs Merged', value: String(stats.prsMerged), inline: true },
      { name: 'Issues Fixed', value: String(stats.issuesFixed), inline: true },
      { name: 'Agent Spawns', value: String(stats.agentSpawns), inline: true },
      { name: 'Agent Crashes', value: String(stats.agentCrashes), inline: true },
    )
    .setFooter({ text: `Since ${stats.since}` })
}

function buildTasksEmbed(tasks: TaskRow[], filterLabel: string): EmbedBuilder {
  const title = filterLabel === 'all' ? 'Tasks' : `Tasks — ${filterLabel}`
  const embed = new EmbedBuilder().setTitle(title).setColor(BLUE)

  if (tasks.length === 0) {
    return embed.setDescription('No tasks found.')
  }

  const MAX = 25
  const shown = tasks.slice(0, MAX)
  const overflow = tasks.length - MAX

  const lines = shown.map(t => `**${t.priority}** ${t.title} — ${t.status}`)
  if (overflow > 0) lines.push(`_...and ${overflow} more_`)

  return embed.setDescription(lines.join('\n'))
}

// ----------------------------------------------------- pure parser (exported)

export function parseTasksMarkdown(content: string): TaskRow[] {
  const rows: TaskRow[] = []
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/)
    if (!match) continue
    const [, rawP, rawT, rawS] = match
    if (!rawP || !rawT || !rawS) continue
    const priority = rawP.trim()
    const title = rawT.trim()
    const status = rawS.trim()
    if (priority.toLowerCase() === 'priority') continue  // header row
    if (/^[-:]+$/.test(priority)) continue               // separator row
    rows.push({ priority, title, status })
  }
  return rows
}

// --------------------------------------------------- registration (exported)

export function registerSlashCommands(client: Client, guildId: string): void {
  void (async () => {
    try {
      const token = client.token
      const appId = client.application?.id
      if (!token || !appId) {
        console.error('[slash-commands] token or application.id not available — skip registration')
        return
      }
      const rest = new REST().setToken(token)
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: COMMANDS })
      console.log('[slash-commands] Registered 6 guild slash commands')
    } catch (err) {
      console.error('[slash-commands] Failed to register slash commands:', err)
    }
  })()
}

// ------------------------------------------------- interaction handler (exported)

export async function handleInteraction(
  interaction: SlashInteraction,
  deps: SlashCommandDeps
): Promise<void> {
  if (interaction.isAutocomplete()) {
    return handleAutocomplete(interaction as AcInteraction, deps)
  }
  if (interaction.isChatInputCommand()) {
    return handleCommand(interaction as ChatInteraction, deps)
  }
}

async function handleAutocomplete(
  interaction: AcInteraction,
  deps: SlashCommandDeps
): Promise<void> {
  if (interaction.commandName === 'kill') {
    const agents = deps.getRegisteredAgents()
    await interaction.respond(agents.map(name => ({ name, value: name })))
  }
}

async function handleCommand(
  interaction: ChatInteraction,
  deps: SlashCommandDeps
): Promise<void> {
  switch (interaction.commandName) {
    case 'status': {
      const snapshot = deps.getSnapshot()
      const embed = buildStatusBoardEmbed(snapshot)
      await interaction.reply({ embeds: [embed], ephemeral: true })
      break
    }

    case 'stats': {
      const rawPeriod = interaction.options.getString('period') ?? 'today'
      const period = (rawPeriod === 'week' || rawPeriod === 'all-time')
        ? rawPeriod
        : 'today' as const
      const stats = deps.getStats(period)
      const embed = buildStatsEmbed(stats)
      await interaction.reply({ embeds: [embed] })
      break
    }

    case 'tasks': {
      const filter = interaction.options.getString('priority') ?? 'all'
      let tasks: TaskRow[] = []
      try {
        const content = readFileSync(deps.tasksPath, 'utf8')
        tasks = parseTasksMarkdown(content)
      } catch {
        // file not found or unreadable — show empty list
      }
      if (filter !== 'all') {
        tasks = tasks.filter(t => t.priority.toLowerCase() === filter.toLowerCase())
      }
      const embed = buildTasksEmbed(tasks, filter)
      await interaction.reply({ embeds: [embed], ephemeral: true })
      break
    }

    case 'habits': {
      const raw = interaction.options.getString('habits') ?? ''
      const list = raw.split(',').map(h => h.trim()).filter(Boolean)
      const label = list.length > 0 ? list.join(', ') : '(none)'
      await interaction.reply({
        content: `Marking habits: ${label} — orchestrator will confirm`,
        ephemeral: true,
      })
      break
    }

    case 'kill': {
      if (!deps.allowedUsers.includes(interaction.user.id)) {
        await interaction.reply({ content: 'You are not authorized to kill agents.', ephemeral: true })
        return
      }
      const agent = interaction.options.getString('agent') ?? ''
      await interaction.reply({ content: `Killing agent: ${agent}`, ephemeral: true })
      break
    }

    case 'spawn': {
      const type = interaction.options.getString('type') ?? 'coder'
      const task = interaction.options.getString('task') ?? ''
      if (!deps.channelManager) {
        await interaction.reply({ content: 'Channel manager is not available.', ephemeral: true })
        return
      }
      const agentName = `${type}-${Date.now()}`
      const channelId = await deps.channelManager.createAgentChannel(
        agentName,
        type as AgentType,
        task
      )
      await interaction.reply({ content: `Agent spawned in <#${channelId}>`, ephemeral: true })
      break
    }
  }
}
