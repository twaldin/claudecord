import { readFileSync, writeFileSync, renameSync } from 'fs'
import type { PeriodStats } from '../shared/types.js'

interface DailyStats {
  date: string
  prsMerged: number
  testsAdded: number
  issuesFixed: number
  agentSpawns: number
  agentCrashes: number
  agentUptime: Record<string, number>
}

interface AgentLifetimeStats {
  name: string
  totalSpawns: number
  totalCrashes: number
  totalUptimeSeconds: number
  firstSeen: string
  lastSeen: string
}

export interface StatsStore {
  daily: DailyStats[]
  agents: Record<string, AgentLifetimeStats>
  totals: {
    prsMerged: number
    testsAdded: number
    issuesFixed: number
    agentSpawns: number
    agentCrashes: number
  }
  lastUpdated: string
}

function emptyStore(): StatsStore {
  return {
    daily: [],
    agents: {},
    totals: { prsMerged: 0, testsAdded: 0, issuesFixed: 0, agentSpawns: 0, agentCrashes: 0 },
    lastUpdated: new Date().toISOString(),
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function getOrCreateToday(store: StatsStore): DailyStats {
  const today = todayStr()
  let day = store.daily.find(d => d.date === today)
  if (!day) {
    day = { date: today, prsMerged: 0, testsAdded: 0, issuesFixed: 0, agentSpawns: 0, agentCrashes: 0, agentUptime: {} }
    store.daily.push(day)
  }
  return day
}

function getOrCreateAgent(store: StatsStore, agentName: string): AgentLifetimeStats {
  if (!store.agents[agentName]) {
    store.agents[agentName] = {
      name: agentName,
      totalSpawns: 0,
      totalCrashes: 0,
      totalUptimeSeconds: 0,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    }
  }
  return store.agents[agentName]!
}

export function loadStats(path: string): StatsStore {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as StatsStore
  } catch {
    return emptyStore()
  }
}

export function saveStats(store: StatsStore, path: string): void {
  store.lastUpdated = new Date().toISOString()
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  renameSync(tmp, path)
}

export function recordSpawn(store: StatsStore, agentName: string): void {
  store.totals.agentSpawns++
  getOrCreateToday(store).agentSpawns++
  const agent = getOrCreateAgent(store, agentName)
  agent.totalSpawns++
  agent.lastSeen = new Date().toISOString()
}

export function recordDeath(store: StatsStore, agentName: string, crashed: boolean): void {
  if (crashed) {
    store.totals.agentCrashes++
    getOrCreateToday(store).agentCrashes++
    const agent = getOrCreateAgent(store, agentName)
    agent.totalCrashes++
    agent.lastSeen = new Date().toISOString()
  } else {
    const agent = getOrCreateAgent(store, agentName)
    agent.lastSeen = new Date().toISOString()
  }
}

export function recordPRMerged(store: StatsStore, _prNumber: number): void {
  store.totals.prsMerged++
  getOrCreateToday(store).prsMerged++
}

export function recordIssueFixed(store: StatsStore, _issueNumber: number): void {
  store.totals.issuesFixed++
  getOrCreateToday(store).issuesFixed++
}

export function getStatsForPeriod(store: StatsStore, period: 'today' | 'week' | 'all-time'): PeriodStats {
  if (period === 'all-time') {
    return {
      prsMerged: store.totals.prsMerged,
      testsAdded: store.totals.testsAdded,
      issuesFixed: store.totals.issuesFixed,
      agentSpawns: store.totals.agentSpawns,
      agentCrashes: store.totals.agentCrashes,
      period: 'all-time',
      since: store.daily[0]?.date ?? todayStr(),
    }
  }

  const today = todayStr()
  let days: DailyStats[]

  if (period === 'today') {
    days = store.daily.filter(d => d.date === today)
  } else {
    // week: last 7 days including today
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 6)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    days = store.daily.filter(d => d.date >= cutoffStr)
  }

  const sum = (key: keyof Omit<DailyStats, 'date' | 'agentUptime'>) =>
    days.reduce((acc, d) => acc + d[key], 0)

  return {
    prsMerged: sum('prsMerged'),
    testsAdded: sum('testsAdded'),
    issuesFixed: sum('issuesFixed'),
    agentSpawns: sum('agentSpawns'),
    agentCrashes: sum('agentCrashes'),
    period,
    since: period === 'today' ? today : (days[0]?.date ?? today),
  }
}
