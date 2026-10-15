import { fileURLToPath } from "node:url";

import { startAgentService } from "@code-sentinel/agent-kit";

import { documentationAgent } from "./agent.js";

startAgentService(documentationAgent, { defaultPort: 8085, serviceDir: fileURLToPath(new URL("..", import.meta.url)) });
