// agnts-lock.json manager
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import type { LockFile, InstalledAgent } from "../types.js";

const LOCK_FILENAME = "agnts-lock.json";

function emptyLockFile(): LockFile {
  return { version: 1, agents: {} };
}

/** SHA-256 hash of content, hex-encoded, first 12 chars. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

/** Get the path to the lock file. */
export function getLockFilePath(
  global: boolean,
  projectRoot?: string,
): string {
  if (global) {
    return join(homedir(), ".config", "agnts", LOCK_FILENAME);
  }
  return join(projectRoot ?? process.cwd(), LOCK_FILENAME);
}

/** Read the lock file. Return empty lock file if it doesn't exist. */
export async function readLockFile(
  global: boolean,
  projectRoot?: string,
): Promise<LockFile> {
  const filePath = getLockFilePath(global, projectRoot);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as LockFile;
  } catch {
    return emptyLockFile();
  }
}

/** Write the lock file (pretty-printed JSON). */
export async function writeLockFile(
  lockFile: LockFile,
  global: boolean,
  projectRoot?: string,
): Promise<void> {
  const filePath = getLockFilePath(global, projectRoot);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(lockFile, null, 2) + "\n", "utf-8");
}

/** Add or update an agent entry in the lock file. */
export async function addAgent(
  name: string,
  entry: InstalledAgent,
  global: boolean,
  projectRoot?: string,
): Promise<void> {
  const lockFile = await readLockFile(global, projectRoot);
  lockFile.agents[name] = entry;
  await writeLockFile(lockFile, global, projectRoot);
}

/** Remove an agent entry from the lock file. */
export async function removeAgent(
  name: string,
  global: boolean,
  projectRoot?: string,
): Promise<void> {
  const lockFile = await readLockFile(global, projectRoot);
  delete lockFile.agents[name];
  await writeLockFile(lockFile, global, projectRoot);
}

/** Get a single agent entry (or undefined if not found). */
export async function getAgent(
  name: string,
  global: boolean,
  projectRoot?: string,
): Promise<InstalledAgent | undefined> {
  const lockFile = await readLockFile(global, projectRoot);
  return lockFile.agents[name];
}

/** Get all installed agents. */
export async function listAgents(
  global: boolean,
  projectRoot?: string,
): Promise<Record<string, InstalledAgent>> {
  const lockFile = await readLockFile(global, projectRoot);
  return lockFile.agents;
}
