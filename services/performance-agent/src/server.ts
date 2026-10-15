import { fileURLToPath } from "node:url";

import { startAgentService } from "@code-sentinel/agent-kit";

import { performanceAgent } from "./agent.js";

startAgentService(performanceAgent, { defaultPort: 8083, serviceDir: fileURLToPath(new URL("..", import.meta.url)) });
