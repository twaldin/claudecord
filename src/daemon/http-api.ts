import express, { type Request, type Response } from 'express'
import { writeFileSync, renameSync } from 'fs'
import type { ChannelMessage, AgentReply, AgentSpawnBody, WorkCompletedBody, AgentHeartbeatBody, AgentType, AgentLifecycle, AgentStateEntry } from '../shared/types.js'
import { validateAgentName } from './channel-manager.js'

let writeQueue: Promise<void> = Promise.resolve()

export function persistState(data: unknown, filePath: string): void {
  writeQueue = writeQueue.then(() => {
    const tmp = filePath + '.tmp'
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    renameSync(tmp, filePath)
  }).catch((err: unknown) => {
    console.error('[daemon] Failed to persist state:', err instanceof Error ? err.message : err)
  })
}

export function flushWrites(): Promise<void> {
  return writeQueue
}

export interface HttpApiDeps {
  onReply: (reply: AgentReply) => Promise<void>
  onAgentSpawn?: (data: AgentSpawnBody) => Promise<{ channelId: string }>
  onSpawnNotify?: (data: { agentName: string; agentType: AgentType; task?: string; channelId?: string }) => Promise<void>
  onAgentDied?: (data: { agentName: string }) => Promise<void>
  onWorkCompleted?: (data: WorkCompletedBody) => Promise<void>
  onAgentHeartbeat?: (data: AgentHeartbeatBody) => Promise<void>
  agentStatePath?: string
}

const VALID_AGENT_TYPES = new Set(['coder', 'researcher', 'evaluator', 'persistent'])
const VALID_STATUSES = new Set(['idle', 'working', 'compacting', 'dead'])
const VALID_LIFECYCLES = new Set<AgentLifecycle>(['persistent', 'scheduled', 'ephemeral'])

function isValidModel(m: string): m is 'opus' | 'sonnet' | 'haiku' {
  return m === 'opus' || m === 'sonnet' || m === 'haiku'
}

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

  const agentRegistry = new Map<string, AgentStateEntry>()
  const messageQueues = new Map<string, ChannelMessage[]>()

  function persistRegistry(): void {
    if (!deps.agentStatePath) return
    const agents: Record<string, AgentStateEntry> = {}
    for (const [name, entry] of agentRegistry) {
      agents[name] = entry
    }
    persistState({ schemaVersion: 1, agents }, deps.agentStatePath)
  }

  function hydrateRegistry(entries: Record<string, AgentStateEntry>): void {
    for (const [name, entry] of Object.entries(entries)) {
      agentRegistry.set(name, entry)
    }
  }

  function getAgentRegistry(): Map<string, AgentStateEntry> {
    return agentRegistry
  }

  // Backwards-compat: returns names of agents with shimConnected=true
  function getRegisteredAgents(): string[] {
    const result: string[] = []
    for (const entry of agentRegistry.values()) {
      if (entry.shimConnected) result.push(entry.name)
    }
    return result
  }

  app.post('/register', (req: Request, res: Response) => {
    const { agentName } = req.body as { agentName?: string }
    if (!agentName || typeof agentName !== 'string') {
      res.status(400).json({ error: 'agentName required' })
      return
    }

    const existing = agentRegistry.get(agentName)
    if (existing) {
      existing.shimConnected = true
    } else {
      // Create minimal entry for agents that register without a prior spawn
      const entry: AgentStateEntry = {
        name: agentName,
        lifecycle: 'ephemeral',
        type: 'persistent',
        status: 'alive',
        directory: '',
        spawnedAt: new Date().toISOString(),
        diedAt: null,
        model: 'sonnet',
        channelId: null,
        contextPct: null,
        agentStatus: null,
        task: null,
        shimConnected: true,
        lastHeartbeatAt: null,
      }
      agentRegistry.set(agentName, entry)
    }
    persistRegistry()

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
    // Backwards compat: return agent names for shimConnected agents
    const agents = getRegisteredAgents()
    res.json({
      status: 'ok',
      agents,
      uptime: process.uptime(),
    })
  })

  app.get('/agents', (_req: Request, res: Response) => {
    const agents = Array.from(agentRegistry.values())
    res.json({ agents })
  })

  app.post('/agent/spawn', (req: Request, res: Response) => {
    const body = req.body as Partial<AgentSpawnBody> | undefined
    if (!body?.agentName || typeof body.agentName !== 'string') {
      res.status(400).json({ error: 'agentName required' })
      return
    }
    if (!validateAgentName(body.agentName)) {
      res.status(400).json({ error: 'agentName must match /^[a-z0-9-]{1,80}$/' })
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

    const { agentName, agentType, task, issueNumber, prNumber, worktreePath } = body
    const lifecycle: AgentLifecycle = (body.lifecycle && VALID_LIFECYCLES.has(body.lifecycle))
      ? body.lifecycle
      : 'ephemeral'
    const rawModel = body.model ?? 'sonnet'
    const model: 'opus' | 'sonnet' | 'haiku' = isValidModel(rawModel) ? rawModel : 'sonnet'
    const directory = body.directory ?? worktreePath ?? ''

    // 409 if an alive entry already exists
    const existing = agentRegistry.get(agentName)
    if (existing && existing.status === 'alive') {
      res.status(409).json({ error: `Agent ${agentName} is already alive` })
      return
    }

    const entry: AgentStateEntry = {
      name: agentName,
      lifecycle,
      type: agentType,
      status: 'alive',
      directory,
      spawnedAt: new Date().toISOString(),
      diedAt: null,
      model,
      channelId: null,
      contextPct: null,
      agentStatus: null,
      task: task ?? null,
      shimConnected: false,
      lastHeartbeatAt: null,
    }
    agentRegistry.set(agentName, entry)
    persistRegistry()

    const spawnData: AgentSpawnBody = {
      agentName,
      agentType,
      task,
      lifecycle,
      directory,
      issueNumber,
      prNumber,
      worktreePath,
      model,
    }

    const handler = deps.onAgentSpawn
    if (!handler) {
      res.json({ ok: true, channelId: '' })
      return
    }

    handler(spawnData)
      .then(({ channelId }) => {
        entry.channelId = channelId
        persistRegistry()
        res.json({ ok: true, channelId })
        if (deps.onSpawnNotify) {
          void deps.onSpawnNotify({
            agentName,
            agentType,
            task,
            channelId,
          })
        }
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

    const entry = agentRegistry.get(body.agentName)
    if (!entry) {
      res.status(404).json({ error: `Agent ${body.agentName} not found` })
      return
    }

    entry.status = 'dead'
    entry.diedAt = new Date().toISOString()
    entry.agentStatus = 'dead'
    entry.contextPct = null
    persistRegistry()

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

    const entry = agentRegistry.get(body.agentName)
    if (entry) {
      entry.contextPct = body.contextPct
      entry.agentStatus = body.status as AgentStateEntry['agentStatus']
      entry.lastHeartbeatAt = new Date().toISOString()
      persistRegistry()
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

  return { app, enqueueMessage, getRegisteredAgents, getAgentRegistry, hydrateRegistry }
}
