export interface DiscoveredAgent {
  /** Agent name from frontmatter */
  name: string;
  /** Agent description from frontmatter */
  description: string;
  /** Relative path from source root to the directory containing agent.md */
  path: string;
}

export interface AgentFrontmatter {
  name: string;
  description: string;
  mode?: "primary" | "subagent";
  color?: string;
  model?: string;
  tools?: Record<string, boolean>;
  "claude-code"?: {
    permissions?: {
      allow?: string[];
      deny?: string[];
    };
  };
  kiro?: {
    model?: string;
    tools?: string[];
    allowedTools?: string[];
    hooks?: Record<string, unknown>;
  };
}

export interface AgentSettings {
  color?: string;
  model?: string;
  temperature?: number;
  opencode?: Record<string, unknown>;
  "claude-code"?: Record<string, unknown>;
  kiro?: Record<string, unknown>;
}

export interface ParsedAgent {
  frontmatter: AgentFrontmatter;
  settings: AgentSettings;
  body: string;
  raw: string;
}

export type Platform = "opencode" | "claude-code" | "codex" | "kiro";

export interface InstalledAgent {
  source: string;
  sourceType: "github" | "local";
  sourceUrl: string;
  agentPath: string;
  installedAt: string;
  platforms: Platform[];
  hash: string;
  platformHashes?: Partial<Record<Platform, string>>;
}

export interface LockFile {
  version: number;
  agents: Record<string, InstalledAgent>;
}

export interface AdapterContext {
  agent: ParsedAgent;
  projectDir: string;
  global: boolean;
}

export interface Adapter {
  name: Platform;
  detect(projectDir: string): Promise<boolean>;
  install(ctx: AdapterContext): Promise<void>;
  uninstall(name: string, projectDir: string, global: boolean): Promise<void>;
}
