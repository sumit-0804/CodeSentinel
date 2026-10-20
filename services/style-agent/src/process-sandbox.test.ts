import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ProcessSandbox } from "./sandbox.js";

// Stands in for sandbox/run.mjs: reports its env keys and fails if another run holds the lock.
const FAKE_RUN = `
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const lock = join(process.env.LINT_ROOT, "lock");
if (existsSync(lock)) { console.error("ran concurrently"); process.exit(2); }
writeFileSync(lock, "");
await new Promise((r) => setTimeout(r, 150));
rmSync(lock);
const names = readdirSync(process.env.LINT_WORK);
const env = Object.keys(process.env).sort().join(",");
process.stdout.write(JSON.stringify({ files: Object.fromEntries(names.map((n) => [n, { diagnostics: [], formatted: env }])) }));
`;

describe("ProcessSandbox", () => {
  let root: string;
  const secret = process.env.SERVICE_TOKEN;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "process-sandbox-"));
    await writeFile(join(root, "run.mjs"), FAKE_RUN, "utf8");
    process.env.SERVICE_TOKEN = "must-not-reach-the-child";
  });

  afterAll(async () => {
    if (secret === undefined) delete process.env.SERVICE_TOKEN;
    else process.env.SERVICE_TOKEN = secret;
    // Windows holds the killed child's files for a moment.
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("runs the files under root/work with a minimal env", async () => {
    const result = await new ProcessSandbox({ root }).run([{ name: "f0_h0.js", content: "let a = 1\n" }], AbortSignal.timeout(10_000));

    const env = result.files["f0_h0.js"]?.formatted?.split(",") ?? [];
    expect(env).toEqual(expect.arrayContaining(["LINT_ROOT", "LINT_WORK", "PATH"]));
    expect(env).not.toContain("SERVICE_TOKEN");
  });

  it("runs one request at a time", async () => {
    const sandbox = new ProcessSandbox({ root });
    const files = [{ name: "f0_h0.py", content: "x = 1\n" }];

    const results = await Promise.all([1, 2, 3].map(() => sandbox.run(files, AbortSignal.timeout(10_000))));

    expect(results.every((result) => result.files["f0_h0.py"])).toBe(true);
  });

  it("stops the child at the deadline", async () => {
    const sandbox = new ProcessSandbox({ root, timeoutMs: 50 });

    await expect(sandbox.run([{ name: "f0_h0.js", content: "" }], AbortSignal.timeout(10_000))).rejects.toThrow();
  });
});
