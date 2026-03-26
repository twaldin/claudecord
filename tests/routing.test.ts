import { describe, it, expect } from 'vitest'
import { resolveAgent } from '../src/daemon/routing.js'
import type { RoutingConfig } from '../src/shared/types.js'

const config: RoutingConfig = {
  agents: {
    lifeos: { channels: ['111', '222'] },
    trader: { channels: ['333'] },
    coder: { channels: ['444'] },
  },
  defaultAgent: 'lifeos',
}

describe('resolveAgent', () => {
  it('resolves a known lifeos channel', () => {
    expect(resolveAgent(config, '111')).toBe('lifeos')
  })

  it('resolves a trader channel', () => {
    expect(resolveAgent(config, '333')).toBe('trader')
  })

  it('falls back to defaultAgent for unknown channels', () => {
    expect(resolveAgent(config, '999')).toBe('lifeos')
  })

  it('returns null when no default and channel unknown', () => {
    const noDefault: RoutingConfig = {
      agents: {
        lifeos: { channels: ['111'] },
      },
    }
    expect(resolveAgent(noDefault, '999')).toBeNull()
  })
})
