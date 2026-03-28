import matter from "gray-matter";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export function buildAgentContent(overrides?: {
  name?: string;
  description?: string;
  mode?: string;
  tools?: Record<string, boolean>;
  body?: string;
  extra?: Record<string, unknown>;
}): string {
  const fm: Record<string, unknown> = {
    name: overrides?.name ?? "test-agent",
    description: overrides?.description ?? "A test agent",
    ...overrides?.extra,
  };
  if (overrides?.mode) fm.mode = overrides.mode;
  if (overrides?.tools) fm.tools = overrides.tools;

  const body = overrides?.body ?? "\n# Test Agent\n\nYou are a test agent.\n";
  return matter.stringify(body, fm);
}

export async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agnts-test-"));
}

export async function cleanTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
