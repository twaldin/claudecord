/**
 * Claude Code SDK session wrapper.
 *
 * Thin wrapper around the Claude Code SDK's streaming conversation API.
 * Handles:
 * - Session initialization with system prompt from agent definition markdown
 * - Streaming message sends
 * - Collecting streamed response chunks into complete messages
 * - Error handling and session health checks
 *
 * Uses the streaming API from @anthropic-ai/claude-code-sdk.
 */

// TODO: Implement session wrapper
// - Initialize SDK client with API key
// - Load system prompt from agent definition .md file
// - send(message): stream to Claude, collect response
// - Expose async iterator for streamed chunks
