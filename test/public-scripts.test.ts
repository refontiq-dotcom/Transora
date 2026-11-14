import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import { describe, expect, test } from "vitest";

describe("public browser scripts", () => {
  test.each(["public/app.js", "public/reservation.js"])("parses %s without syntax errors", async (path) => {
    const source = await readFile(path, "utf8");
    expect(() => new Script(source, { filename: path })).not.toThrow();
  });
});
