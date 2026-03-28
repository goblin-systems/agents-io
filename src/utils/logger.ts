import chalk from "chalk";

export const log = {
  info(msg: string): void {
    console.log(chalk.blue("\u2139"), msg);
  },
  success(msg: string): void {
    console.log(chalk.green("\u2714"), msg);
  },
  warn(msg: string): void {
    console.log(chalk.yellow("\u26A0"), msg);
  },
  error(msg: string): void {
    console.error(chalk.red("\u2716"), msg);
  },
  dim(msg: string): void {
    console.log(chalk.dim(msg));
  },
};
