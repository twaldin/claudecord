import { describe, it, expect } from 'vitest'
import {
  buildSpawnEmbed,
  buildCompletionEmbed,
  buildHeartbeatEmbed,
  buildPRReviewEmbed,
  buildDeployEmbed,
  buildCleanupEmbed,
  buildStatusBoardEmbed,
  AGENT_COLORS,
} from '../src/embeds.js'
import type {
  SpawnEmbedData,
  CompletionEmbedData,
  HeartbeatEmbedData,
  PRReviewEmbedData,
  DeployEmbedData,
  CleanupEmbedData,
  StatusBoardData,
} from '../src/shared/types.js'

const YELLOW = 0xFEE75C
const GREEN = 0x57F287
const RED = 0xED4245
const GRAY = 0x95A5A6

describe('AGENT_COLORS', () => {
  it('has correct color for each agent type', () => {
    expect(AGENT_COLORS.coder).toBe(0x5865F2)
    expect(AGENT_COLORS.researcher).toBe(0xED7D31)
    expect(AGENT_COLORS.evaluator).toBe(RED)
    expect(AGENT_COLORS.persistent).toBe(GREEN)
  })
})

describe('buildSpawnEmbed', () => {
  const data: SpawnEmbedData = {
    agentName: 'coder-fix-49',
    agentType: 'coder',
    task: 'Fix null pointer in upload handler',
    issueNumber: 49,
    worktreePath: '/tmp/claudecord-wt-fix-49',
    model: 'sonnet',
    spawnedAt: '2026-03-28T12:00:00.000Z',
    channelName: 'coder-fix-49',
  }

  it('sets title to "<name> spawned"', () => {
    expect(buildSpawnEmbed(data).toJSON().title).toBe('coder-fix-49 spawned')
  })

  it('uses the agent type color', () => {
    expect(buildSpawnEmbed(data).toJSON().color).toBe(AGENT_COLORS.coder)
  })

  it('includes Task field', () => {
    const fields = buildSpawnEmbed(data).toJSON().fields ?? []
    const f = fields.find(x => x.name === 'Task')
    expect(f?.value).toBe('Fix null pointer in upload handler')
  })

  it('includes Issue field with number', () => {
    const fields = buildSpawnEmbed(data).toJSON().fields ?? []
    const f = fields.find(x => x.name === 'Issue')
    expect(f?.value).toContain('#49')
  })

  it('includes footer mentioning channel name', () => {
    expect(buildSpawnEmbed(data).toJSON().footer?.text).toContain('coder-fix-49')
  })

  it('works for researcher type', () => {
    const d: SpawnEmbedData = { ...data, agentType: 'researcher', channelName: undefined }
    expect(buildSpawnEmbed(d).toJSON().color).toBe(AGENT_COLORS.researcher)
  })

  it('omits Issue field when issueNumber not provided', () => {
    const d: SpawnEmbedData = { ...data, issueNumber: undefined }
    const fields = buildSpawnEmbed(d).toJSON().fields ?? []
    expect(fields.find(x => x.name === 'Issue')).toBeUndefined()
  })
})

