export interface AddOptions {
  tool?: "opencode" | "claude-code" | "codex" | "kiro";
  global?: boolean;
  path?: string;
}

export async function addCommand(
  source: string,
  options: AddOptions,
): Promise<void> {
  // TODO: implement
  console.log("add", source, options);
}
