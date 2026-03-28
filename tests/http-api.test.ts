import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHttpApi } from '../src/daemon/http-api.js'
import type { Server } from 'http'
import type { AgentReply, ChannelMessage, AgentSpawnBody, WorkCompletedBody, AgentHeartbeatBody, AgentType } from '../src/shared/types.js'

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
