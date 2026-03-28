#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("agnts")
  .version("0.1.0")
  .description("Install coding agents for OpenCode, Claude Code, Codex, and Kiro");

program
  .command("add <source>")
  .description("Add an agent from a source")
  .option("--tool <tool>", "target tool", undefined)
  .option("--global", "install globally", false)
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
  .action(async (name: string) => {
    const { removeCommand } = await import("./commands/remove.js");
    await removeCommand(name);
  });

program
  .command("init [name]")
  .description("Initialize an agent scaffold")
  .action(async (name?: string) => {
    const { initCommand } = await import("./commands/init.js");
    await initCommand(name);
  });

program.parse(process.argv);
