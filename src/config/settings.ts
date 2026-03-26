/**
 * Bot settings — validated at startup with zod.
 */

import { z } from "zod";

export const settingsSchema = z.object({
  /** Discord bot token */
  discordToken: z.string().min(1, "DISCORD_TOKEN is required"),

  /** Anthropic API key for Claude Code SDK */
  anthropicApiKey: z.string().min(1, "ANTHROPIC_API_KEY is required"),
});

export type Settings = z.infer<typeof settingsSchema>;

/**
 * Parse and validate settings from environment variables.
 * Throws a ZodError if validation fails.
 */
export function loadSettings(): Settings {
  return settingsSchema.parse({
    discordToken: process.env["DISCORD_TOKEN"],
    anthropicApiKey: process.env["ANTHROPIC_API_KEY"],
  });
}
