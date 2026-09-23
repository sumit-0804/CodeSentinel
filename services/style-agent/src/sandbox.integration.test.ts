import { describe, expect, it } from "vitest";

import { DEFAULT_SANDBOX_IMAGE, DockerSandbox } from "./sandbox.js";

/** Needs Docker and the built image (`npm run sandbox:build`), so CI skips it. */
describe.skipIf(process.env.STYLE_SANDBOX_IT !== "1")("DockerSandbox (real image)", () => {
  const sandbox = new DockerSandbox({ image: process.env.STYLE_SANDBOX_IMAGE ?? DEFAULT_SANDBOX_IMAGE });

  it("lints and formats JS and Python fragments with no network", async () => {
    const result = await sandbox.run(
      [
        { name: "f0_h0.js", content: "var total  = 0\n" },
        { name: "f1_h0.py", content: "def f( a ):\n    return a==None\n" },
        { name: "f2_h0.js", content: "fetch('https://example.com').then(() => {})\n" },
        // A hunk from inside a function: the bare return must still parse.
        { name: "f3_h0.js", content: "var tax = 0.2\nreturn tax\n" },
      ],
      AbortSignal.timeout(60_000),
    );

    expect(result.files["f0_h0.js"]).toMatchObject({ formatted: "var total = 0;\n", diagnostics: [expect.objectContaining({ ruleId: "eslint/no-var" })] });
    expect(result.files["f1_h0.py"]).toMatchObject({ formatted: "def f(a):\n    return a == None\n", diagnostics: [expect.objectContaining({ ruleId: "ruff/E711" })] });
    expect(result.files["f2_h0.js"]?.parseError).toBeUndefined();
    expect(result.files["f3_h0.js"]).toMatchObject({ diagnostics: [expect.objectContaining({ ruleId: "eslint/no-var" })] });
    expect(result.files["f3_h0.js"]?.parseError).toBeUndefined();
    expect(await sandbox.health()).toBe("ok");
  }, 90_000);
});
