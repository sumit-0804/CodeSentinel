import { fileURLToPath } from "node:url";

import { startAgentService } from "@code-sentinel/agent-kit";
import { loadEnvFile } from "@code-sentinel/service-kit";

import { createStyleAgent } from "./agent.js";
import { DEFAULT_SANDBOX_IMAGE, DockerSandbox } from "./sandbox.js";

const serviceDir = fileURLToPath(new URL("..", import.meta.url));
const { env } = loadEnvFile(serviceDir);
const sandbox = new DockerSandbox({ image: env.STYLE_SANDBOX_IMAGE?.trim() || DEFAULT_SANDBOX_IMAGE });

startAgentService(createStyleAgent(sandbox), { defaultPort: 8082, serviceDir });
