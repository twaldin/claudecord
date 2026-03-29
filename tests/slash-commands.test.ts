import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  handleInteraction,
  parseTasksMarkdown,
  type SlashCommandDeps,
  type SlashInteraction,
} from '../src/daemon/slash-commands.js'
import type { StatusBoardData, PeriodStats } from '../src/shared/types.js'

// --- Test doubles ---

function makeChatInput(
  commandName: string,
  opts: Record<string, string | number> = {},
  userId = 'user-1'
): SlashInteraction {
  return {
    commandName,
    user: { id: userId },
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    // extra properties consumed by the handler after casting
    options: {
      getString: (name: string): string | null => {
        const v = opts[name]
        return typeof v === 'string' ? v : null
      },
      getInteger: (name: string): number | null => {
        const v = opts[name]
        return typeof v === 'number' ? v : null
      },
    },
    reply: vi.fn().mockResolvedValue(undefined),
  } as SlashInteraction & {
    options: { getString(n: string): string | null; getInteger(n: string): number | null }
    reply: ReturnType<typeof vi.fn>
  }
}

function makeAutocomplete(commandName: string): SlashInteraction {
  return {
    commandName,
    user: { id: 'user-1' },
    isChatInputCommand: () => false,
    isAutocomplete: () => true,
    respond: vi.fn().mockResolvedValue(undefined),
  } as SlashInteraction & { respond: ReturnType<typeof vi.fn> }
}

function makeStatusBoardData(): StatusBoardData {
  return {
    agents: [{ name: 'trader', type: 'persistent', status: 'idle', lastActivity: '2026-03-28T12:00:00.000Z' }],
    taskCounts: { p0: 1, p1: 2, p2: 3 },
    systemHealth: 'healthy',
    lastUpdated: '2026-03-28T12:00:00.000Z',
  }
}

function makePeriodStats(period: 'today' | 'week' | 'all-time' = 'today'): PeriodStats {
  return {
    prsMerged: 3,
    testsAdded: 12,
    issuesFixed: 2,
    agentSpawns: 5,
    agentCrashes: 1,
    period,
    since: '2026-03-28',
  }
}

let tmpDir: string
let deps: SlashCommandDeps
let replyFn: ReturnType<typeof vi.fn>
let respondFn: ReturnType<typeof vi.fn>

function getReply(interaction: SlashInteraction): ReturnType<typeof vi.fn> {
  return (interaction as unknown as { reply: ReturnType<typeof vi.fn> }).reply
}

function getRespond(interaction: SlashInteraction): ReturnType<typeof vi.fn> {
  return (interaction as unknown as { respond: ReturnType<typeof vi.fn> }).respond
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'claudecord-sc-'))
  deps = {
    getSnapshot: vi.fn(() => makeStatusBoardData()),
    getStats: vi.fn((_p: 'today' | 'week' | 'all-time') => makePeriodStats(_p)),
    getRegisteredAgents: vi.fn(() => ['trader', 'stock-monitor', 'monitor']),
    allowedUsers: ['authorized-user'],
    statsPath: join(tmpDir, 'stats.json'),
    tasksPath: join(tmpDir, 'tasks.md'),
  }
  replyFn = vi.fn().mockResolvedValue(undefined)
  respondFn = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true })
  vi.clearAllMocks()
})

// ------------------------------------------------------------------ /status

describe('/status', () => {
  it('replies ephemerally with a status embed', async () => {
    const interaction = makeChatInput('status')
    await handleInteraction(interaction, deps)
    const reply = getReply(interaction)
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, embeds: expect.anything() })
    )
  })

  it('calls getSnapshot to build the embed', async () => {
    const interaction = makeChatInput('status')
    await handleInteraction(interaction, deps)
    expect(deps.getSnapshot).toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------- /stats

describe('/stats', () => {
  it('replies with a public embed (no ephemeral)', async () => {
    const interaction = makeChatInput('stats', { period: 'today' })
    await handleInteraction(interaction, deps)
    const reply = getReply(interaction)
    const call = reply.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call).toBeDefined()
    expect(call['ephemeral']).toBeFalsy()
    expect(call['embeds']).toBeDefined()
  })

  it('passes the selected period to getStats', async () => {
    const interaction = makeChatInput('stats', { period: 'week' })
    await handleInteraction(interaction, deps)
    expect(deps.getStats).toHaveBeenCalledWith('week')
  })

  it('defaults period to today when not provided', async () => {
    const interaction = makeChatInput('stats')
    await handleInteraction(interaction, deps)
    expect(deps.getStats).toHaveBeenCalledWith('today')
  })
})

// ------------------------------------------------------------------- /tasks

describe('/tasks', () => {
  const TABLE = [
    '| Priority | Title | Status |',
    '|----------|-------|--------|',
    '| P0 | Fix critical bug | open |',
    '| P1 | Add unit tests | in-progress |',
    '| P2 | Refactor routing | open |',
  ].join('\n')

  it('replies ephemerally', async () => {
    writeFileSync(deps.tasksPath, TABLE)
    const interaction = makeChatInput('tasks', { priority: 'all' })
    await handleInteraction(interaction, deps)
    const reply = getReply(interaction)
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }))
  })

  it('includes a task embed in the reply', async () => {
    writeFileSync(deps.tasksPath, TABLE)
    const interaction = makeChatInput('tasks', { priority: 'all' })
    await handleInteraction(interaction, deps)
    const reply = getReply(interaction)
    const call = reply.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call?.['embeds']).toBeDefined()
  })

  it('still replies when tasks file is missing', async () => {
    // tasksPath does not exist — should not throw
    const interaction = makeChatInput('tasks', { priority: 'all' })
    await expect(handleInteraction(interaction, deps)).resolves.not.toThrow()
    const reply = getReply(interaction)
    expect(reply).toHaveBeenCalled()
  })
})

