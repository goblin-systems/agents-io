import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, readdir, writeFile } from "fs/promises";
import { join } from "path";
import { validateCommand } from "../../src/commands/validate.js";
import { buildAgentContent, cleanTempDir, makeTempDir } from "../helpers.js";

let tempDir = "";
const originalCwd = process.cwd();
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalExit = process.exit;
const loggedMessages: string[] = [];
const errorMessages: string[] = [];

afterEach(async () => {
  process.chdir(originalCwd);
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  process.exit = originalExit;
  loggedMessages.length = 0;
  errorMessages.length = 0;

  if (tempDir) {
    await cleanTempDir(tempDir);
    tempDir = "";
  }
});

function captureOutput(): void {
  console.log = (...args: unknown[]) => {
    loggedMessages.push(args.map(String).join(" "));
  };

  console.error = (...args: unknown[]) => {
    errorMessages.push(args.map(String).join(" "));
  };
}

function stubProcessExit(): void {
  process.exit = ((code?: number) => {
    throw new Error(`EXIT:${code ?? 0}`);
  }) as typeof process.exit;
}

describe("validate command", () => {
  test("validates a local source without installing anything", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceDir = join(tempDir, "agent-source");

    await mkdir(projectDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(projectDir, "package.json"), '{"name":"test-project"}\n', "utf-8");
    await writeFile(
      join(sourceDir, "agent.md"),
      buildAgentContent({ name: "review-agent", description: "Review agent" }),
      "utf-8",
    );

    process.chdir(projectDir);
    captureOutput();

    await validateCommand(sourceDir);

    expect(loggedMessages.some((message) => message.includes("◈  Validating agent from"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Agent 'review-agent' is valid"))).toBe(
      true,
    );
    expect(loggedMessages).toContain("|");
    expect(loggedMessages.some((message) => message.includes(`resolved source: ${sourceDir}`))).toBe(
      true,
    );
    await expect(access(join(projectDir, "agents-io-lock.json"))).rejects.toBeDefined();
    await expect(access(join(projectDir, "agents", "review-agent.md"))).rejects.toBeDefined();
  });

  test("fails with actionable output and non-zero exit for invalid sources", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");

    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "package.json"), '{"name":"test-project"}\n', "utf-8");

    process.chdir(projectDir);
    captureOutput();
    stubProcessExit();

    await expect(validateCommand(join(tempDir, "missing-agent"))).rejects.toThrow("EXIT:1");
    expect(errorMessages.some((message) => message.includes("Validation failed:"))).toBe(true);
    expect(errorMessages.some((message) => message.includes("Check the local path"))).toBe(true);
  });

  test("validates all discovered local agents without creating installation artifacts", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceRoot = join(tempDir, "agents-root");

    await mkdir(projectDir, { recursive: true });
    await mkdir(join(sourceRoot, "alpha"), { recursive: true });
    await mkdir(join(sourceRoot, "agents", "beta"), { recursive: true });
    await writeFile(join(projectDir, "package.json"), '{"name":"test-project"}\n', "utf-8");
    await writeFile(
      join(sourceRoot, "alpha", "agent.md"),
      buildAgentContent({ name: "alpha-agent", description: "Alpha local agent" }),
      "utf-8",
    );
    await writeFile(
      join(sourceRoot, "agents", "beta", "agent.md"),
      buildAgentContent({ name: "beta-agent", description: "Beta local agent" }),
      "utf-8",
    );

    process.chdir(projectDir);
    captureOutput();

    await validateCommand(sourceRoot);

    expect(loggedMessages.some((message) => message.includes("No root agent.md found."))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Agent 'alpha-agent' is valid"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Agent 'beta-agent' is valid"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("agent path: alpha"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("agent path: agents/beta"))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Validated 2 agent(s)"))).toBe(true);
    await expect(access(join(projectDir, "agents-io-lock.json"))).rejects.toBeDefined();
    await expect(access(join(projectDir, "agents"))).rejects.toBeDefined();
    expect(await readdir(projectDir)).toEqual(["package.json"]);
  });

  test("fails when a discovered local agent is invalid after full parsing", async () => {
    tempDir = await makeTempDir();
    const projectDir = join(tempDir, "project");
    const sourceRoot = join(tempDir, "agents-root");

    await mkdir(projectDir, { recursive: true });
    await mkdir(join(sourceRoot, "valid-agent"), { recursive: true });
    await mkdir(join(sourceRoot, "agents", "broken-agent"), { recursive: true });
    await writeFile(join(projectDir, "package.json"), '{"name":"test-project"}\n', "utf-8");
    await writeFile(
      join(sourceRoot, "valid-agent", "agent.md"),
      buildAgentContent({ name: "valid-agent", description: "Valid local agent" }),
      "utf-8",
    );
    await writeFile(
      join(sourceRoot, "agents", "broken-agent", "agent.md"),
      [
        "---",
        "name: broken-agent",
        "description: Broken local agent",
        "---",
        "",
      ].join("\n"),
      "utf-8",
    );

    process.chdir(projectDir);
    captureOutput();
    stubProcessExit();

    await expect(validateCommand(sourceRoot)).rejects.toThrow("EXIT:1");

    expect(loggedMessages.some((message) => message.includes("No root agent.md found."))).toBe(true);
    expect(loggedMessages.some((message) => message.includes("Agent 'valid-agent' is valid"))).toBe(true);
    expect(errorMessages.some((message) => message.includes("Agent file has no body content"))).toBe(true);
    await expect(access(join(projectDir, "agents-io-lock.json"))).rejects.toBeDefined();
    await expect(access(join(projectDir, "agents"))).rejects.toBeDefined();
  });
});
