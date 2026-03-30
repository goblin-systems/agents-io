import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { log } from "../../src/utils/logger.js";

const originalConsoleLog = console.log;
const loggedMessages: string[] = [];

beforeEach(() => {
  loggedMessages.length = 0;
  console.log = (...args: unknown[]) => {
    loggedMessages.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  console.log = originalConsoleLog;
});

describe("logger", () => {
  test("spacer writes a bare detail guide line", () => {
    log.spacer();

    expect(loggedMessages).toEqual(["|"]);
  });
});
