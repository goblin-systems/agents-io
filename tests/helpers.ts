import matter from "gray-matter";
import { execFile } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

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
  return mkdtemp(join(tmpdir(), "agents-io-test-"));
}

export async function cleanTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function runGit(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    encoding: "utf-8",
  });

  return stdout.trim();
}

export async function initGitRepository(repoDir: string): Promise<void> {
  await mkdir(repoDir, { recursive: true });
  await runGit(["init", "-b", "main"], repoDir);
  await runGit(["config", "user.name", "agents-io tests"], repoDir);
  await runGit(["config", "user.email", "agents-io@example.com"], repoDir);
}

export async function commitAll(repoDir: string, message: string): Promise<void> {
  await runGit(["add", "."], repoDir);
  await runGit(["commit", "-m", message], repoDir);
}

export async function createBareRemoteFromWorkingRepo(
  workingRepoDir: string,
  bareRemoteDir: string,
): Promise<void> {
  await runGit(["init", "--bare", bareRemoteDir]);
  await runGit(["symbolic-ref", "HEAD", "refs/heads/main"], bareRemoteDir);
  await runGit(["remote", "add", "origin", bareRemoteDir], workingRepoDir);
  await runGit(["push", "-u", "origin", "main"], workingRepoDir);
}

export async function seedRepositoryCache(
  configDir: string,
  owner: string,
  repo: string,
  remoteUrl: string,
): Promise<string> {
  const cacheDir = join(configDir, "repositories", owner, repo);
  await mkdir(dirname(cacheDir), { recursive: true });
  await runGit(["clone", remoteUrl, cacheDir]);
  return cacheDir;
}

export async function createCachedGitHubRepository(options: {
  rootDir: string;
  configDir: string;
  owner: string;
  repo: string;
  files: Record<string, string>;
}): Promise<{ workingRepoDir: string; bareRemoteDir: string; cacheDir: string }> {
  const workingRepoDir = join(options.rootDir, "working-repo");
  const bareRemoteDir = join(options.rootDir, "remote.git");

  await initGitRepository(workingRepoDir);

  for (const [relativePath, content] of Object.entries(options.files)) {
    const filePath = join(workingRepoDir, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
  }

  await commitAll(workingRepoDir, "Initial commit");
  await createBareRemoteFromWorkingRepo(workingRepoDir, bareRemoteDir);
  const cacheDir = await seedRepositoryCache(
    options.configDir,
    options.owner,
    options.repo,
    bareRemoteDir,
  );

  return { workingRepoDir, bareRemoteDir, cacheDir };
}
