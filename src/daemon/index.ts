import { resolve } from 'path'
import { homedir } from 'os'
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'fs'
import { config } from 'dotenv'
import { createDiscordClient } from './discord.js'
import { createHttpApi } from './http-api.js'
import { loadRouting, resolveAgent } from './routing.js'

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

  const routingConfig = loadRouting(routingPath)
  console.log(`[daemon] Loaded routing: ${Object.keys(routingConfig.agents).join(', ')}`)

  // Clean up old daemon if running
  cleanupOldPid()
  writePid()

  const discord = createDiscordClient({
    token: discordToken,
    onMessage: (msg) => {
      const agentName = resolveAgent(routingConfig, msg.channelId)
      if (!agentName) {
        console.log(`[daemon] No agent for channel ${msg.channelId}, dropping message`)
        return
      }
      console.log(`[daemon] ${msg.username} → ${agentName} (${msg.channelId}): ${msg.content.slice(0, 80)}`)
      api.enqueueMessage(agentName, msg)
    },
  })

  const api = createHttpApi({
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
  })

  await discord.login()

  const server = api.app.listen(port, () => {
    console.log(`[daemon] HTTP API listening on port ${port}`)
  })

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[daemon] Shutting down...')
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
