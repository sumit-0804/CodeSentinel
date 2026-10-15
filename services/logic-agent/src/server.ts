import { fileURLToPath } from "node:url";

import { startAgentService } from "@code-sentinel/agent-kit";

import { logicAgent } from "./agent.js";

startAgentService(logicAgent, { defaultPort: 8084, serviceDir: fileURLToPath(new URL("..", import.meta.url)) });
