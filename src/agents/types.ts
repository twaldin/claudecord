/**
 * Agent type definitions.
 */

/** Unique identifier for an agent session */
export type AgentId = string;

/** Configuration for spawning a new agent */
export interface AgentConfig {
  /** Display name for logging */
  readonly name: string;

  /** Path to the agent's system prompt markdown file */
  readonly promptFile: string;

  /** Model to use (defaults to claude-sonnet-4-20250514) */
  readonly model?: string;

  /** Maximum tokens per response turn */
  readonly maxTurns?: number;

  /** Working directory for the agent's file operations */
  readonly cwd?: string;
}

/** Runtime state of an active agent session */
export interface AgentSession {
  readonly id: AgentId;
  readonly config: AgentConfig;
  readonly channelId: string;
  readonly createdAt: Date;

  /** Send a message to the agent and get a streamed response */
  // TODO: Define the actual send/stream interface once SDK is integrated
}

/** Status of an agent session */
export type AgentStatus = "idle" | "processing" | "error" | "dead";
