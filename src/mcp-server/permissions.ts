import { EmbedBuilder } from 'discord.js'
import { execFile, execSync } from 'child_process'
import { createHash } from 'crypto'
import type { Client, TextChannel } from 'discord.js'
import type { RoutingConfig, AgentStateEntry } from '../shared/types.js'

export const POLL_INTERVAL_MS = 3000
export const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000
const TMUX_SESSION = 'claudecord'
const SCAN_LINES = 30

export const PERMISSION_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /Do you want to allow/i,          label: 'tool-allow'   },
  { re: /Yes, allow once/,                label: 'tool-allow'   },
  { re: /Yes, and always allow/,          label: 'tool-allow'   },
  { re: /Do you want to proceed/i,        label: 'mcp-approval' },
  { re: /\d+ MCP server.{0,20}approv/i,   label: 'mcp-approval' },
  { re: /Do you want to create/i,         label: 'file-create'  },
  { re: /Esc to cancel/,                  label: 'tool-allow'   },
]

export interface PendingPrompt {
  agentName: string
  channelId: string
  messageId: string
  paneHash: string
  detectedAt: number
  label: string
  tool: string
  context: string
}

export const pendingPrompts = new Map<string, PendingPrompt>()
export const promptByMessageId = new Map<string, string>()
export const resolvedHashes = new Map<string, number>()

export function paneHash(text: string): string {
  return createHash('sha1').update(text.slice(-500)).digest('hex').slice(0, 12)
}

export function extractPromptDetails(paneText: string): { tool: string; context: string } {
  // TUI dialog: "Tool: Bash" line
  const toolMatch = paneText.match(/Tool:\s*(.+)/i)
  // Inline format: "⏺ Bash(cmd)" or "● Write(/path)"
  const inlineMatch = paneText.match(/[⏺●]\s*(Write|Bash|Edit|Read|Glob|Grep)\(([^)]*)\)/i)
  // TUI label on its own line: " Bash command" or " Create file"
  const tuiLabelMatch = paneText.match(/^\s*(Bash|Write|Edit|Read)\s+command\s*$/im)
    ?? paneText.match(/^\s*Create\s+file\s*$/im)
  const cmdMatch = paneText.match(/Command:\s*(.+)/i)
  const pathMatch = paneText.match(/Do you want to (?:create|allow|proceed with)\s+(.+?)(?:\?|$)/im)
  const mcpMatch = paneText.match(/Server:\s*(.+)/i)
  const createMatch = paneText.match(/Create file\s*\n\s*(.+)/im)
  // TUI body: indented command/path after the label
  const tuiBodyMatch = paneText.match(/(?:Bash|Write|Edit|Read) command\s*\n\s*\n\s{3,}(.+)/im)
    ?? paneText.match(/Create file\s*\n\s*(?:\.\.\/)*(.+)/im)

  const tool = toolMatch?.[1]?.trim()
    ?? inlineMatch?.[1]?.trim()
    ?? (tuiLabelMatch ? tuiLabelMatch[1]?.trim() ?? 'Write' : null)
    ?? mcpMatch?.[1]?.trim()
    ?? 'unknown'
  const context = cmdMatch?.[1]?.trim()
    ?? inlineMatch?.[2]?.trim()
    ?? tuiBodyMatch?.[1]?.trim()
    ?? createMatch?.[1]?.trim()
    ?? pathMatch?.[1]?.trim()
    ?? paneText.slice(-300).replace(/\x1b\[[0-9;]*m/g, '').trim()

  return { tool, context }
}

