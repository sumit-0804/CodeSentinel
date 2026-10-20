# Style Agent for hosts with no Docker engine (Render): the linters run in process
# (SANDBOX_MODE=process). Build from the repo root: docker build -f services/style-agent/Dockerfile .
FROM node:20-slim AS base

FROM base AS prune
WORKDIR /repo
RUN npm install -g turbo@2.11.7
COPY . .
RUN turbo prune @code-sentinel/style-agent --docker

FROM base AS build
WORKDIR /repo
COPY --from=prune /repo/out/json/ ./
RUN npm ci --no-audit --no-fund
COPY --from=prune /repo/out/full/ ./
COPY tsconfig.base.json ./
RUN npx turbo run build --filter=@code-sentinel/style-agent && npm prune --omit=dev --no-audit --no-fund

FROM base
# Same pinned tools as sandbox/Dockerfile.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip \
 && pip3 install --no-cache-dir --break-system-packages ruff==0.16.9 black==26.5.1 \
 && apt-get purge -y python3-pip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/lint
COPY services/style-agent/sandbox/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY services/style-agent/sandbox/eslint.config.mjs services/style-agent/sandbox/ruff.toml services/style-agent/sandbox/run.mjs ./
# Per-request folders go in /opt/lint/work, inside ESLint's base path.
RUN mkdir work && chown node:node work

WORKDIR /repo
COPY --from=build --chown=node:node /repo ./
ENV NODE_ENV=production SANDBOX_MODE=process LINT_ROOT=/opt/lint NPM_CONFIG_UPDATE_NOTIFIER=false
USER node
CMD ["node", "services/style-agent/dist/server.js"]
