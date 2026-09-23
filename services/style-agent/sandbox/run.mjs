// Runs inside the sandbox: lints and formats every file in /opt/lint/work, prints one JSON result.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ESLint } from "eslint";
import * as prettier from "prettier";

const ROOT = "/opt/lint";
const WORK = join(ROOT, "work");
const JS = /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;
const PY = /\.py$/;

const names = readdirSync(WORK).sort();
const files = Object.fromEntries(names.map((name) => [name, { diagnostics: [] }]));
const text = (name) => readFileSync(join(WORK, name), "utf8");

// A hunk from inside a function has a bare `return`; CommonJS mode allows it, module mode does not.
const RETURN_OUTSIDE = /'return' outside of function/;

async function lint(jsNames) {
  const results = await new ESLint({ cwd: ROOT }).lintFiles(jsNames.map((name) => join("work", name)));
  const retry = results.filter((result) => result.messages.some((m) => m.fatal && RETURN_OUTSIDE.test(m.message)));
  if (!retry.length) return results;
  const commonjs = new ESLint({ cwd: ROOT, overrideConfig: { languageOptions: { sourceType: "commonjs" } } });
  const retried = new Map((await commonjs.lintFiles(retry.map((r) => r.filePath))).map((r) => [r.filePath, r]));
  return results.map((result) => retried.get(result.filePath) ?? result);
}

async function checkJs(jsNames) {
  if (!jsNames.length) return;
  for (const result of await lint(jsNames)) {
    const name = result.filePath.split(/[\\/]/).pop();
    for (const message of result.messages) {
      if (message.fatal || !message.ruleId) {
        files[name].parseError = message.message;
        continue;
      }
      files[name].diagnostics.push({
        line: message.line,
        column: message.column,
        ruleId: `eslint/${message.ruleId}`,
        message: message.message,
        fixable: Boolean(message.fix),
      });
    }
  }
  for (const name of jsNames) {
    try {
      files[name].formatted = await prettier.format(text(name), { filepath: join(WORK, name) });
    } catch (error) {
      files[name].parseError ??= String(error.message ?? error).split("\n")[0];
    }
  }
}

function checkPy(pyNames) {
  if (!pyNames.length) return;
  const ruff = spawnSync("ruff", ["check", "--output-format", "json", "--config", join(ROOT, "ruff.toml"), ...pyNames.map((n) => join(WORK, n))], {
    encoding: "utf8",
  });
  if (ruff.status !== 0 && ruff.status !== 1) throw new Error(`ruff failed: ${ruff.stderr}`);
  for (const item of JSON.parse(ruff.stdout || "[]")) {
    const name = item.filename.split(/[\\/]/).pop();
    if (!item.code || item.code === "E999" || /syntax/i.test(item.message)) {
      files[name].parseError = item.message;
      continue;
    }
    files[name].diagnostics.push({
      line: item.location.row,
      column: item.location.column,
      ruleId: `ruff/${item.code}`,
      message: item.message,
      fixable: Boolean(item.fix),
    });
  }
  for (const name of pyNames) {
    const black = spawnSync("black", ["--quiet", "--line-length", "100", "-"], { input: text(name), encoding: "utf8" });
    if (black.status === 0) files[name].formatted = black.stdout;
    else files[name].parseError ??= (black.stderr || "black could not parse the file").split("\n")[0];
  }
}

await checkJs(names.filter((name) => JS.test(name)));
checkPy(names.filter((name) => PY.test(name)));
process.stdout.write(JSON.stringify({ files }));
