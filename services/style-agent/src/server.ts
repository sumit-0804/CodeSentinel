import { fileURLToPath } from "node:url";

import { startAgentService } from "@code-sentinel/agent-kit";
import { loadEnvFile } from "@code-sentinel/service-kit";

import { createStyleAgent } from "./agent.js";
import { DEFAULT_SANDBOX_IMAGE, DockerSandbox, ProcessSandbox, type Sandbox } from "./sandbox.js";

const serviceDir = fileURLToPath(new URL("..", import.meta.url));
const { env } = loadEnvFile(serviceDir);

function createSandbox(): Sandbox {
  const mode = env.SANDBOX_MODE?.trim() || "docker";
  if (mode === "process") return new ProcessSandbox({ root: env.LINT_ROOT?.trim() || "/opt/lint" });
  if (mode !== "docker") throw new Error(`SANDBOX_MODE must be "docker" or "process", got "${mode}"`);
  return new DockerSandbox({ image: env.STYLE_SANDBOX_IMAGE?.trim() || DEFAULT_SANDBOX_IMAGE });
}

const sandbox = createSandbox();

startAgentService(createStyleAgent(sandbox), { defaultPort: 8082, serviceDir });
