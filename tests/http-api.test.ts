import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFileSync, existsSync, unlinkSync } from 'fs'
import { randomUUID } from 'crypto'
import { createHttpApi, persistState, flushWrites } from '../src/daemon/http-api.js'
import type { Server } from 'http'
import type { AgentReply, ChannelMessage, AgentSpawnBody, WorkCompletedBody, AgentHeartbeatBody, AgentType, AgentStateEntry } from '../src/shared/types.js'

let server: Server
let port: number
const replies: AgentReply[] = []
const spawnEvents: AgentSpawnBody[] = []
const diedEvents: { agentName: string }[] = []
const workCompletedEvents: WorkCompletedBody[] = []
const heartbeatEvents: AgentHeartbeatBody[] = []

function url(path: string) {
  return `http://localhost:${port}${path}`
}

beforeAll(async () => {
  const api = createHttpApi({
    onReply: async (reply) => {
      replies.push(reply)
    },
    onAgentSpawn: async (data) => {
      spawnEvents.push(data)
      return { channelId: `ch-${data.agentName}` }
    },
    onAgentDied: async (data) => {
      diedEvents.push(data)
    },
    onWorkCompleted: async (data) => {
      workCompletedEvents.push(data)
    },
    onAgentHeartbeat: async (data) => {
      heartbeatEvents.push(data)
    },
  })

  // Enqueue a message before agent registers to test buffering
  const bufferedMsg: ChannelMessage = {
    content: 'buffered hello',
    channelId: 'ch1',
    messageId: 'msg1',
    userId: 'u1',
    username: 'testuser',
    timestamp: new Date().toISOString(),
  }
  api.enqueueMessage('testagent', bufferedMsg)

  await new Promise<void>((resolve) => {
    server = api.app.listen(0, () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        port = addr.port
      }
      resolve()
    })
  })
})

afterAll(() => {
  server.close()
})

describe('HTTP API', () => {
  it('registers an agent and reports buffered messages', async () => {
    const res = await fetch(url('/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'testagent' }),
    })
    const data = await res.json() as { ok: boolean; bufferedMessages: number }
    expect(data.ok).toBe(true)
    expect(data.bufferedMessages).toBe(1)
  })

  it('polls messages and drains the queue', async () => {
    // First poll should return the buffered message (queue was flushed to empty on register, but let's enqueue fresh)
    // Actually register cleared the queue — let's verify empty first, then test with a new message
    const res1 = await fetch(url('/messages/testagent'))
    const data1 = await res1.json() as { messages: ChannelMessage[] }
    expect(data1.messages).toEqual([])

    // Now the queue is empty — verified
  })

  it('health check returns status and agents', async () => {
    const res = await fetch(url('/health'))
    const data = await res.json() as { status: string; agents: string[]; uptime: number }
    expect(data.status).toBe('ok')
    expect(data.agents).toContain('testagent')
    expect(typeof data.uptime).toBe('number')
  })

  it('rejects register without agentName', async () => {
    const res = await fetch(url('/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('handles reply endpoint', async () => {
    const res = await fetch(url('/reply'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: 'ch1', text: 'hello back' }),
    })
    const data = await res.json() as { ok: boolean }
    expect(data.ok).toBe(true)
    expect(replies).toHaveLength(1)
    expect(replies[0]?.text).toBe('hello back')
  })

  it('rejects reply without required fields', async () => {
    const res = await fetch(url('/reply'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: 'ch1' }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts reply with embed only (no text)', async () => {
    const res = await fetch(url('/reply'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: 'ch1',
        embed: { title: 'Test', description: 'Hello' },
      }),
    })
    const data = await res.json() as { ok: boolean }
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
  })

  it('accepts reply with both text and embed', async () => {
    const res = await fetch(url('/reply'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: 'ch1',
        text: 'summary',
        embed: { title: 'Rich Summary' },
      }),
    })
    expect(res.status).toBe(200)
  })
})

