import { describe, it, expect } from 'vitest'
import {
  getDefaultCompletionProtocol,
  shouldRespawnOnCrash,
  shouldSelfCompact,
} from '../src/shared/agent-lifecycle.js'

describe('getDefaultCompletionProtocol', () => {
  it('returns undefined for persistent', () => {
    expect(getDefaultCompletionProtocol('persistent')).toBeUndefined()
  })

  it('returns autoExit:true and messageOrchestrator:true for ephemeral', () => {
    const protocol = getDefaultCompletionProtocol('ephemeral')
    expect(protocol?.autoExit).toBe(true)
    expect(protocol?.messageOrchestrator).toBe(true)
  })

  it('returns empty postTo array for ephemeral by default', () => {
    const protocol = getDefaultCompletionProtocol('ephemeral')
    expect(protocol?.postTo).toEqual([])
  })
})

describe('shouldRespawnOnCrash', () => {
  it('returns true for persistent', () => {
    expect(shouldRespawnOnCrash('persistent')).toBe(true)
  })

  it('returns false for ephemeral', () => {
    expect(shouldRespawnOnCrash('ephemeral')).toBe(false)
  })
})

describe('shouldSelfCompact', () => {
  it('returns true for persistent', () => {
    expect(shouldSelfCompact('persistent')).toBe(true)
  })

  it('returns false for ephemeral', () => {
    expect(shouldSelfCompact('ephemeral')).toBe(false)
  })
})
