function withPrefix(prefix: string, msg: string): string {
  return `${prefix} ${msg}`;
}

export const log = {
  info(msg: string): void {
    console.log(withPrefix("[-]", msg));
  },
  success(msg: string): void {
    console.log(withPrefix("[+]", msg));
  },
  plain(msg: string): void {
    console.log(msg);
  },
  warn(msg: string): void {
    console.log(withPrefix("[!]", msg));
  },
  error(msg: string): void {
    console.error(withPrefix("[x]", msg));
  },
  dim(msg: string): void {
    console.log(withPrefix("[.]", msg));
  },
  installProgress(msg: string): void {
    console.log(withPrefix("[>]", msg));
  },
  installSuccess(msg: string): void {
    console.log(withPrefix("[#]", msg));
  },
};
