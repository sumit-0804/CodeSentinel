import type { ChangedFile } from "@code-sentinel/contracts";
import type { Logger } from "@code-sentinel/service-kit";

import type { GitHubClient, RepositoryRef } from "../github/github-client.js";

export const DEFAULT_FILE_CONTENT_MAX_BYTES = 36_000;
const CONCURRENCY = 5;
/** GitHub expects the webhook's answer within 10 s, so fetching stops starting new files after this. */
const FETCH_BUDGET_MS = 4_000;

export interface AttachContentsInput {
  ref: RepositoryRef;
  headSha: string;
  files: ChangedFile[];
  maxBytes: number;
  logger: Logger;
  requestId: string;
  now?: () => number;
}

/**
 * Adds each changed file's full text at the head commit (`ChangedFile.content`), so agents read a
 * change in context. A deleted, oversized or unreadable file goes without it; this never throws.
 */
export async function attachFileContents(github: Pick<GitHubClient, "getFileContent">, input: AttachContentsInput): Promise<ChangedFile[]> {
  const { ref, headSha, files, maxBytes, logger, requestId } = input;
  const now = input.now ?? Date.now;
  const stopAt = now() + FETCH_BUDGET_MS;
  const result = files.map((file) => ({ ...file }));
  const pending = result.filter((file) => file.changeType !== "deleted");
  const missed = { oversized: 0, failed: 0, outOfTime: 0 };

  const worker = async () => {
    for (let file = pending.shift(); file; file = pending.shift()) {
      if (now() > stopAt) {
        missed.outOfTime += 1;
        continue;
      }
      try {
        const fetched = await github.getFileContent(ref, { path: file.path, gitRef: headSha });
        if (!fetched) missed.failed += 1;
        else if (Buffer.byteLength(fetched.text, "utf8") > maxBytes) missed.oversized += 1;
        else file.content = fetched.text;
      } catch (error) {
        missed.failed += 1;
        logger.warn("could not read a changed file; it is reviewed from its diff", { requestId, path: file.path, error });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const attached = result.filter((file) => file.content !== undefined).length;
  logger.info("changed files read", { requestId, attached, ...missed });
  return result;
}
