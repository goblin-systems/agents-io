import { mkdir, writeFile, access } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { log } from "../utils/logger.js";

const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function toTitleCase(kebab: string): string {
  return kebab
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function initCommand(name?: string): Promise<void> {
  const agentName = name ?? "my-agent";

  if (!KEBAB_CASE_RE.test(agentName)) {
    log.error(
      `Invalid name "${agentName}". Use kebab-case (a-z, 0-9, hyphens, no leading/trailing hyphens).`,
    );
    process.exit(1);
  }

  const dir = join(process.cwd(), agentName);
  const agentMdPath = join(dir, "agent.md");
  const readmePath = join(dir, "README.md");

  if (await exists(dir)) {
    log.error(`Agent '${agentName}' already exists here`);
    process.exit(1);
  }

  await mkdir(dir, { recursive: true });

  // --- agent.md -----------------------------------------------------------

  const title = toTitleCase(agentName);

  const frontmatter = {
    name: agentName,
    description: "TODO: Describe what this agent does",
    mode: "subagent",
    tools: {
      read: true,
      glob: true,
      grep: true,
      bash: false,
      write: true,
      edit: true,
    },
  };

  const body = `
# ${title}

You are a [role description]. Your job is to [primary responsibility].

## Your Expertise

- [Skill or knowledge area 1]
- [Skill or knowledge area 2]
- [Skill or knowledge area 3]

## Your Approach

1. [First step in your methodology]
2. [Second step]
3. [Third step]

## Constraints

- [What you should NOT do]
- [Boundaries to respect]

## Output Format

[Describe the expected output structure]
`;

  const agentMd = matter.stringify(body, frontmatter);
  await writeFile(agentMdPath, agentMd, "utf-8");

  // --- README.md ----------------------------------------------------------

  const readme = `# ${agentName}

> TODO: Describe what this agent does

## Install

\`\`\`bash
npx agnts add {github-user}/${agentName}
\`\`\`

## What it does

TODO: Explain the agent's purpose and capabilities.

## Supported tools

- [x] OpenCode
- [x] Claude Code
- [ ] Codex
- [ ] Kiro
`;

  await writeFile(readmePath, readme, "utf-8");

  // --- Done ---------------------------------------------------------------

  log.success(`Created agent template at ./${agentName}/`);
  log.dim(`Edit ${agentName}/agent.md to define your agent, then push to GitHub.`);
}
