import chalk from "chalk";

function writeLine(
  prefix: string,
  msg: string,
  stream: "stdout" | "stderr" = "stdout",
  spacing = " ",
): void {
  const text = msg.length > 0 ? `${prefix}${spacing}${msg}` : prefix;
  if (stream === "stderr") {
    console.error(text);
    return;
  }

  console.log(text);
}

function writeDetail(msg = ""): void {
  writeLine("|", msg);
}

function colorIcon(icon: string, stream: "stdout" | "stderr"): string {
  if (stream === "stderr") {
    return chalk.red(icon);
  }

  switch (icon) {
    case "⇅":
      return chalk.cyan(icon);
    case "⇄":
      return chalk.blue(icon);
    case "⫸":
      return chalk.magenta(icon);
    case "⫷":
      return chalk.magenta(icon);
    case "◷":
      return chalk.yellow(icon);
    case "◈":
      return chalk.cyanBright(icon);
    case "▨":
      return chalk.blueBright(icon);
    case "✓":
      return chalk.green(icon);
    case "!":
      return chalk.yellowBright(icon);
    default:
      return icon;
  }
}

function writeStep(icon: string, msg: string, stream: "stdout" | "stderr" = "stdout"): void {
  writeLine(colorIcon(icon, stream), msg, stream, "  ");
}

export const log = {
  plain(msg: string): void {
    console.log(msg);
  },
  spacer(): void {
    writeDetail();
  },
  detail(msg = ""): void {
    writeDetail(msg);
  },
  fetch(msg: string): void {
    writeStep("⇅", msg);
  },
  sync(msg: string): void {
    writeStep("⇄", msg);
  },
  install(msg: string): void {
    writeStep("⫸", msg);
  },
  remove(msg: string): void {
    writeStep("⫷", msg);
  },
  progress(msg: string): void {
    writeStep("◷", msg);
  },
  inspect(msg: string): void {
    writeStep("◈", msg);
  },
  section(msg: string): void {
    writeStep("▨", msg);
  },
  success(msg: string): void {
    writeStep("✓", msg);
  },
  warn(msg: string): void {
    writeStep("!", msg);
  },
  error(msg: string): void {
    writeStep("x", msg, "stderr");
  },
  info(msg: string): void {
    writeStep("◷", msg);
  },
  dim(msg: string): void {
    writeDetail(msg);
  },
  installProgress(msg: string): void {
    writeStep("⫸", msg);
  },
  installSuccess(msg: string): void {
    writeStep("✓", msg);
  },
};
