import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveAgent, loadRouting, addAgentChannel, removeAgentChannel, saveRouting } from '../src/routing.js'
import type { RoutingConfig, AgentChannelMeta } from '../src/shared/types.js'

let tmpDir: string
let routingPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'claudecord-routing-'))
  routingPath = join(tmpDir, 'routing.json')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true })
})

describe('addAgentChannel', () => {
  it('adds a new agent entry and resolves its channel', () => {
    const config: RoutingConfig = { agents: {}, defaultAgent: 'orchestrator' }
    const meta: AgentChannelMeta = { agentType: 'coder', spawnedAt: '2026-03-28T12:00:00.000Z', task: 'Fix bug' }
    addAgentChannel(config, 'coder-fix-49', 'ch-99', meta, routingPath)
    expect(resolveAgent(config, 'ch-99')).toBe('coder-fix-49')
  })

  it('appends channel to existing agent entry', () => {
    const config: RoutingConfig = { agents: { 'coder-fix-49': { channels: ['ch-88'] } } }
    const meta: AgentChannelMeta = { agentType: 'coder', spawnedAt: '2026-03-28T12:00:00.000Z' }
    addAgentChannel(config, 'coder-fix-49', 'ch-99', meta, routingPath)
    expect(config.agents['coder-fix-49']?.channels).toContain('ch-88')
    expect(config.agents['coder-fix-49']?.channels).toContain('ch-99')
  })

  it('stores meta on the agent entry', () => {
    const config: RoutingConfig = { agents: {} }
    const meta: AgentChannelMeta = { agentType: 'researcher', spawnedAt: '2026-03-28T12:00:00.000Z', task: 'Research SpaceX' }
    addAgentChannel(config, 'researcher-spacex', 'ch-77', meta, routingPath)
    expect(config.agents['researcher-spacex']?.meta?.agentType).toBe('researcher')
    expect(config.agents['researcher-spacex']?.meta?.task).toBe('Research SpaceX')
  })

  it('persists to disk and can be reloaded', () => {
    const config: RoutingConfig = { agents: {} }
    const meta: AgentChannelMeta = { agentType: 'coder', spawnedAt: '2026-03-28T12:00:00.000Z' }
    addAgentChannel(config, 'coder-fix-49', 'ch-99', meta, routingPath)
    const loaded = loadRouting(routingPath)
    expect(resolveAgent(loaded, 'ch-99')).toBe('coder-fix-49')
  })
})

describe('removeAgentChannel', () => {
  it('removes the agent entry so its channel no longer resolves', () => {
    const config: RoutingConfig = { agents: { 'coder-fix-49': { channels: ['ch-99'] } } }
    removeAgentChannel(config, 'coder-fix-49', routingPath)
    expect(config.agents['coder-fix-49']).toBeUndefined()
    expect(resolveAgent(config, 'ch-99')).toBeNull()
  })

  it('does not throw when agent does not exist', () => {
    const config: RoutingConfig = { agents: {} }
    expect(() => removeAgentChannel(config, 'nonexistent', routingPath)).not.toThrow()
  })

  it('persists removal to disk', () => {
    const config: RoutingConfig = { agents: { 'coder-fix-49': { channels: ['ch-99'] } } }
    removeAgentChannel(config, 'coder-fix-49', routingPath)
    const loaded = loadRouting(routingPath)
    expect(loaded.agents['coder-fix-49']).toBeUndefined()
  })

  it('leaves other agents intact', () => {
    const config: RoutingConfig = {
      agents: {
        'coder-fix-49': { channels: ['ch-99'] },
        orchestrator: { channels: ['ch-1'] },
      },
    }
    removeAgentChannel(config, 'coder-fix-49', routingPath)
    expect(resolveAgent(config, 'ch-1')).toBe('orchestrator')
  })
})

describe('saveRouting', () => {
  it('writes config to disk and it round-trips correctly', () => {
    const config: RoutingConfig = {
      agents: { orchestrator: { channels: ['111', '222'] } },
      defaultAgent: 'orchestrator',
    }
    saveRouting(config, routingPath)
    const loaded = loadRouting(routingPath)
    expect(loaded.agents['orchestrator']?.channels).toContain('111')
    expect(loaded.defaultAgent).toBe('orchestrator')
  })
})
