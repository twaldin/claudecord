export type AgentType = 'coder' | 'researcher' | 'evaluator' | 'persistent'

export interface AgentChannelMeta {
  agentType: AgentType
  spawnedAt: string
  task?: string
  issueNumber?: number
  prNumber?: number
}

export interface RoutingConfig {
  agents: Record<string, { channels: string[]; meta?: AgentChannelMeta }>
  defaultAgent?: string
}

export interface ChannelMessage {
  content: string
  channelId: string
  messageId: string
  userId: string
  username: string
  timestamp: string
  attachments?: Array<{ name: string; url: string; size: number; contentType: string }>
}

export interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface AgentEmbed {
  title?: string
  description?: string
  color?: number
  fields?: EmbedField[]
  footer?: string
  url?: string
  thumbnailUrl?: string
}

export interface AgentReply {
  channelId: string
  text?: string
  embed?: AgentEmbed
  replyTo?: string
}

// --- Embed data types ---

export interface SpawnEmbedData {
  agentName: string
  agentType: AgentType
  task: string
  issueNumber?: number
  prNumber?: number
  worktreePath?: string
  model?: string
  spawnedAt: string
  channelName?: string
}

export interface CompletionEmbedData {
  agentName: string
  success: boolean
  duration?: string
  filesChanged?: number
  prNumber?: number
  summary?: string
  exitReason?: string
}

export interface HeartbeatEmbedData {
  agents: AgentStatusEntry[]
  taskCounts: { p0: number; p1: number; p2: number }
  systemHealth: 'healthy' | 'degraded' | 'critical'
}

export interface PRReviewEmbedData {
  prNumber: number
  prTitle: string
  verdict: 'approved' | 'changes-requested' | 'pending'
  confidence?: number
  blockers?: string[]
  testsStatus?: string
  prUrl?: string
}

export interface DeployEmbedData {
  prNumber?: number
  prMerged: boolean
  testsPass: boolean
  vpsTarget?: string
  restartStatus?: string
  duration?: string
  prUrl?: string
}

export interface CleanupEmbedData {
  agentName: string
  duration?: string
  worktreePath?: string
  prNumber?: number
}

export interface AgentStatusEntry {
  name: string
  type: AgentType
  status: 'idle' | 'working' | 'compacting' | 'dead'
  contextPct?: number
  lastActivity: string
  channelId?: string
}

export interface StatusBoardData {
  agents: AgentStatusEntry[]
  taskCounts: { p0: number; p1: number; p2: number }
  systemHealth: 'healthy' | 'degraded' | 'critical'
  lastUpdated: string
}

export interface PeriodStats {
  prsMerged: number
  testsAdded: number
  issuesFixed: number
  agentSpawns: number
  agentCrashes: number
  period: 'today' | 'week' | 'all-time'
  since: string
}

// --- HTTP API body types ---

export interface AgentSpawnBody {
  agentName: string
  agentType: AgentType
  task: string
  issueNumber?: number
  prNumber?: number
  worktreePath?: string
  model?: string
}

export interface WorkCompletedBody {
  agentName: string
  prNumber?: number
  issueNumber?: number
  testsAdded?: number
  merged?: boolean
}

export interface AgentHeartbeatBody {
  agentName: string
  contextPct: number
  status: 'idle' | 'working' | 'compacting' | 'dead'
}
