import type { ChangedFile } from "@code-sentinel/contracts";
import { describe, expect, it } from "vitest";

import { relatedFileGroups } from "./related-files.js";

function changed(path: string, content: string, language: ChangedFile["language"] = path.endsWith(".py") ? "python" : "typescript"): ChangedFile {
  return { path, language, changeType: "modified", patch: "@@ -1 +1 @@\n+x\n", content };
}

const paths = (files: ChangedFile[]) => relatedFileGroups(files).map((group) => group.map((i) => files[i]!.path));

describe("relatedFileGroups", () => {
  it("links JS/TS files through relative imports, index files and ESM .js specifiers", () => {
    const files = [
      changed("src/api.ts", 'import { load } from "./utils.js";\nexport const x = load();\n'),
      changed("src/utils.ts", "export function load() {}\n"),
      changed("src/routes/home.tsx", 'import { api } from "../lib";\n'),
      changed("src/lib/index.ts", "export const api = 1;\n"),
      changed("src/other.ts", "export const y = 2;\n"),
    ];

    expect(paths(files)).toEqual([["src/api.ts", "src/utils.ts"], ["src/routes/home.tsx", "src/lib/index.ts"], ["src/other.ts"]]);
  });

  it("links require(), dynamic import() and @/ path aliases", () => {
    const files = [
      changed("web/a.js", 'const b = require("./b");\n', "javascript"),
      changed("web/b.js", "module.exports = {};\n", "javascript"),
      changed("apps/dash/page.tsx", 'const m = await import("./modal");\nimport { cn } from "@/lib/utils";\n'),
      changed("apps/dash/modal.tsx", "export default 1;\n"),
      changed("apps/dash/lib/utils.ts", "export const cn = 1;\n"),
    ];

    expect(paths(files)).toEqual([["web/a.js", "web/b.js"], ["apps/dash/page.tsx", "apps/dash/modal.tsx", "apps/dash/lib/utils.ts"]]);
  });

  it("links Python absolute, relative and submodule imports", () => {
    const files = [
      changed("app/views.py", "from app.utils import get_user\n"),
      changed("app/utils.py", "def get_user(id):\n    return None\n"),
      changed("app/api/routes.py", "from ..models import Order\nfrom . import serializers\n"),
      changed("app/models.py", "class Order: pass\n"),
      changed("app/api/serializers.py", "x = 1\n"),
      changed("scripts/run.py", "import os\nimport json\n"),
    ];

    expect(paths(files)).toEqual([
      ["app/views.py", "app/utils.py"],
      ["app/api/routes.py", "app/models.py", "app/api/serializers.py"],
      ["scripts/run.py"],
    ]);
  });

  it("does not link an ambiguous module name, and reads added lines when the whole file is missing", () => {
    const files: ChangedFile[] = [
      changed("svc/a/main.py", "from utils import helper\n"),
      changed("svc/a/x/utils.py", "def helper(): pass\n"),
      changed("svc/b/y/utils.py", "def helper(): pass\n"),
      { path: "lib/api.ts", language: "typescript", changeType: "modified", patch: '@@ -1,1 +1,2 @@\n x\n+import { f } from "./f";\n' },
      changed("lib/f.ts", "export const f = 1;\n"),
    ];

    expect(paths(files)).toEqual([["svc/a/main.py"], ["svc/a/x/utils.py"], ["svc/b/y/utils.py"], ["lib/api.ts", "lib/f.ts"]]);
  });
});
