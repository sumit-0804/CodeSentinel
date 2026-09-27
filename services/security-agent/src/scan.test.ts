import { describe, expect, it } from "vitest";

import type { ChangedFile, Language } from "@code-sentinel/contracts";
import { scanFile } from "./scan.js";

/** One added line at new-side line 10. */
function added(line: string, language: Language = "python"): ChangedFile {
  return { path: language === "python" ? "app.py" : "app.ts", language, changeType: "modified", patch: `@@ -9,1 +9,2 @@\n context()\n+${line}` };
}

const rulesOn = (line: string, language: Language = "python") => scanFile(added(line, language)).map((finding) => finding.ruleId);

describe("scanFile code rules", () => {
  it.each<[string, Language, string]>([
    ['cur.execute(f"SELECT * FROM users WHERE id = {uid}")', "python", "security/sql-injection"],
    ['cur.execute("SELECT * FROM t WHERE a = %s" % a)', "python", "security/sql-injection"],
    ["db.query(`SELECT * FROM users WHERE id = ${id}`)", "typescript", "security/sql-injection"],
    ['subprocess.run(cmd, shell=True)', "python", "security/command-injection"],
    ["os.system('rm ' + path)", "python", "security/command-injection"],
    ["exec(`ls ${dir}`, cb)", "javascript", "security/command-injection"],
    ["data = pickle.loads(blob)", "python", "security/insecure-deserialization"],
    ["cfg = yaml.load(stream)", "python", "security/insecure-deserialization"],
    ["const obj = unserialize(body)", "javascript", "security/insecure-deserialization"],
    ["result = eval(expr)", "python", "security/code-injection"],
    ["const fn = new Function(src)", "javascript", "security/code-injection"],
    ["el.innerHTML = comment.text", "typescript", "security/xss"],
    ["<div dangerouslySetInnerHTML={{ __html: bio }} />", "typescript", "security/xss"],
    ["return mark_safe(request.GET['name'])", "python", "security/xss"],
    ["f = open(request.args['file'])", "python", "security/path-traversal"],
    ["res.sendFile(path.join(root, req.params.name))", "javascript", "security/path-traversal"],
  ])("flags %s", (line, language, ruleId) => {
    expect(rulesOn(line, language)).toContain(ruleId);
  });

  it.each<[string, Language]>([
    ['cur.execute("SELECT * FROM users WHERE id = %s", (uid,))', "python"],
    ["db.query('SELECT * FROM users WHERE id = $1', [id])", "typescript"],
    ['subprocess.run(["ls", path])', "python"],
    ["execFile('ls', [dir])", "javascript"],
    ["cfg = yaml.load(stream, Loader=yaml.SafeLoader)", "python"],
    ["cfg = yaml.safe_load(stream)", "python"],
    ["model.eval()", "python"],
    ["el.textContent = comment.text", "typescript"],
    ["if (el.innerHTML === '') {}", "typescript"],
    ["f = open('settings.json')", "python"],
    ["# cur.execute(f\"SELECT {x}\")  old code", "python"],
    ["// el.innerHTML = x", "typescript"],
  ])("does not flag %s", (line, language) => {
    expect(rulesOn(line, language)).toEqual([]);
  });

  it("applies code rules only to their own language and reports on the added line", () => {
    expect(rulesOn("el.innerHTML = x", "python")).toEqual([]);
    const [finding] = scanFile(added('cur.execute(f"SELECT {x}")'));
    expect(finding).toMatchObject({ location: { filePath: "app.py", lineStart: 10, lineEnd: 10 }, cweId: "CWE-89", severity: "critical" });
  });
});

describe("scanFile secrets", () => {
  it.each([
    ["aws_key = 'AKIAIOSFODNN7EXAMPLE'", "security/secret-aws-access-key"],
    ["token = 'ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'", "security/secret-github-token"],
    ["key = 'AIza" + "SyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY'", "security/secret-google-api-key"],
    ["-----BEGIN RSA PRIVATE KEY-----", "security/secret-private-key"],
    ["DB_PASSWORD = 'q8#Lz2!vR9xT'", "security/secret-hardcoded-credential"],
  ])("flags %s, in any file type, and masks the value", (line, ruleId) => {
    const findings = scanFile({ path: "config/settings.yaml", language: "unknown", changeType: "added", patch: `@@ -0,0 +1 @@\n+${line}` });

    expect(findings.map((finding) => finding.ruleId)).toEqual([ruleId]);
    expect(findings[0]).toMatchObject({ severity: "critical", cweId: "CWE-798" });
    const secret = /['"]([^'"]{8,})['"]/.exec(line)?.[1];
    if (secret) expect(JSON.stringify(findings[0])).not.toContain(secret);
  });

  it("ignores placeholders, environment lookups and low-entropy words", () => {
    for (const line of ["password = 'changeme123'", "api_key = os.environ['API_KEY']", "secret = '${SECRET}'", "password = 'aaaaaaaaaaaa'"]) {
      expect(rulesOn(line)).toEqual([]);
    }
  });

  it("still flags a secret on a comment line", () => {
    expect(rulesOn("# old key AKIAIOSFODNN7EXAMPLE")).toEqual(["security/secret-aws-access-key"]);
  });
});

describe("scanFile secret wording", () => {
  it("names the secret type with a masked prefix", () => {
    const [finding] = scanFile({ path: "app.py", language: "python", changeType: "modified", patch: "@@ -1 +1 @@\n+key = 'AKIAIOSFODNN7EXAMPLE'" });

    expect(finding?.description).toBe("AWS access key (AKIA****) is hardcoded. Revoke it, then load it from the environment or a secret manager.");
  });
});
