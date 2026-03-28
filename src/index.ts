#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("agents-io")
  .version("0.1.0")
  .description("Install coding agents for OpenCode, Claude Code, Codex, and Kiro");

program
  .command("add <source>")
  .description("Add an agent from a source")
  .option("--platform <platform>", "target platform", undefined)
  .option("--global", "install globally")
  .option("--path <path>", "subfolder in repo")
  .action(async (source: string, options: Record<string, unknown>) => {
    const { addCommand } = await import("./commands/add.js");
    await addCommand(source, options);
  });

program
  .command("list")
  .description("List installed agents")
  .action(async () => {
    const { listCommand } = await import("./commands/list.js");
    await listCommand();
  });

program
  .command("remove <name>")
  .description("Remove an installed agent")
  .option("--platform <platform>", "remove only from one platform")
  .option("--local", "remove the project-scoped install")
  .option("--global", "remove the global-scoped install")
  .option("--all", "remove both project and global installs")
  .action(async (name: string, options: Record<string, unknown>) => {
    const { removeCommand } = await import("./commands/remove.js");
    await removeCommand(name, options);
  });

program
  .command("init [name]")
  .description("Initialize an agent scaffold")
  .action(async (name?: string) => {
    const { initCommand } = await import("./commands/init.js");
    await initCommand(name);
  });

program
  .command("update [name]")
  .description("Update installed agents")
  .option("--platform <platform>", "target platform")
  .option("--global", "update global agents")
  .action(async (name: string | undefined, options: Record<string, unknown>) => {
    const { updateCommand } = await import("./commands/update.js");
    await updateCommand(name, options);
  });

program.parse(process.argv);
