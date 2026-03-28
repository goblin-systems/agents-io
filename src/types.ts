export interface AgentFrontmatter {
  name: string;
  description: string;
  mode?: "primary" | "subagent";
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

export interface ParsedAgent {
  frontmatter: AgentFrontmatter;
  body: string;
  raw: string;
}

export type ToolTarget = "opencode" | "claude-code" | "codex" | "kiro";

export interface InstalledAgent {
  source: string;
  sourceUrl: string;
  agentPath: string;
  installedAt: string;
  installedFor: ToolTarget[];
  hash: string;
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
  name: ToolTarget;
  detect(projectDir: string): Promise<boolean>;
  install(ctx: AdapterContext): Promise<void>;
  uninstall(name: string, projectDir: string, global: boolean): Promise<void>;
}
