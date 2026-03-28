import { homedir } from "os";
import { join, resolve } from "path";
import { existsSync } from "fs";
import type { Platform } from "../types.js";

const PROJECT_MARKERS = [".git", "package.json", "opencode.json"];

/** Resolve the project-level config directory for a platform. */
export function getProjectDir(platform: Platform, projectRoot: string): string {
  switch (platform) {
    case "opencode":
      return projectRoot;
    case "claude-code":
      return join(projectRoot, ".claude");
    case "codex":
      return projectRoot;
    case "kiro":
      return join(projectRoot, ".kiro");
  }
}

/** Resolve the global config directory for a platform. */
export function getGlobalDir(platform: Platform): string {
  const home = homedir();
  switch (platform) {
    case "opencode":
      return join(home, ".config", "opencode");
    case "claude-code":
      return join(home, ".claude");
    case "codex":
      return join(home, ".codex");
    case "kiro":
      return join(home, ".kiro");
  }
}

/** Find the project root by walking up looking for common markers. */
export function findProjectRoot(startDir?: string): string {
  let dir = resolve(startDir ?? process.cwd());

  while (true) {
    for (const marker of PROJECT_MARKERS) {
      if (existsSync(join(dir, marker))) {
        return dir;
      }
    }

    const parent = resolve(dir, "..");
    if (parent === dir) {
      // Reached filesystem root without finding a marker
      return resolve(startDir ?? process.cwd());
    }
    dir = parent;
  }
}
