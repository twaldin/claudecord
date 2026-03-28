import express, { type Request, type Response } from 'express'
import type { ChannelMessage, AgentReply, AgentSpawnBody, WorkCompletedBody, AgentHeartbeatBody } from '../shared/types.js'

export interface HttpApiDeps {
  onReply: (reply: AgentReply) => Promise<void>
  onAgentSpawn?: (data: AgentSpawnBody) => Promise<{ channelId: string }>
  onAgentDied?: (data: { agentName: string }) => Promise<void>
  onWorkCompleted?: (data: WorkCompletedBody) => Promise<void>
  onAgentHeartbeat?: (data: AgentHeartbeatBody) => Promise<void>
}

const VALID_AGENT_TYPES = new Set(['coder', 'researcher', 'evaluator', 'persistent'])
const VALID_STATUSES = new Set(['idle', 'working', 'compacting', 'dead'])

export function createHttpApi(deps: HttpApiDeps) {
  const app = express()
  app.use(express.json())

  const apiSecret = process.env['CLAUDECORD_API_SECRET']
  if (apiSecret) {
    app.use((req, res, next) => {
      if (req.path === '/health') return next()
      const auth = req.headers['authorization']
      if (auth !== `Bearer ${apiSecret}`) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
      next()
    })
  }

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
    if (!reply?.channelId || (!reply.text && !reply.embed)) {
      res.status(400).json({ error: 'channelId required, and at least one of text or embed required' })
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

  app.post('/agent/spawn', (req: Request, res: Response) => {
    const body = req.body as Partial<AgentSpawnBody> | undefined
    if (!body?.agentName || typeof body.agentName !== 'string') {
      res.status(400).json({ error: 'agentName required' })
      return
    }
    if (!body.agentType || !VALID_AGENT_TYPES.has(body.agentType)) {
      res.status(400).json({ error: 'agentType required (coder | researcher | evaluator | persistent)' })
      return
    }
    if (!body.task || typeof body.task !== 'string') {
      res.status(400).json({ error: 'task required' })
      return
    }

    const spawnData: AgentSpawnBody = {
      agentName: body.agentName,
      agentType: body.agentType,
      task: body.task,
      issueNumber: body.issueNumber,
      prNumber: body.prNumber,
      worktreePath: body.worktreePath,
      model: body.model,
    }

    const handler = deps.onAgentSpawn
    if (!handler) {
      res.json({ ok: true, channelId: '' })
      return
    }

    handler(spawnData)
      .then(({ channelId }) => {
        res.json({ ok: true, channelId })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('[http-api] agent spawn error:', message)
        res.status(500).json({ error: message })
      })
  })

  app.post('/agent/died', (req: Request, res: Response) => {
    const body = req.body as { agentName?: string } | undefined
    if (!body?.agentName || typeof body.agentName !== 'string') {
      res.status(400).json({ error: 'agentName required' })
      return
    }

    const handler = deps.onAgentDied
    if (!handler) {
      res.json({ ok: true })
      return
    }

    handler({ agentName: body.agentName })
      .then(() => {
        res.json({ ok: true })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('[http-api] agent died error:', message)
        res.status(500).json({ error: message })
      })
  })

  app.post('/agent/work-completed', (req: Request, res: Response) => {
    const body = req.body as Partial<WorkCompletedBody> | undefined
    if (!body?.agentName || typeof body.agentName !== 'string') {
      res.status(400).json({ error: 'agentName required' })
      return
    }

    const workData: WorkCompletedBody = {
      agentName: body.agentName,
      prNumber: body.prNumber,
      issueNumber: body.issueNumber,
      testsAdded: body.testsAdded,
      merged: body.merged,
    }

    const handler = deps.onWorkCompleted
    if (!handler) {
      res.json({ ok: true })
      return
    }

    handler(workData)
      .then(() => {
        res.json({ ok: true })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('[http-api] work-completed error:', message)
        res.status(500).json({ error: message })
      })
  })

  app.post('/agent/heartbeat', (req: Request, res: Response) => {
    const body = req.body as Partial<AgentHeartbeatBody> | undefined
    if (!body?.agentName || typeof body.agentName !== 'string') {
      res.status(400).json({ error: 'agentName required' })
      return
    }
    if (typeof body.contextPct !== 'number') {
      res.status(400).json({ error: 'contextPct required (number)' })
      return
    }
    if (!body.status || !VALID_STATUSES.has(body.status)) {
      res.status(400).json({ error: 'status required (idle | working | compacting | dead)' })
      return
    }

    const heartbeatData: AgentHeartbeatBody = {
      agentName: body.agentName,
      contextPct: body.contextPct,
      status: body.status,
    }

    const handler = deps.onAgentHeartbeat
    if (!handler) {
      res.json({ ok: true })
      return
    }

    handler(heartbeatData)
      .then(() => {
        res.json({ ok: true })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('[http-api] heartbeat error:', message)
        res.status(500).json({ error: message })
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

  function getRegisteredAgents(): string[] {
    return Array.from(registeredAgents)
  }

  return { app, enqueueMessage, getRegisteredAgents }
}
