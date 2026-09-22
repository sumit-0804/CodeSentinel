import { fileURLToPath } from "node:url";

import { startAgentService } from "@code-sentinel/agent-kit";

import { securityAgent } from "./agent.js";

startAgentService(securityAgent, { defaultPort: 8081, serviceDir: fileURLToPath(new URL("..", import.meta.url)) });
