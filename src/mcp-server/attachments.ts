import { writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { Message } from 'discord.js'

export const ATTACHMENT_DIR = join(homedir(), '.claudecord', 'attachments')

export async function downloadAttachments(msg: Message): Promise<string[]> {
  if (msg.attachments.size === 0) return []

  mkdirSync(ATTACHMENT_DIR, { recursive: true })
  const paths: string[] = []

  for (const [, attachment] of msg.attachments) {
    const ext = attachment.name?.split('.').pop() ?? 'bin'
    const filename = `${msg.id}-${attachment.id}.${ext}`
    const filepath = join(ATTACHMENT_DIR, filename)
    try {
      const res = await fetch(attachment.url)
      const buf = Buffer.from(await res.arrayBuffer())
      writeFileSync(filepath, buf)
      paths.push(filepath)
      process.stderr.write(`claudecord: saved attachment ${filepath}\n`)
    } catch (err) {
      process.stderr.write(`claudecord: failed to download attachment: ${err}\n`)
    }
  }
  return paths
}
