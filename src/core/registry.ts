// agents-io-lock.json manager
import { access, readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { createHash } from "crypto";
import type { LockFile, InstalledAgent } from "../types.js";
import { getAgentsIoConfigDir } from "../utils/paths.js";

const LOCK_FILENAME = "agents-io-lock.json";

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
    return join(getAgentsIoConfigDir(), LOCK_FILENAME);
  }
  return join(projectRoot ?? process.cwd(), LOCK_FILENAME);
}

export interface LockFileDetails {
  path: string;
  exists: boolean;
  lockFile: LockFile;
}

export interface LockFileInspection {
  path: string;
  exists: boolean;
  readable: boolean;
  lockFile: LockFile;
  error?: string;
}

/**
 * Migrate a raw parsed agent entry from old key names to the current schema.
 * Old lock files used `installedFor` and `toolHashes`; new ones use `platforms`
 * and `platformHashes`. Both fields are kept transparently for backward compat.
 */
function migrateEntry(entry: InstalledAgent & Record<string, unknown>): InstalledAgent {
  if (!entry.platforms && entry["installedFor"]) {
    entry.platforms = entry["installedFor"] as InstalledAgent["platforms"];
  }
  if (!entry.platformHashes && entry["toolHashes"]) {
    entry.platformHashes = entry["toolHashes"] as InstalledAgent["platformHashes"];
  }
  return entry;
}

function parseLockFile(raw: string): LockFile {
  const parsed = JSON.parse(raw) as LockFile;
  for (const name of Object.keys(parsed.agents)) {
    parsed.agents[name] = migrateEntry(
      parsed.agents[name] as InstalledAgent & Record<string, unknown>,
    );
  }

  return parsed;
}

/** Read the lock file. Return empty lock file if it doesn't exist. */
export async function readLockFile(
  global: boolean,
  projectRoot?: string,
): Promise<LockFile> {
  const filePath = getLockFilePath(global, projectRoot);
  try {
    const raw = await readFile(filePath, "utf-8");
    return parseLockFile(raw);
  } catch {
    return emptyLockFile();
  }
}

export async function inspectLockFile(
  global: boolean,
  projectRoot?: string,
): Promise<LockFileInspection> {
  const path = getLockFilePath(global, projectRoot);

  try {
    await access(path);
  } catch {
    return {
      path,
      exists: false,
      readable: true,
      lockFile: emptyLockFile(),
    };
  }

  try {
    const raw = await readFile(path, "utf-8");
    return {
      path,
      exists: true,
      readable: true,
      lockFile: parseLockFile(raw),
    };
  } catch (error) {
    return {
      path,
      exists: true,
      readable: false,
      lockFile: emptyLockFile(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function readLockFileDetails(
  global: boolean,
  projectRoot?: string,
): Promise<LockFileDetails> {
  const path = getLockFilePath(global, projectRoot);

  try {
    await access(path);
    return {
      path,
      exists: true,
      lockFile: await readLockFile(global, projectRoot),
    };
  } catch {
    return {
      path,
      exists: false,
      lockFile: emptyLockFile(),
    };
  }
}

export type AgentRegistryStatus = "synced" | "mixed";

export function getAgentRegistryStatus(entry: InstalledAgent): AgentRegistryStatus {
  const resolvedHashes = entry.platforms.map(
    (platform) => entry.platformHashes?.[platform] ?? entry.hash,
  );

  if (resolvedHashes.length === 0) {
    return "mixed";
  }

  const uniqueHashes = new Set(resolvedHashes);
  return uniqueHashes.size === 1 && resolvedHashes[0] === entry.hash ? "synced" : "mixed";
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
