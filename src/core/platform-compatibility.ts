import type { ParsedAgent, Platform } from "../types.js";

const KIRO_TOOL_MAP = {
  read: "read",
  glob: "read",
  grep: "read",
  write: "write",
  edit: "write",
  bash: "shell",
} as const;

const CODEX_DROPPED_FRONTMATTER_FIELDS = [
  "mode",
  "tools",
  "color",
  "model",
  "claude-code",
  "kiro",
] as const;

export interface PlatformCompatibilityIssue {
  platform: Platform;
  severity: "warning" | "error";
  message: string;
}

function getEnabledGenericTools(tools: Record<string, boolean>): string[] {
  return Object.entries(tools)
    .filter(([, enabled]) => enabled)
    .map(([tool]) => tool);
}

export function deriveKiroTools(tools: Record<string, boolean>): string[] {
  const result = new Set<string>();

  for (const tool of getEnabledGenericTools(tools)) {
    const mappedTool = KIRO_TOOL_MAP[tool as keyof typeof KIRO_TOOL_MAP];
    if (mappedTool) {
      result.add(mappedTool);
    }
  }

  return [...result];
}

function getUnmappedKiroTools(tools: Record<string, boolean>): string[] {
  return getEnabledGenericTools(tools).filter((tool) => {
    return !(tool in KIRO_TOOL_MAP);
  });
}

function hasExplicitKiroToolsOverride(agent: ParsedAgent): boolean {
  if (Array.isArray(agent.frontmatter.kiro?.tools)) {
    return true;
  }

  const kiroSettings = agent.settings.kiro;
  return !!(kiroSettings && typeof kiroSettings === "object" && Array.isArray(kiroSettings.tools));
}

function getCodexDroppedFields(agent: ParsedAgent): string[] {
  const frontmatterFields = CODEX_DROPPED_FRONTMATTER_FIELDS.filter((field) => {
    return agent.frontmatter[field] !== undefined;
  });
  const settingsFields = Object.keys(agent.settings);

  if (settingsFields.length === 0) {
    return [...frontmatterFields];
  }

  return [...frontmatterFields, ...settingsFields.map((field) => `agent.json:${field}`)];
}

export function getPlatformCompatibilityIssues(
  agent: ParsedAgent,
  platforms: Platform[],
): PlatformCompatibilityIssue[] {
  const issues: PlatformCompatibilityIssue[] = [];

  for (const platform of platforms) {
    if (platform !== "opencode" && agent.frontmatter.mode === "primary") {
      issues.push({
        platform,
        severity: "warning",
        message: "`mode: primary` is not preserved for this platform.",
      });
    }

    if (platform === "kiro") {
      const tools = agent.frontmatter.tools;

      if (tools && !hasExplicitKiroToolsOverride(agent)) {
        const mappedTools = deriveKiroTools(tools);
        const unmappedTools = getUnmappedKiroTools(tools);

        if (mappedTools.length === 0) {
          issues.push({
            platform,
            severity: "error",
            message: "enabled generic tools do not map to Kiro tools, so install would otherwise broaden to Kiro defaults; add an explicit `kiro.tools` override.",
          });
        } else if (unmappedTools.length > 0) {
          issues.push({
            platform,
            severity: "warning",
            message: `generic tools ${unmappedTools.join(", ")} do not map to Kiro and will be dropped; derived Kiro tools: ${mappedTools.join(", ")}. Add an explicit \`kiro.tools\` override to keep control.`,
          });
        }
      }
    }

    if (platform === "codex") {
      const droppedFields = getCodexDroppedFields(agent);

      if (droppedFields.length > 0) {
        issues.push({
          platform,
          severity: "warning",
          message: `Codex only preserves the agent name, description, and prompt body; dropped fields: ${droppedFields.join(", ")}.`,
        });
      }
    }
  }

  return issues;
}
