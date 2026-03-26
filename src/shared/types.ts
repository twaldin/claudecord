export interface RoutingConfig {
  agents: Record<string, { channels: string[] }>
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

export interface AgentReply {
  channelId: string
  text: string
  replyTo?: string
}
