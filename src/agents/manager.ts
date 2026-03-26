/**
 * Agent lifecycle manager.
 *
 * Responsible for:
 * - Spawning new Claude agent sessions via the Claude Code SDK
 * - Tracking active sessions by channel ID
 * - Resuming existing sessions for follow-up messages
 * - Killing sessions on demand or timeout
 *
 * Phase 1: One session per channel, no persistence across restarts.
 * Phase 2: Multi-session support, persistent state, agent-to-agent routing.
 */

// TODO: Implement AgentManager
// - Map<channelId, AgentSession> for active sessions
// - spawn(channelId, config): create new Claude Code SDK session
// - get(channelId): return existing session or undefined
// - kill(channelId): terminate and remove session
// - killAll(): cleanup on shutdown
