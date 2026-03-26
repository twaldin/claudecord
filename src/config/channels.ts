/**
 * Channel-to-agent mapping configuration.
 *
 * Defines which agent handles messages from which Discord channel.
 * Channels not in the mapping fall through to the default agent.
 */

import type { AgentConfig } from "../agents/types.js";

/** Maps a Discord channel to an agent configuration */
export interface ChannelMapping {
  /** Discord channel ID */
  readonly channelId: string;

  /** Agent config to use for this channel */
  readonly agent: AgentConfig;

  /** Whether this channel is enabled */
  readonly enabled: boolean;
}

// TODO: Load channel mappings from config file or env
// For Phase 1, hardcode or use a simple JSON/TS config
