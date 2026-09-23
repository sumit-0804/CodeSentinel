import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HealthStatus } from "@code-sentinel/contracts";
import { z } from "zod";

export interface SandboxFile {
  /** Flat file name inside the sandbox, e.g. `f0_h1.ts`; the extension picks the tools. */
  name: string;
  content: string;
}

const SandboxResultSchema = z.object({
  files: z.record(
    z.object({
      diagnostics: z.array(
        z.object({
          line: z.number().int(),
          column: z.number().int(),
          ruleId: z.string(),
          message: z.string(),
          fixable: z.boolean(),
        }),
      ),
      formatted: z.string().optional(),
      parseError: z.string().optional(),
    }),
  ),
});
export type SandboxResult = z.infer<typeof SandboxResultSchema>;
export type SandboxFileResult = SandboxResult["files"][string];

export interface Sandbox {
  run(files: SandboxFile[], signal: AbortSignal): Promise<SandboxResult>;
  health(): Promise<HealthStatus>;
}

export interface DockerSandboxOptions {
  image: string;
  memory?: string;
  cpus?: string;
  pidsLimit?: number;
  /** Cap when the request sets no deadline. */
  timeoutMs?: number;
}

export const DEFAULT_SANDBOX_IMAGE = "code-sentinel/style-sandbox:1";

/**
 * `DockerSandbox` from `class_agent.mmd` (FR-STY-02): every request runs in a fresh container with
 * no network, a read-only root, capped memory, CPU and processes, and no Linux capabilities. The
 * files are mounted read-only; the container is removed afterwards and killed at the deadline.
 */
export class DockerSandbox implements Sandbox {
  private readonly options: Required<DockerSandboxOptions>;

  constructor(options: DockerSandboxOptions) {
    this.options = { memory: "512m", cpus: "1", pidsLimit: 128, timeoutMs: 60_000, ...options };
  }

  async run(files: SandboxFile[], signal: AbortSignal): Promise<SandboxResult> {
    const dir = await mkdtemp(join(tmpdir(), "style-sandbox-"));
    const name = `style-sandbox-${randomUUID()}`;
    try {
      await Promise.all(files.map((file) => writeFile(join(dir, file.name), file.content, "utf8")));
      const stdout = await docker(
        [
          "run", "--rm", "--name", name,
          "--network", "none",
          "--read-only",
          "--memory", this.options.memory,
          "--cpus", this.options.cpus,
          "--pids-limit", String(this.options.pidsLimit),
          "--cap-drop", "ALL",
          "--security-opt", "no-new-privileges",
          "--tmpfs", "/tmp:rw,size=64m",
          "--mount", `type=bind,source=${dir},target=/opt/lint/work,readonly`,
          this.options.image,
        ],
        AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)]),
      ).catch(async (error: unknown) => {
        // Killing the docker CLI does not stop the container, so stop it by name.
        if (isAbort(error)) await docker(["kill", name], AbortSignal.timeout(10_000)).catch(() => undefined);
        throw error;
      });
      return SandboxResultSchema.parse(JSON.parse(stdout));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async health(): Promise<HealthStatus> {
    try {
      await docker(["image", "inspect", "--format", "{{.Id}}", this.options.image], AbortSignal.timeout(5_000));
      return "ok";
    } catch {
      return "unavailable";
    }
  }
}

/** `execFile`, never a shell, so no file name or option is ever interpreted. */
function docker(args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { signal, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr: String(stderr).slice(0, 2000) }));
        return;
      }
      resolve(stdout);
    });
  });
}

export function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
