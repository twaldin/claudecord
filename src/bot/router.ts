/**
 * Channel-to-agent message router.
 *
 * Given an incoming Discord message, determines which agent should handle it
 * based on channel mappings. If no mapping exists, falls back to the default agent.
 *
 * Routing logic:
 * 1. Look up channel ID in channel config
 * 2. Get or spawn the appropriate agent session
 * 3. Forward the message content to the agent
 * 4. Stream the agent's response back to the Discord channel
 */

import type { ChannelMapping } from "../config/channels.js";

/**
 * Resolves which agent config should handle a message from a given channel.
 * Returns the matching ChannelMapping or the default if no specific mapping exists.
 */
export function resolveAgent(
  channelId: string,
  mappings: ReadonlyMap<string, ChannelMapping>,
  defaultMapping: ChannelMapping
): ChannelMapping {
  return mappings.get(channelId) ?? defaultMapping;
}
