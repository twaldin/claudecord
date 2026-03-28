import type { EmbedBuilder } from 'discord.js'
import type { StatusBoardData } from '../shared/types.js'
import { buildStatusBoardEmbed } from './embeds.js'

interface StatusBoardDeps {
  sendEmbed: (channelId: string, embed: EmbedBuilder) => Promise<string>
  editMessage: (channelId: string, messageId: string, embed: EmbedBuilder) => Promise<void>
  channelId: string
  getSnapshot: () => StatusBoardData
  intervalMs?: number
}

export function createStatusBoard(deps: StatusBoardDeps) {
  let messageId: string | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  async function post(): Promise<void> {
    const snapshot = deps.getSnapshot()
    const embed = buildStatusBoardEmbed(snapshot)
    if (messageId) {
      try {
        await deps.editMessage(deps.channelId, messageId, embed)
      } catch {
        messageId = await deps.sendEmbed(deps.channelId, embed)
      }
    } else {
      messageId = await deps.sendEmbed(deps.channelId, embed)
    }
  }

  function start() {
    void post()
    timer = setInterval(() => void post(), deps.intervalMs ?? 60000)
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { start, stop, post }
}
