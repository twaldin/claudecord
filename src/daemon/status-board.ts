// Embeds should only be used for: status board (edit-in-place), structured data tables, PR summaries.
// Regular progress updates should be plain text messages, not embeds.

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import type { EmbedBuilder } from 'discord.js'
import type { StatusBoardData } from '../shared/types.js'
import { buildStatusBoardEmbed } from './embeds.js'

const DEFAULT_MSG_ID_PATH = resolve(homedir(), '.claudecord-status-board-msg-id')

export interface StatusBoardDeps {
  sendEmbed: (channelId: string, embed: EmbedBuilder) => Promise<string>
  editMessage: (channelId: string, messageId: string, embed: EmbedBuilder) => Promise<void>
  fetchRecentBotEmbed?: (channelId: string) => Promise<string | null>
  channelId: string
  getSnapshot: () => StatusBoardData
  intervalMs?: number
  msgIdPath?: string
}

export function createStatusBoard(deps: StatusBoardDeps) {
  const msgIdPath = deps.msgIdPath ?? DEFAULT_MSG_ID_PATH
  let messageId: string | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  function loadMessageId(): string | null {
    try {
      if (existsSync(msgIdPath)) {
        const id = readFileSync(msgIdPath, 'utf8').trim()
        return id || null
      }
    } catch { /* ignore */ }
    return null
  }

  function saveMessageId(id: string): void {
    try {
      writeFileSync(msgIdPath, id, 'utf8')
    } catch { /* best-effort */ }
  }

  async function post(): Promise<void> {
    try {
      const snapshot = deps.getSnapshot()
      const embed = buildStatusBoardEmbed(snapshot)
      if (messageId) {
        try {
          await deps.editMessage(deps.channelId, messageId, embed)
          console.log(`[status-board] Updated embed (${snapshot.agents.length} agents)`)
        } catch {
          messageId = await deps.sendEmbed(deps.channelId, embed)
          saveMessageId(messageId)
          console.log(`[status-board] Re-posted embed, new messageId: ${messageId}`)
        }
      } else {
        messageId = await deps.sendEmbed(deps.channelId, embed)
        saveMessageId(messageId)
        console.log(`[status-board] Initial embed posted, messageId: ${messageId}`)
      }
    } catch (err) {
      console.error('[status-board] Failed to post:', err instanceof Error ? err.message : err)
    }
  }

  async function start(): Promise<void> {
    // 1. Try file first (survives daemon restarts without a network call)
    messageId = loadMessageId()
    if (messageId) {
      console.log(`[status-board] Recovered messageId from file: ${messageId}`)
    } else if (deps.fetchRecentBotEmbed) {
      // 2. On restart with no file: fetch last 10 messages, find most recent bot embed
      try {
        messageId = await deps.fetchRecentBotEmbed(deps.channelId)
        if (messageId) {
          saveMessageId(messageId)
          console.log(`[status-board] Recovered messageId from channel history: ${messageId}`)
        }
      } catch { /* ignore — will post new embed */ }
    }

    void post()
    timer = setInterval(() => void post(), deps.intervalMs ?? 60000)
  }

  function stop(): void {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { start, stop, post }
}
