/**
 * Discord utility helpers.
 *
 * - Message chunking (Discord's 2000-char limit)
 * - Markdown formatting for agent responses
 * - Typing indicator management
 */

const DISCORD_MAX_LENGTH = 2000;

/**
 * Split a long message into chunks that fit within Discord's character limit.
 * Splits on newlines when possible to avoid breaking mid-sentence.
 */
export function chunkMessage(content: string): string[] {
  if (content.length <= DISCORD_MAX_LENGTH) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point (prefer newline, fall back to space, then hard cut)
    let splitAt = remaining.lastIndexOf("\n", DISCORD_MAX_LENGTH);
    if (splitAt === -1 || splitAt < DISCORD_MAX_LENGTH / 2) {
      splitAt = remaining.lastIndexOf(" ", DISCORD_MAX_LENGTH);
    }
    if (splitAt === -1 || splitAt < DISCORD_MAX_LENGTH / 2) {
      splitAt = DISCORD_MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
