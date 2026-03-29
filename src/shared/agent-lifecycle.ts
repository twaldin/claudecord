import type { AgentType } from './types.js'

export type AgentLifecycle = 'persistent' | 'ephemeral'

export interface AgentDefinition {
  name: string
  lifecycle: AgentLifecycle
  type: AgentType
  model?: string
  schedule?: {
    spawn: string
    kill: string
  }
  completionProtocol?: {
    postTo: string[]
    messageOrchestrator: boolean
    autoExit: boolean
  }
}

export function getDefaultCompletionProtocol(
  lifecycle: AgentLifecycle,
): AgentDefinition['completionProtocol'] {
  if (lifecycle === 'persistent') return undefined
  return { postTo: [], messageOrchestrator: true, autoExit: true }
}

export function shouldRespawnOnCrash(lifecycle: AgentLifecycle): boolean {
  return lifecycle === 'persistent'
}

export function shouldSelfCompact(lifecycle: AgentLifecycle): boolean {
  return lifecycle === 'persistent'
}
