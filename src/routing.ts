import { readFileSync, writeFileSync, renameSync } from 'fs'
import type { RoutingConfig, AgentChannelMeta } from './shared/types.js'

export function resolveAgent(config: RoutingConfig, channelId: string): string | null {
  for (const [name, routing] of Object.entries(config.agents)) {
    if (routing.channels.includes(channelId)) return name
  }
  return null
}

export function loadRouting(path: string): RoutingConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as RoutingConfig
}

export function saveRouting(config: RoutingConfig, path: string): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8')
  renameSync(tmp, path)
}

export function addAgentChannel(
  config: RoutingConfig,
  agentName: string,
  channelId: string,
  meta: AgentChannelMeta,
  routingPath: string,
): void {
  const existing = config.agents[agentName]
  if (existing) {
    if (!existing.channels.includes(channelId)) {
      existing.channels.push(channelId)
    }
    existing.meta = meta
  } else {
    config.agents[agentName] = { channels: [channelId], meta }
  }
  saveRouting(config, routingPath)
}

export function removeAgentChannel(
  config: RoutingConfig,
  agentName: string,
  routingPath: string,
): void {
  delete config.agents[agentName]
  saveRouting(config, routingPath)
}
