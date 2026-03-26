import express, { type Request, type Response } from 'express'
import type { ChannelMessage, AgentReply } from '../shared/types.js'

export interface HttpApiDeps {
  onReply: (reply: AgentReply) => Promise<void>
}

export function createHttpApi(deps: HttpApiDeps) {
  const app = express()
  app.use(express.json())

  const registeredAgents = new Set<string>()
  const messageQueues = new Map<string, ChannelMessage[]>()

  app.post('/register', (req: Request, res: Response) => {
    const { agentName } = req.body as { agentName?: string }
    if (!agentName || typeof agentName !== 'string') {
      res.status(400).json({ error: 'agentName required' })
      return
    }

    registeredAgents.add(agentName)

    // Flush any buffered messages
    const buffered = messageQueues.get(agentName) ?? []
    messageQueues.set(agentName, [])

    res.json({ ok: true, bufferedMessages: buffered.length })
  })

  app.get('/messages/:agentName', (req: Request, res: Response) => {
    const agentNameParam = req.params['agentName']
    const agentName = Array.isArray(agentNameParam) ? agentNameParam[0] : agentNameParam
    if (!agentName) {
      res.status(400).json({ error: 'agentName required' })
      return
    }

    const messages = messageQueues.get(agentName) ?? []
    messageQueues.set(agentName, [])
    res.json({ messages })
  })

  app.post('/reply', (req: Request, res: Response) => {
    const reply = req.body as AgentReply | undefined
    if (!reply?.channelId || !reply.text) {
      res.status(400).json({ error: 'channelId and text required' })
      return
    }

    deps.onReply(reply)
      .then(() => {
        res.json({ ok: true })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('[http-api] reply error:', message)
        res.status(500).json({ error: message })
      })
  })

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      agents: Array.from(registeredAgents),
      uptime: process.uptime(),
    })
  })

  function enqueueMessage(agentName: string, message: ChannelMessage) {
    const queue = messageQueues.get(agentName)
    if (queue) {
      queue.push(message)
    } else {
      messageQueues.set(agentName, [message])
    }
  }

  return { app, enqueueMessage }
}