// -------------------------------------------------------- parseTasksMarkdown

describe('parseTasksMarkdown', () => {
  it('extracts data rows from a markdown table', () => {
    const md = [
      '| Priority | Title | Status |',
      '|----------|-------|--------|',
      '| P0 | Fix critical bug | open |',
      '| P1 | Add more tests | in-progress |',
    ].join('\n')
    const rows = parseTasksMarkdown(md)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ priority: 'P0', title: 'Fix critical bug', status: 'open' })
    expect(rows[1]).toEqual({ priority: 'P1', title: 'Add more tests', status: 'in-progress' })
  })

  it('skips separator rows', () => {
    const md = '|----------|-------|--------|\n| P0 | Task | open |'
    const rows = parseTasksMarkdown(md)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.priority).toBe('P0')
  })

  it('skips the header row', () => {
    const md = '| Priority | Title | Status |\n| P0 | Task | open |'
    const rows = parseTasksMarkdown(md)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.priority).toBe('P0')
  })

  it('returns empty array for content without a table', () => {
    const rows = parseTasksMarkdown('# Tasks\nNo tasks here.\nAnother line.')
    expect(rows).toHaveLength(0)
  })

  it('trims whitespace from all fields', () => {
    const rows = parseTasksMarkdown('|  P0  |  Trim test  |  open  |')
    expect(rows[0]).toEqual({ priority: 'P0', title: 'Trim test', status: 'open' })
  })
})

// ------------------------------------------------------------------- /kill

describe('/kill', () => {
  it('rejects unauthorized users with an error message', async () => {
    const interaction = makeChatInput('kill', { agent: 'trader' }, 'unauthorized-user')
    await handleInteraction(interaction, deps)
    const reply = getReply(interaction)
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
        content: expect.stringContaining('not authorized'),
      })
    )
  })

  it('does not include "not authorized" for authorized users', async () => {
    const interaction = makeChatInput('kill', { agent: 'trader' }, 'authorized-user')
    await handleInteraction(interaction, deps)
    const reply = getReply(interaction)
    const call = reply.mock.calls[0]?.[0] as Record<string, unknown>
    expect((call?.['content'] as string | undefined) ?? '').not.toContain('not authorized')
  })

  it('replies ephemerally for authorized users', async () => {
    const interaction = makeChatInput('kill', { agent: 'trader' }, 'authorized-user')
    await handleInteraction(interaction, deps)
    const reply = getReply(interaction)
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }))
  })
})

// -------------------------------------------------------- autocomplete /kill

describe('autocomplete for /kill', () => {
  it('returns all registered agent names as choices', async () => {
    const interaction = makeAutocomplete('kill')
    await handleInteraction(interaction, deps)
    const respond = getRespond(interaction)
    expect(respond).toHaveBeenCalledWith(
      expect.arrayContaining([
        { name: 'trader', value: 'trader' },
        { name: 'stock-monitor', value: 'stock-monitor' },
        { name: 'monitor', value: 'monitor' },
      ])
    )
  })

  it('calls getRegisteredAgents to populate choices', async () => {
    const interaction = makeAutocomplete('kill')
    await handleInteraction(interaction, deps)
    expect(deps.getRegisteredAgents).toHaveBeenCalled()
  })
})

// -------------------------------------------------- /kill injection rejection

describe('/kill — injection rejection', () => {
  const dangerousNames = ['trader; rm -rf /', 'a|b', 'x`whoami`', '$HOME', 'BAD_NAME', 'has space']

  for (const name of dangerousNames) {
    it(`rejects dangerous agent name ${JSON.stringify(name)}`, async () => {
      const interaction = makeChatInput('kill', { agent: name }, 'authorized-user')
      await handleInteraction(interaction, deps)
      const reply = getReply(interaction)
      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          ephemeral: true,
          content: expect.stringContaining('Invalid agent name'),
        })
      )
    })
  }
})

