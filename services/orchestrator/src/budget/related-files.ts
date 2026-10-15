import type { ChangedFile } from "@code-sentinel/contracts";

const JS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']((?:\.{1,2}|[@~])\/[^"']+)["']/g;
const JS_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const JS_EXTENSION = /\.(?:[mc]?js|jsx)$/;
// One line each: a `\s` here would run on into the next statement.
const PY_FROM = /^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+([\w \t,()*]+)/gm;
const PY_IMPORT = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm;

/**
 * Splits a pull request's changed files into groups linked by imports between them, so a change
 * and the changed code it uses are reviewed in one LLM call. Returns groups of indices into
 * `files`, in order of each group's first file; a file with no links is a group of one.
 */
export function relatedFileGroups(files: readonly ChangedFile[]): number[][] {
  const index = new Map(files.map((file, i) => [normalize(file.path), i]));
  const parent = files.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));

  files.forEach((file, i) => {
    for (const target of importedPaths(file)) {
      const j = resolve(target, index);
      if (j !== undefined && j !== i) parent[find(i)] = find(j);
    }
  });

  const groups = new Map<number, number[]>();
  files.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });
  return [...groups.values()];
}

/** Candidate repository paths a file imports; only relative JS imports and Python modules can name a changed file. */
export function importedPaths(file: ChangedFile): string[][] {
  const text = file.content ?? addedText(file.patch);
  const dir = normalize(file.path).split("/").slice(0, -1);
  if (file.language === "python") return pythonImports(text, dir);
  if (file.language === "javascript" || file.language === "typescript") {
    return [...text.matchAll(JS_IMPORT)].map((match) => {
      const specifier = match[1]!;
      // `@/lib/x` and `~/lib/x` are path aliases: matched by suffix, since the alias root is unknown.
      const alias = /^[@~]\//.test(specifier);
      const base = alias ? specifier.slice(2) : join(dir, specifier);
      // ESM TypeScript imports `./x.js` for `x.ts`.
      const stems = JS_EXTENSION.test(base) ? [base, base.replace(JS_EXTENSION, "")] : [base];
      const candidates = stems.flatMap((stem) => [...JS_EXTENSIONS.map((ext) => stem + ext), ...JS_EXTENSIONS.slice(1).map((ext) => `${stem}/index${ext}`)]);
      return alias ? candidates.map((candidate) => `*/${candidate}`) : candidates;
    });
  }
  return [];
}

function pythonImports(text: string, dir: string[]): string[][] {
  const modules: { dots: number; name: string }[] = [];
  for (const match of text.matchAll(PY_FROM)) {
    const dots = match[1]!.length;
    const base = match[2]!;
    if (base) modules.push({ dots, name: base });
    // `from pkg import mod` may name a submodule as well as a symbol.
    for (const item of match[3]!.replace(/[()]/g, "").split(",")) {
      const name = item.trim().split(/\s+/)[0];
      if (name && name !== "*") modules.push({ dots, name: base ? `${base}.${name}` : name });
    }
  }
  for (const match of text.matchAll(PY_IMPORT)) {
    for (const name of match[1]!.split(",")) modules.push({ dots: 0, name: name.trim() });
  }
  return modules.map(({ dots, name }) => {
    const parts = name.split(".").filter(Boolean);
    // Relative imports start from the file's package; absolute ones match by path suffix.
    const prefix = dots > 0 ? dir.slice(0, dir.length - (dots - 1)) : [];
    const path = [...prefix, ...parts].join("/");
    const candidates = [`${path}.py`, `${path}/__init__.py`];
    return dots > 0 ? candidates : candidates.map((candidate) => `*/${candidate}`);
  });
}

// The changed file a candidate list names; a "*/" prefix matches the rest at the root or under any folder.
function resolve(candidates: string[], index: Map<string, number>): number | undefined {
  for (const candidate of candidates) {
    if (!candidate.startsWith("*/")) {
      const hit = index.get(candidate);
      if (hit !== undefined) return hit;
      continue;
    }
    const suffix = candidate.slice(2);
    const exact = index.get(suffix);
    if (exact !== undefined) return exact;
    const matches = [...index.entries()].filter(([path]) => path.endsWith(`/${suffix}`));
    // Two files ending the same way are ambiguous; linking either could join unrelated code.
    if (matches.length === 1) return matches[0]![1];
  }
  return undefined;
}

function addedText(patch: string): string {
  return patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

function join(dir: string[], relative: string): string {
  const parts = [...dir];
  for (const part of relative.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}
