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
  .option("--dry-run", "preview add without writing changes")
  .option("--path <path>", "subfolder in repo")
  .option("--host <host>", "GitHub Enterprise host for owner/repo shorthand")
  .option("--branch <name>", "pin a GitHub install to a branch")
  .option("--tag <name>", "pin a GitHub install to a tag")
  .option("--commit <sha>", "pin a GitHub install to a commit")
  .action(async (source: string, options: Record<string, unknown>) => {
    const { addCommand } = await import("./commands/add.js");
    await addCommand(source, options);
  });

program
  .command("list")
  .description("List installed agents")
  .option("--verbose", "show lock file paths and registry status")
  .action(async (options: Record<string, unknown>) => {
    const { listCommand } = await import("./commands/list.js");
    await listCommand(options);
  });

program
  .command("validate <source>")
  .description("Validate an agent source without installing it")
  .option("--path <path>", "subfolder in repo")
  .option("--host <host>", "GitHub Enterprise host for owner/repo shorthand")
  .action(async (source: string, options: Record<string, unknown>) => {
    const { validateCommand } = await import("./commands/validate.js");
    await validateCommand(source, options);
  });

program
  .command("doctor")
  .description("Check install health for one scope")
  .option("--global", "check the global install scope")
  .action(async (options: Record<string, unknown>) => {
    const { doctorCommand } = await import("./commands/doctor.js");
    await doctorCommand(options);
  });

program
  .command("sync")
  .description("Sync project-scoped agents from the lock file")
  .action(async () => {
    const { syncCommand } = await import("./commands/sync.js");
    await syncCommand();
  });

program
  .command("remove [name]")
  .description("Remove an installed agent")
  .option("--platform <platform>", "remove only from one platform")
  .option("--local", "remove the project-scoped install")
  .option("--global", "remove the global-scoped install")
  .option("--all", "remove both project and global installs")
  .option("--dry-run", "preview removal without writing changes")
  .action(async (name: string | undefined, options: Record<string, unknown>) => {
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
  .option("--check", "report update status without writing changes")
  .option("--platform <platform>", "target platform")
  .option("--local", "update project-scoped agents")
  .option("--global", "update global agents")
  .action(async (name: string | undefined, options: Record<string, unknown>) => {
    const { updateCommand } = await import("./commands/update.js");
    await updateCommand(name, options);
  });

program
  .command("search [query]")
  .description("Search for agents on GitHub")
  .action(async (query?: string) => {
    const { searchCommand } = await import("./commands/search.js");
    await searchCommand(query);
  });

program.parse(process.argv);
