# One image per service: docker build --build-arg SERVICE=gateway .
# The style-agent has its own Dockerfile (it also needs the linters).
FROM node:22-slim AS base
# Prisma's migrate engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

FROM base AS prune
ARG SERVICE
RUN test -n "$SERVICE" || (echo "Set --build-arg SERVICE=<service>" && exit 1)
WORKDIR /repo
RUN npm install -g turbo@2.11.7
COPY . .
RUN turbo prune @code-sentinel/${SERVICE} --docker

FROM base AS build
ARG SERVICE
WORKDIR /repo
COPY --from=prune /repo/out/json/ ./
RUN npm ci --no-audit --no-fund
COPY --from=prune /repo/out/full/ ./
# `turbo prune` keeps workspaces only; every tsconfig extends the root one.
COPY tsconfig.base.json ./
RUN npx turbo run build --filter=@code-sentinel/${SERVICE} && npm prune --omit=dev --no-audit --no-fund

FROM base
ARG SERVICE
ENV NODE_ENV=production SERVICE=${SERVICE} NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /repo
COPY --from=build --chown=node:node /repo ./
USER node
CMD ["sh", "-c", "exec node services/$SERVICE/dist/server.js"]
