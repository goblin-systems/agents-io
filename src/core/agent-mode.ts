import type { AgentMode, InstalledAgent, ParsedAgent } from "../types.js";

const VALID_AGENT_MODES = ["primary", "subagent"] as const satisfies readonly AgentMode[];

export function validateAgentMode(value: string | undefined): AgentMode | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "primary" || value === "subagent") {
    return value;
  }

  throw new Error(
    `Invalid mode '${value}'. Expected one of: ${VALID_AGENT_MODES.join(", ")}`,
  );
}

export function getEffectiveAgentMode(
  agent: ParsedAgent,
  modeOverride?: AgentMode,
): AgentMode {
  return modeOverride ?? agent.frontmatter.mode ?? "subagent";
}

export function applyAgentModeOverride(
  agent: ParsedAgent,
  modeOverride?: AgentMode,
): ParsedAgent {
  if (!modeOverride) {
    return agent;
  }

  return {
    ...agent,
    frontmatter: {
      ...agent.frontmatter,
      mode: modeOverride,
    },
  };
}

export function getStoredModeOverride(entry: InstalledAgent): AgentMode | undefined {
  return entry.modeOverride;
}