describe('buildCompletionEmbed', () => {
  it('sets title to "<name> completed"', () => {
    const data: CompletionEmbedData = { agentName: 'coder-fix-49', success: true }
    expect(buildCompletionEmbed(data).toJSON().title).toBe('coder-fix-49 completed')
  })

  it('uses green for success', () => {
    const data: CompletionEmbedData = { agentName: 'coder-fix-49', success: true }
    expect(buildCompletionEmbed(data).toJSON().color).toBe(GREEN)
  })

  it('uses red for failure', () => {
    const data: CompletionEmbedData = { agentName: 'coder-fix-49', success: false }
    expect(buildCompletionEmbed(data).toJSON().color).toBe(RED)
  })

  it('includes PR field when prNumber provided', () => {
    const data: CompletionEmbedData = { agentName: 'coder-fix-49', success: true, prNumber: 52 }
    const fields = buildCompletionEmbed(data).toJSON().fields ?? []
    expect(fields.find(x => x.name === 'PR')?.value).toContain('#52')
  })

  it('includes summary when provided', () => {
    const data: CompletionEmbedData = { agentName: 'coder-fix-49', success: true, summary: 'Fixed it' }
    const fields = buildCompletionEmbed(data).toJSON().fields ?? []
    expect(fields.find(x => x.name === 'Summary')?.value).toBe('Fixed it')
  })

  it('includes duration when provided', () => {
    const data: CompletionEmbedData = { agentName: 'coder-fix-49', success: true, duration: '45m' }
    const fields = buildCompletionEmbed(data).toJSON().fields ?? []
    expect(fields.find(x => x.name === 'Duration')?.value).toBe('45m')
  })
})

describe('buildHeartbeatEmbed', () => {
  const base: HeartbeatEmbedData = {
    agents: [{ name: 'orchestrator', type: 'persistent', status: 'idle', contextPct: 34, lastActivity: '2026-03-28T12:00:00.000Z' }],
    taskCounts: { p0: 0, p1: 2, p2: 8 },
    systemHealth: 'healthy',
  }

  it('uses green for healthy', () => {
    expect(buildHeartbeatEmbed(base).toJSON().color).toBe(GREEN)
  })

  it('uses yellow for degraded', () => {
    expect(buildHeartbeatEmbed({ ...base, systemHealth: 'degraded' }).toJSON().color).toBe(YELLOW)
  })

  it('uses red for critical', () => {
    expect(buildHeartbeatEmbed({ ...base, systemHealth: 'critical' }).toJSON().color).toBe(RED)
  })

  it('includes task count information in a field', () => {
    const fields = buildHeartbeatEmbed(base).toJSON().fields ?? []
    const hasTaskInfo = fields.some(f => f.value.includes('P0') || f.value.includes('P1') || f.name === 'Tasks')
    expect(hasTaskInfo).toBe(true)
  })
})

describe('buildPRReviewEmbed', () => {
  const data: PRReviewEmbedData = {
    prNumber: 52,
    prTitle: 'Fix upload handler',
    verdict: 'approved',
    confidence: 95,
    testsStatus: 'passing',
    prUrl: 'https://github.com/org/repo/pull/52',
  }

  it('uses green for approved', () => {
    expect(buildPRReviewEmbed(data).toJSON().color).toBe(GREEN)
  })

  it('uses red for changes-requested', () => {
    expect(buildPRReviewEmbed({ ...data, verdict: 'changes-requested' }).toJSON().color).toBe(RED)
  })

  it('uses orange for pending', () => {
    expect(buildPRReviewEmbed({ ...data, verdict: 'pending' }).toJSON().color).toBe(AGENT_COLORS.researcher)
  })

  it('sets URL to PR link', () => {
    expect(buildPRReviewEmbed(data).toJSON().url).toBe('https://github.com/org/repo/pull/52')
  })

  it('includes Verdict field', () => {
    const fields = buildPRReviewEmbed(data).toJSON().fields ?? []
    expect(fields.find(x => x.name === 'Verdict')?.value).toBe('approved')
  })

  it('includes blockers when provided', () => {
    const d: PRReviewEmbedData = { ...data, blockers: ['Missing tests', 'Type error'] }
    const fields = buildPRReviewEmbed(d).toJSON().fields ?? []
    const blockersField = fields.find(x => x.name === 'Blockers')
    expect(blockersField?.value).toContain('Missing tests')
  })
})

