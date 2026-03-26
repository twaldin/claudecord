import { describe, it, expect } from "vitest";
import { resolveAgent } from "../src/bot/router.js";
import type { ChannelMapping } from "../src/config/channels.js";

const defaultMapping: ChannelMapping = {
  channelId: "default",
  agent: { name: "default", promptFile: "agents/default.md" },
  enabled: true,
};

const customMapping: ChannelMapping = {
  channelId: "123456",
  agent: { name: "custom", promptFile: "agents/custom.md" },
  enabled: true,
};

describe("resolveAgent", () => {
  it("returns the matching mapping when channel is configured", () => {
    const mappings = new Map([["123456", customMapping]]);
    const result = resolveAgent("123456", mappings, defaultMapping);
    expect(result).toBe(customMapping);
  });

  it("returns the default mapping when channel is not configured", () => {
    const mappings = new Map<string, ChannelMapping>();
    const result = resolveAgent("unknown-channel", mappings, defaultMapping);
    expect(result).toBe(defaultMapping);
  });

  it("returns default when mappings map is empty", () => {
    const mappings = new Map<string, ChannelMapping>();
    const result = resolveAgent("anything", mappings, defaultMapping);
    expect(result.agent.name).toBe("default");
  });
});
