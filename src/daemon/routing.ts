import { readFileSync } from 'fs'
import type { RoutingConfig } from '../shared/types.js'

export function resolveAgent(config: RoutingConfig, channelId: string): string | null {
  for (const [name, routing] of Object.entries(config.agents)) {
    if (routing.channels.includes(channelId)) return name
  }
  return config.defaultAgent ?? null
}

export function loadRouting(path: string): RoutingConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as RoutingConfig
}
