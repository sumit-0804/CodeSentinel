/** One line of a hunk's new side, numbered as in the file after the change. */
export interface NewLine {
  line: number;
  text: string;
  /** True for a `+` line, false for unchanged context. */
  added: boolean;
}

export interface Hunk {
  /** First new-side line number from the `@@ -a,b +c,d @@` header. */
  newStart: number;
  /** Context and added lines, in order; removed lines are left out. */
  lines: NewLine[];
}

export interface ParsedPatch {
  hunks: Hunk[];
  /** Every added line across all hunks. Agents report findings on these only. */
  addedLines: NewLine[];
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Reads a unified diff for one file (`ChangedFile.patch`). Agents never see whole files (NFR-06),
 * so each hunk's new side is the only code they can analyze.
 */
export function parsePatch(patch: string): ParsedPatch {
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;
  let next = 0;

  const rows = patch.split("\n");
  rows.forEach((raw, index) => {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const header = HUNK_HEADER.exec(text);
    if (header) {
      next = Number(header[1]);
      current = { newStart: next, lines: [] };
      hunks.push(current);
      return;
    }
    // Lines before the first hunk are file headers (`diff --git`, `---`, `+++`).
    if (!current) return;
    if (text.startsWith("+")) current.lines.push({ line: next++, text: text.slice(1), added: true });
    else if (text.startsWith(" ")) current.lines.push({ line: next++, text: text.slice(1), added: false });
    // Some tools strip the space off a blank context line; the patch's trailing newline is not a line.
    else if (text === "" && index < rows.length - 1) current.lines.push({ line: next++, text: "", added: false });
    // `-` lines exist only on the old side; `\ No newline at end of file` is a marker, not code.
  });

  return { hunks, addedLines: hunks.flatMap((hunk) => hunk.lines.filter((line) => line.added)) };
}

/** A hunk's new side as source text, e.g. to hand to a linter. */
export function hunkText(hunk: Hunk): string {
  return hunk.lines.map((line) => line.text).join("\n");
}