describe('buildDeployEmbed', () => {
  it('uses green when merged and tests pass', () => {
    const data: DeployEmbedData = { prMerged: true, testsPass: true }
    expect(buildDeployEmbed(data).toJSON().color).toBe(GREEN)
  })

  it('uses red when not merged', () => {
    const data: DeployEmbedData = { prMerged: false, testsPass: true }
    expect(buildDeployEmbed(data).toJSON().color).toBe(RED)
  })

  it('uses red when tests fail', () => {
    const data: DeployEmbedData = { prMerged: true, testsPass: false }
    expect(buildDeployEmbed(data).toJSON().color).toBe(RED)
  })

  it('sets URL when prUrl provided', () => {
    const data: DeployEmbedData = { prMerged: true, testsPass: true, prUrl: 'https://github.com/org/repo/pull/52' }
    expect(buildDeployEmbed(data).toJSON().url).toBe('https://github.com/org/repo/pull/52')
  })
})

describe('buildCleanupEmbed', () => {
  const data: CleanupEmbedData = {
    agentName: 'coder-fix-49',
    duration: '2h 14m',
    worktreePath: '/tmp/claudecord-wt-fix-49',
    prNumber: 52,
  }

  it('sets title to "<name> completed"', () => {
    expect(buildCleanupEmbed(data).toJSON().title).toBe('coder-fix-49 completed')
  })

  it('uses gray color', () => {
    expect(buildCleanupEmbed(data).toJSON().color).toBe(GRAY)
  })

  it('includes Duration field when provided', () => {
    const fields = buildCleanupEmbed(data).toJSON().fields ?? []
    expect(fields.find(x => x.name === 'Duration')?.value).toBe('2h 14m')
  })

  it('includes PR field when prNumber provided', () => {
    const fields = buildCleanupEmbed(data).toJSON().fields ?? []
    expect(fields.find(x => x.name === 'PR')?.value).toContain('#52')
  })

  it('footer includes archive and delete emoji instructions', () => {
    const footer = buildCleanupEmbed(data).toJSON().footer?.text ?? ''
    expect(footer).toContain('📦')
    expect(footer).toContain('🗑️')
  })
})

describe('buildStatusBoardEmbed', () => {
  const data: StatusBoardData = {
    agents: [
      { name: 'orchestrator', type: 'persistent', status: 'idle', contextPct: 34, lastActivity: '2026-03-28T12:00:00.000Z' },
      { name: 'coder-fix-49', type: 'coder', status: 'working', contextPct: 12, lastActivity: '2026-03-28T12:01:00.000Z' },
    ],
    taskCounts: { p0: 0, p1: 2, p2: 8 },
    systemHealth: 'healthy',
    lastUpdated: '2026-03-28T12:02:00.000Z',
  }

  it('sets title to "Claudecord — System Status"', () => {
    expect(buildStatusBoardEmbed(data).toJSON().title).toBe('Claudecord — System Status')
  })

  it('uses green for healthy', () => {
    expect(buildStatusBoardEmbed(data).toJSON().color).toBe(GREEN)
  })

  it('uses yellow for degraded', () => {
    expect(buildStatusBoardEmbed({ ...data, systemHealth: 'degraded' }).toJSON().color).toBe(YELLOW)
  })

  it('uses red for critical', () => {
    expect(buildStatusBoardEmbed({ ...data, systemHealth: 'critical' }).toJSON().color).toBe(RED)
  })

  it('has a field per agent', () => {
    const fields = buildStatusBoardEmbed(data).toJSON().fields ?? []
    expect(fields.find(f => f.name === 'orchestrator')).toBeDefined()
    expect(fields.find(f => f.name === 'coder-fix-49')).toBeDefined()
  })

  it('has a Tasks field with P0/P1/P2 counts', () => {
    const fields = buildStatusBoardEmbed(data).toJSON().fields ?? []
    const tasksField = fields.find(f => f.name === 'Tasks')
    expect(tasksField).toBeDefined()
    expect(tasksField?.value).toContain('P0')
    expect(tasksField?.value).toContain('P1')
  })

  it('footer mentions auto-update interval', () => {
    expect(buildStatusBoardEmbed(data).toJSON().footer?.text).toContain('Auto-updates')
  })
})