export function buildPermissionEmbed(
  agentName: string, label: string, tool: string, context: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Permission required — ${agentName}`)
    .setColor(0xFFA500)
    .addFields(
      { name: 'Type', value: label, inline: true },
      { name: 'Tool', value: tool, inline: true },
      { name: 'Context', value: context.slice(0, 1024), inline: false },
    )
    .setFooter({ text: 'React \u2705 to allow  |  \u274c to deny  |  Auto-denies in 5m' })
    .setTimestamp()
}

export function startPermissionWatcher(
  client: Client,
  routing: RoutingConfig,
  agentRegistry: Map<string, AgentStateEntry>,
  PRIMARY: string,
  allowedUsers: string[],
): void {
  async function fetchTextChannel(id: string): Promise<TextChannel> {
    const ch = await client.channels.fetch(id)
    if (!ch || !ch.isTextBased() || !('send' in ch)) {
      throw new Error(`channel ${id} not found or not text-based`)
    }
    return ch as TextChannel
  }

  async function postPermissionPrompt(
    agentName: string, channelId: string, label: string,
    tool: string, context: string, hash: string,
  ): Promise<void> {
    try {
      const ch = await fetchTextChannel(channelId)
      const embed = buildPermissionEmbed(agentName, label, tool, context)
      const msg = await ch.send({ embeds: [embed] })
      await msg.react('\u2705')
      await msg.react('\u274c')

      const pending: PendingPrompt = {
        agentName, channelId, messageId: msg.id, paneHash: hash,
        detectedAt: Date.now(), label, tool, context,
      }
      pendingPrompts.set(agentName, pending)
      promptByMessageId.set(msg.id, agentName)
      process.stderr.write(`claudecord: permission prompt posted for ${agentName} (${tool})\n`)
    } catch (err) {
      process.stderr.write(`claudecord: failed to post permission prompt: ${err}\n`)
    }
  }

  async function resolvePrompt(
    agentName: string, pending: PendingPrompt, decision: 'allow' | 'deny',
  ): Promise<void> {
    pendingPrompts.delete(agentName)
    promptByMessageId.delete(pending.messageId)
    resolvedHashes.set(pending.paneHash, Date.now())

    const target = `${TMUX_SESSION}:${agentName}`
    if (decision === 'allow') {
      execFile('tmux', ['send-keys', '-t', target, 'Enter'], err => {
        if (err) process.stderr.write(`claudecord: tmux send-keys failed for ${agentName}: ${err.message}\n`)
      })
    } else {
      execFile('tmux', ['send-keys', '-t', target, 'Down', 'Down', 'Enter'], err => {
        if (err) process.stderr.write(`claudecord: tmux send-keys failed for ${agentName}: ${err.message}\n`)
      })
    }

    try {
      const ch = await fetchTextChannel(pending.channelId)
      const msg = await ch.messages.fetch(pending.messageId)
      const resultEmbed = new EmbedBuilder()
        .setTitle(`Permission ${decision === 'allow' ? 'allowed' : 'denied'} — ${agentName}`)
        .setColor(decision === 'allow' ? 0x57F287 : 0xED4245)
        .addFields(
          { name: 'Tool', value: pending.tool, inline: true },
          { name: 'Decision', value: decision.toUpperCase(), inline: true },
        )
        .setTimestamp()
      await msg.edit({ embeds: [resultEmbed] })
    } catch {}
  }

  async function handleTimeout(agentName: string, pending: PendingPrompt): Promise<void> {
    pendingPrompts.delete(agentName)
    promptByMessageId.delete(pending.messageId)
    resolvedHashes.set(pending.paneHash, Date.now())

    execFile('tmux', ['send-keys', '-t', `${TMUX_SESSION}:${agentName}`, 'Down', 'Down', 'Enter'])

    try {
      const ch = await fetchTextChannel(pending.channelId)
      const msg = await ch.messages.fetch(pending.messageId)
      const timeoutEmbed = new EmbedBuilder()
        .setTitle(`Permission timed out — ${agentName}`)
        .setColor(0x95A5A6)
        .addFields(
          { name: 'Tool', value: pending.tool, inline: true },
          { name: 'Result', value: 'AUTO-DENIED (5m timeout)', inline: true },
        )
        .setTimestamp()
      await msg.edit({ embeds: [timeoutEmbed] })
    } catch {}
  }

  async function pollPermissions(): Promise<void> {
    const now = Date.now()
    for (const [agentName, pending] of pendingPrompts) {
      if (now - pending.detectedAt > PERMISSION_TIMEOUT_MS) {
        await handleTimeout(agentName, pending)
      }
    }

    for (const [h, ts] of resolvedHashes) {
      if (now - ts > 60_000) resolvedHashes.delete(h)
    }

    let windows: string[]
    try {
      const out = execSync(
        `tmux list-windows -t ${TMUX_SESSION} -F '#{window_name}'`,
        { encoding: 'utf8' },
      )
      windows = out.trim().split('\n').filter(Boolean)
    } catch {
      return
    }

    for (const windowName of windows) {
      if (pendingPrompts.has(windowName)) continue
      if (windowName === PRIMARY) continue

      let paneText: string
      try {
        paneText = execSync(
          `tmux capture-pane -t ${TMUX_SESSION}:${windowName} -p -S -${SCAN_LINES}`,
          { encoding: 'utf8' },
        )
      } catch {
        continue
      }

      const clean = paneText.replace(/\x1b\[[0-9;]*[mGKHFJABCDsuhlr]/g, '')

      let matched: { label: string } | null = null
      for (const { re, label } of PERMISSION_PATTERNS) {
        if (re.test(clean)) { matched = { label }; break }
      }
      if (!matched) continue

      const hash = paneHash(clean)
      if (resolvedHashes.has(hash)) continue

      const entry = agentRegistry.get(windowName)
      let channelId = entry?.channelId ?? undefined

      if (!channelId) {
        const agentRouting = routing.agents[windowName]
        if (agentRouting?.channels?.[0]) {
          channelId = agentRouting.channels[0]
        }
      }

      if (!channelId) {
        process.stderr.write(`claudecord: permission prompt on ${windowName} but no channel — skipping\n`)
        continue
      }

      const { tool, context } = extractPromptDetails(clean)
      await postPermissionPrompt(windowName, channelId, matched.label, tool, context, hash)
    }
  }

  // Reaction handler
  client.on('messageReactionAdd', async (reaction, user) => {
    if (reaction.partial) {
      try { await reaction.fetch() } catch { return }
    }
    if (user.bot) return
    if (allowedUsers.length > 0 && !allowedUsers.includes(user.id)) return

    const agentName = promptByMessageId.get(reaction.message.id)
    if (!agentName) return

    const pending = pendingPrompts.get(agentName)
    if (!pending) return

    const emoji = reaction.emoji.name
    if (emoji === '\u2705') {
      await resolvePrompt(agentName, pending, 'allow')
    } else if (emoji === '\u274c') {
      await resolvePrompt(agentName, pending, 'deny')
    }
  })

  setInterval(() => { void pollPermissions() }, POLL_INTERVAL_MS)
  process.stderr.write('claudecord: permission watcher started (3s poll)\n')
}