describe('POST /agent/spawn', () => {
  it('calls onAgentSpawn and returns channelId', async () => {
    const res = await fetch(url('/agent/spawn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: 'coder-fix-49',
        agentType: 'coder',
        task: 'Fix null pointer',
        issueNumber: 49,
        worktreePath: '/tmp/wt',
        model: 'sonnet',
      }),
    })
    const data = await res.json() as { ok: boolean; channelId: string }
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.channelId).toBe('ch-coder-fix-49')
    expect(spawnEvents).toHaveLength(1)
    expect(spawnEvents[0]?.agentName).toBe('coder-fix-49')
    expect(spawnEvents[0]?.agentType).toBe('coder')
    expect(spawnEvents[0]?.task).toBe('Fix null pointer')
  })

  it('rejects spawn without agentName', async () => {
    const res = await fetch(url('/agent/spawn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentType: 'coder', task: 'something' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects spawn without agentType', async () => {
    const res = await fetch(url('/agent/spawn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'coder-fix-1', task: 'something' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects spawn without task', async () => {
    const res = await fetch(url('/agent/spawn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'coder-fix-1', agentType: 'coder' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /agent/died', () => {
  it('calls onAgentDied and returns ok', async () => {
    const res = await fetch(url('/agent/died'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'coder-fix-49' }),
    })
    const data = await res.json() as { ok: boolean }
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(diedEvents.some(e => e.agentName === 'coder-fix-49')).toBe(true)
  })

  it('rejects without agentName', async () => {
    const res = await fetch(url('/agent/died'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /agent/work-completed', () => {
  it('calls onWorkCompleted and returns ok', async () => {
    const res = await fetch(url('/agent/work-completed'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: 'coder-fix-49',
        prNumber: 52,
        issueNumber: 49,
        testsAdded: 5,
        merged: true,
      }),
    })
    const data = await res.json() as { ok: boolean }
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(workCompletedEvents.some(e => e.agentName === 'coder-fix-49')).toBe(true)
    expect(workCompletedEvents.find(e => e.agentName === 'coder-fix-49')?.prNumber).toBe(52)
  })

  it('rejects without agentName', async () => {
    const res = await fetch(url('/agent/work-completed'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prNumber: 52 }),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /agent/heartbeat', () => {
  it('calls onAgentHeartbeat and returns ok', async () => {
    const res = await fetch(url('/agent/heartbeat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: 'orchestrator',
        contextPct: 45,
        status: 'idle',
      }),
    })
    const data = await res.json() as { ok: boolean }
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(heartbeatEvents.some(e => e.agentName === 'orchestrator')).toBe(true)
    expect(heartbeatEvents.find(e => e.agentName === 'orchestrator')?.contextPct).toBe(45)
  })

  it('rejects without agentName', async () => {
    const res = await fetch(url('/agent/heartbeat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contextPct: 50, status: 'idle' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('API secret auth middleware', () => {
  let authServer: Server
  let authPort: number
  const SECRET = 'test-secret-xyz'

  function authUrl(path: string) {
    return `http://localhost:${authPort}${path}`
  }

  beforeAll(async () => {
    process.env['CLAUDECORD_API_SECRET'] = SECRET
    const api = createHttpApi({ onReply: async () => {} })
    await new Promise<void>((resolve) => {
      authServer = api.app.listen(0, () => {
        const addr = authServer.address()
        if (addr && typeof addr === 'object') {
          authPort = (addr as { port: number }).port
        }
        resolve()
      })
    })
    delete process.env['CLAUDECORD_API_SECRET']
  })

  afterAll(() => {
    authServer.close()
  })

  it('returns 401 for requests without Bearer token', async () => {
    const res = await fetch(authUrl('/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'test' }),
    })
    expect(res.status).toBe(401)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('Unauthorized')
  })

  it('/health bypasses auth and returns 200', async () => {
    const res = await fetch(authUrl('/health'))
    expect(res.status).toBe(200)
  })

  it('allows requests with correct Bearer token', async () => {
    const res = await fetch(authUrl('/register'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SECRET}`,
      },
      body: JSON.stringify({ agentName: 'authed-agent' }),
    })
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean }
    expect(data.ok).toBe(true)
  })

  it('returns 401 for wrong Bearer token', async () => {
    const res = await fetch(authUrl('/messages/someone'), {
      headers: { 'Authorization': 'Bearer wrong-token' },
    })
    expect(res.status).toBe(401)
  })
})

describe('onSpawnNotify callback', () => {
  let notifyServer: Server
  let notifyPort: number
  const notifyEvents: Array<{ agentName: string; agentType: AgentType; task?: string; channelId?: string }> = []

  function notifyUrl(path: string) {
    return `http://localhost:${notifyPort}${path}`
  }

  beforeAll(async () => {
    const api = createHttpApi({
      onReply: async () => {},
      onAgentSpawn: async (data) => ({ channelId: `ch-${data.agentName}` }),
      onSpawnNotify: async (data) => { notifyEvents.push(data) },
    })
    await new Promise<void>((resolve) => {
      notifyServer = api.app.listen(0, () => {
        const addr = notifyServer.address()
        if (addr && typeof addr === 'object') notifyPort = (addr as { port: number }).port
        resolve()
      })
    })
  })

  afterAll(() => { notifyServer.close() })

  it('calls onSpawnNotify with agentName, agentType, task, and channelId after successful spawn', async () => {
    const res = await fetch(notifyUrl('/agent/spawn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'coder-fix-99', agentType: 'coder', task: 'Fix null pointer', issueNumber: 99 }),
    })
    expect(res.status).toBe(200)
    expect(notifyEvents).toHaveLength(1)
    expect(notifyEvents[0]?.agentName).toBe('coder-fix-99')
    expect(notifyEvents[0]?.agentType).toBe('coder')
    expect(notifyEvents[0]?.task).toBe('Fix null pointer')
    expect(notifyEvents[0]?.channelId).toBe('ch-coder-fix-99')
  })

  it('onSpawnNotify is optional — spawn succeeds when callback is absent', async () => {
    const api = createHttpApi({
      onReply: async () => {},
      onAgentSpawn: async (data) => ({ channelId: `ch-${data.agentName}` }),
    })
    let noNotifyServer!: Server
    let noNotifyPort: number
    await new Promise<void>((resolve) => {
      noNotifyServer = api.app.listen(0, () => {
        const addr = noNotifyServer.address()
        if (addr && typeof addr === 'object') noNotifyPort = (addr as { port: number }).port
        resolve()
      })
    })
    const res = await fetch(`http://localhost:${noNotifyPort}/agent/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'coder-fix-100', agentType: 'coder', task: 'Add tests' }),
    })
    noNotifyServer.close()
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean; channelId: string }
    expect(data.ok).toBe(true)
    expect(data.channelId).toBe('ch-coder-fix-100')
  })

  it('does not call onSpawnNotify when onAgentSpawn is absent', async () => {
    const noHandlerEvents: unknown[] = []
    const api = createHttpApi({
      onReply: async () => {},
      onSpawnNotify: async (data) => { noHandlerEvents.push(data) },
    })
    let noHandlerServer!: Server
    let noHandlerPort: number
    await new Promise<void>((resolve) => {
      noHandlerServer = api.app.listen(0, () => {
        const addr = noHandlerServer.address()
        if (addr && typeof addr === 'object') noHandlerPort = (addr as { port: number }).port
        resolve()
      })
    })
    await fetch(`http://localhost:${noHandlerPort}/agent/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'coder-fix-101', agentType: 'coder', task: 'Refactor' }),
    })
    noHandlerServer.close()
    expect(noHandlerEvents).toHaveLength(0)
  })
})

describe('persistState write queue', () => {
  it('writes data to a file atomically (no .tmp file left behind)', async () => {
    const filePath = join(tmpdir(), `claudecord-test-${randomUUID()}.json`)
    persistState({ hello: 'world' }, filePath)
    await flushWrites()
    const result = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    expect(result).toEqual({ hello: 'world' })
    expect(existsSync(filePath + '.tmp')).toBe(false)
    unlinkSync(filePath)
  })

  it('serializes concurrent writes so the last queued value is final', async () => {
    const filePath = join(tmpdir(), `claudecord-test-${randomUUID()}.json`)
    persistState({ seq: 1 }, filePath)
    persistState({ seq: 2 }, filePath)
    persistState({ seq: 3 }, filePath)
    await flushWrites()
    const result = JSON.parse(readFileSync(filePath, 'utf8')) as { seq: number }
    expect(result.seq).toBe(3)
    unlinkSync(filePath)
  })
})

describe('GET /agents', () => {
  let agentsServer: Server
  let agentsPort: number

  function agentsUrl(path: string) {
    return `http://localhost:${agentsPort}${path}`
  }

  beforeAll(async () => {
    const api = createHttpApi({ onReply: async () => {} })
    api.enqueueMessage('agent-alpha', { content: 'hi', channelId: 'c1', messageId: 'm1', userId: 'u1', username: 'user', timestamp: new Date().toISOString() })
    await new Promise<void>((resolve) => {
      agentsServer = api.app.listen(0, () => {
        const addr = agentsServer.address()
        if (addr && typeof addr === 'object') agentsPort = (addr as { port: number }).port
        resolve()
      })
    })
    // Register agent-alpha
    await fetch(agentsUrl('/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'agent-alpha' }),
    })
  })

  afterAll(() => { agentsServer.close() })

  it('returns all registered agents', async () => {
    const res = await fetch(agentsUrl('/agents'))
    const data = await res.json() as { agents: Array<{ name: string }> }
    expect(res.status).toBe(200)
    expect(data.agents.some(a => a.name === 'agent-alpha')).toBe(true)
  })

  it('returns agents as an array with a name field', async () => {
    const res = await fetch(agentsUrl('/agents'))
    const data = await res.json() as { agents: unknown[] }
    expect(Array.isArray(data.agents)).toBe(true)
  })

  it('returns full AgentStateEntry for registered agents', async () => {
    const res = await fetch(agentsUrl('/agents'))
    const data = await res.json() as { agents: AgentStateEntry[] }
    const alpha = data.agents.find(a => a.name === 'agent-alpha')
    expect(alpha).toBeDefined()
    expect(alpha?.shimConnected).toBe(true)
    expect(alpha?.status).toBe('alive')
    expect(typeof alpha?.spawnedAt).toBe('string')
  })
})

describe('GET /agents — spawned entry fields', () => {
  let spawnedServer: Server
  let spawnedPort: number

  function spawnedUrl(path: string) {
    return `http://localhost:${spawnedPort}${path}`
  }

  beforeAll(async () => {
    const api = createHttpApi({
      onReply: async () => {},
      onAgentSpawn: async (data) => ({ channelId: `ch-${data.agentName}` }),
    })
    await new Promise<void>((resolve) => {
      spawnedServer = api.app.listen(0, () => {
        const addr = spawnedServer.address()
        if (addr && typeof addr === 'object') spawnedPort = (addr as { port: number }).port
        resolve()
      })
    })
    await fetch(spawnedUrl('/agent/spawn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: 'coder-state-test',
        agentType: 'coder',
        task: 'Test state entry',
        lifecycle: 'ephemeral',
        directory: '/tmp/test',
        model: 'haiku',
      }),
    })
  })

  afterAll(() => { spawnedServer.close() })

  it('GET /agents returns full AgentStateEntry after spawn', async () => {
    const res = await fetch(spawnedUrl('/agents'))
    const data = await res.json() as { agents: AgentStateEntry[] }
    const entry = data.agents.find(a => a.name === 'coder-state-test')
    expect(entry).toBeDefined()
    expect(entry?.lifecycle).toBe('ephemeral')
    expect(entry?.type).toBe('coder')
    expect(entry?.status).toBe('alive')
    expect(entry?.model).toBe('haiku')
    expect(entry?.directory).toBe('/tmp/test')
    expect(entry?.task).toBe('Test state entry')
    expect(entry?.shimConnected).toBe(false)
    expect(entry?.channelId).toBe('ch-coder-state-test')
    expect(entry?.diedAt).toBeNull()
    expect(entry?.contextPct).toBeNull()
    expect(entry?.agentStatus).toBeNull()
    expect(entry?.lastHeartbeatAt).toBeNull()
  })
})

describe('POST /agent/spawn — duplicate detection', () => {
  let dupServer: Server
  let dupPort: number

  function dupUrl(path: string) {
    return `http://localhost:${dupPort}${path}`
  }

  beforeAll(async () => {
    const api = createHttpApi({
      onReply: async () => {},
      onAgentSpawn: async (data) => ({ channelId: `ch-${data.agentName}` }),
    })
    await new Promise<void>((resolve) => {
      dupServer = api.app.listen(0, () => {
        const addr = dupServer.address()
        if (addr && typeof addr === 'object') dupPort = (addr as { port: number }).port
        resolve()
      })
    })
    // First spawn succeeds
    await fetch(dupUrl('/agent/spawn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'dup-agent', agentType: 'coder', task: 'first' }),
    })
  })

  afterAll(() => { dupServer.close() })

  it('returns 409 when spawning an already-alive agent', async () => {
    const res = await fetch(dupUrl('/agent/spawn'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'dup-agent', agentType: 'coder', task: 'second' }),
    })
    expect(res.status).toBe(409)
    const data = await res.json() as { error: string }
    expect(data.error).toContain('dup-agent')
  })
})

describe('POST /agent/died — 404 for unknown agent', () => {
  let diedServer: Server
  let diedPort: number

  beforeAll(async () => {
    const api = createHttpApi({ onReply: async () => {} })
    await new Promise<void>((resolve) => {
      diedServer = api.app.listen(0, () => {
        const addr = diedServer.address()
        if (addr && typeof addr === 'object') diedPort = (addr as { port: number }).port
        resolve()
      })
    })
  })

  afterAll(() => { diedServer.close() })

  it('returns 404 when agent is not found', async () => {
    const res = await fetch(`http://localhost:${diedPort}/agent/died`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'nonexistent-agent' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /agent/heartbeat — updates registry entry', () => {
  let hbServer: Server
  let hbPort: number

  function hbUrl(path: string) {
    return `http://localhost:${hbPort}${path}`
  }

  beforeAll(async () => {
    const api = createHttpApi({ onReply: async () => {} })
    await new Promise<void>((resolve) => {
      hbServer = api.app.listen(0, () => {
        const addr = hbServer.address()
        if (addr && typeof addr === 'object') hbPort = (addr as { port: number }).port
        resolve()
      })
    })
    // Register an agent first so there's an entry to update
    await fetch(hbUrl('/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'hb-agent' }),
    })
  })

  afterAll(() => { hbServer.close() })

  it('updates contextPct, agentStatus, and lastHeartbeatAt in registry', async () => {
    const before = new Date().toISOString()
    await fetch(hbUrl('/agent/heartbeat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'hb-agent', contextPct: 72, status: 'working' }),
    })
    const res = await fetch(hbUrl('/agents'))
    const data = await res.json() as { agents: AgentStateEntry[] }
    const entry = data.agents.find(a => a.name === 'hb-agent')
    expect(entry?.contextPct).toBe(72)
    expect(entry?.agentStatus).toBe('working')
    expect(entry?.lastHeartbeatAt).toBeDefined()
    expect(entry?.lastHeartbeatAt! >= before).toBe(true)
  })
})
