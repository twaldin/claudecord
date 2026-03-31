import { describe, it, expect } from 'vitest'
import { resolveAgent } from '../src/routing.js'
import type { RoutingConfig } from '../src/shared/types.js'

const config: RoutingConfig = {
  agents: {
    orchestrator: { channels: ['111', '222'] },
    trader: { channels: ['333'] },
    coder: { channels: ['444'] },
  },
  defaultAgent: 'orchestrator',
}

describe('resolveAgent', () => {
  it('resolves a known orchestrator channel', () => {
    expect(resolveAgent(config, '111')).toBe('orchestrator')
  })

  it('resolves a trader channel', () => {
    expect(resolveAgent(config, '333')).toBe('trader')
  })

  it('returns null for unknown channels', () => {
    expect(resolveAgent(config, '999')).toBeNull()
  })

  it('returns null when no default and channel unknown', () => {
    const noDefault: RoutingConfig = {
      agents: {
        orchestrator: { channels: ['111'] },
      },
    }
    expect(resolveAgent(noDefault, '999')).toBeNull()
  })
})
