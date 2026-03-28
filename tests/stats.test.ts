import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  loadStats,
  saveStats,
  recordSpawn,
  recordDeath,
  recordPRMerged,
  recordIssueFixed,
  getStatsForPeriod,
} from '../src/daemon/stats.js'

let tmpDir: string
let statsPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'claudecord-stats-'))
  statsPath = join(tmpDir, 'stats.json')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true })
})

describe('loadStats', () => {
  it('returns empty store when file does not exist', () => {
    const store = loadStats(statsPath)
    expect(store.daily).toEqual([])
    expect(store.totals.prsMerged).toBe(0)
    expect(store.totals.agentSpawns).toBe(0)
    expect(store.totals.issuesFixed).toBe(0)
    expect(store.totals.agentCrashes).toBe(0)
  })

  it('loads persisted stats from disk', () => {
    const store = loadStats(statsPath)
    recordSpawn(store, 'coder-fix-1')
    saveStats(store, statsPath)
    const loaded = loadStats(statsPath)
    expect(loaded.totals.agentSpawns).toBe(1)
  })
})

describe('saveStats', () => {
  it('writes stats atomically and can be reloaded', () => {
    const store = loadStats(statsPath)
    recordSpawn(store, 'my-agent')
    saveStats(store, statsPath)
    const loaded = loadStats(statsPath)
    expect(loaded.totals.agentSpawns).toBe(1)
    expect(loaded.agents['my-agent']).toBeDefined()
  })
})

describe('recordSpawn', () => {
  it('increments total agentSpawns', () => {
    const store = loadStats(statsPath)
    recordSpawn(store, 'coder-fix-1')
    expect(store.totals.agentSpawns).toBe(1)
  })

  it('increments today daily agentSpawns', () => {
    const store = loadStats(statsPath)
    recordSpawn(store, 'coder-fix-1')
    const today = new Date().toISOString().slice(0, 10)
    const todayStats = store.daily.find(d => d.date === today)
    expect(todayStats?.agentSpawns).toBe(1)
  })

  it('sets firstSeen on new agent', () => {
    const store = loadStats(statsPath)
    recordSpawn(store, 'coder-fix-1')
    expect(store.agents['coder-fix-1']?.firstSeen).toBeDefined()
  })

  it('increments totalSpawns on repeat calls', () => {
    const store = loadStats(statsPath)
    recordSpawn(store, 'coder-fix-1')
    recordSpawn(store, 'coder-fix-1')
    expect(store.agents['coder-fix-1']?.totalSpawns).toBe(2)
  })

  it('accumulates across multiple agents', () => {
    const store = loadStats(statsPath)
    recordSpawn(store, 'coder-fix-1')
    recordSpawn(store, 'coder-fix-2')
    expect(store.totals.agentSpawns).toBe(2)
  })
})

describe('recordDeath', () => {
  it('does not increment agentCrashes for clean death', () => {
    const store = loadStats(statsPath)
    recordSpawn(store, 'coder-fix-1')
    recordDeath(store, 'coder-fix-1', false)
    expect(store.totals.agentCrashes).toBe(0)
  })

  it('increments agentCrashes for crashed death', () => {
    const store = loadStats(statsPath)
    recordSpawn(store, 'coder-fix-1')
    recordDeath(store, 'coder-fix-1', true)
    expect(store.totals.agentCrashes).toBe(1)
  })

  it('increments daily agentCrashes for crashed death', () => {
    const store = loadStats(statsPath)
    recordSpawn(store, 'coder-fix-1')
    recordDeath(store, 'coder-fix-1', true)
    const today = new Date().toISOString().slice(0, 10)
    expect(store.daily.find(d => d.date === today)?.agentCrashes).toBe(1)
  })

  it('sets lastSeen on the agent lifetime entry', () => {
    const store = loadStats(statsPath)
    recordSpawn(store, 'coder-fix-1')
    recordDeath(store, 'coder-fix-1', false)
    expect(store.agents['coder-fix-1']?.lastSeen).toBeDefined()
  })
})

describe('recordPRMerged', () => {
  it('increments total prsMerged', () => {
    const store = loadStats(statsPath)
    recordPRMerged(store, 52)
    expect(store.totals.prsMerged).toBe(1)
  })

  it('increments daily prsMerged', () => {
    const store = loadStats(statsPath)
    recordPRMerged(store, 52)
    const today = new Date().toISOString().slice(0, 10)
    expect(store.daily.find(d => d.date === today)?.prsMerged).toBe(1)
  })
})

describe('recordIssueFixed', () => {
  it('increments total issuesFixed', () => {
    const store = loadStats(statsPath)
    recordIssueFixed(store, 49)
    expect(store.totals.issuesFixed).toBe(1)
  })

  it('increments daily issuesFixed', () => {
    const store = loadStats(statsPath)
    recordIssueFixed(store, 49)
    const today = new Date().toISOString().slice(0, 10)
    expect(store.daily.find(d => d.date === today)?.issuesFixed).toBe(1)
  })
})

describe('getStatsForPeriod', () => {
  it('returns today counts for "today"', () => {
    const store = loadStats(statsPath)
    recordSpawn(store, 'coder-fix-1')
    recordPRMerged(store, 52)
    const stats = getStatsForPeriod(store, 'today')
    expect(stats.agentSpawns).toBe(1)
    expect(stats.prsMerged).toBe(1)
    expect(stats.period).toBe('today')
  })

  it('returns all-time totals for "all-time"', () => {
    const store = loadStats(statsPath)
    recordSpawn(store, 'coder-fix-1')
    recordSpawn(store, 'coder-fix-2')
    const stats = getStatsForPeriod(store, 'all-time')
    expect(stats.agentSpawns).toBe(2)
    expect(stats.period).toBe('all-time')
  })

  it('returns week stats for "week" (includes today)', () => {
    const store = loadStats(statsPath)
    recordSpawn(store, 'coder-fix-1')
    const stats = getStatsForPeriod(store, 'week')
    expect(stats.agentSpawns).toBe(1)
    expect(stats.period).toBe('week')
  })

  it('returns zero counts for empty today', () => {
    const store = loadStats(statsPath)
    const stats = getStatsForPeriod(store, 'today')
    expect(stats.agentSpawns).toBe(0)
    expect(stats.prsMerged).toBe(0)
  })
})
