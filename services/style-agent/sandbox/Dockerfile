# Style Agent sandbox (FR-STY-02): ESLint + Prettier for JS/TS, Ruff + Black for Python, pinned.
# The agent runs one container per review request, with no network and a read-only filesystem.
FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip \
 && pip3 install --no-cache-dir --break-system-packages ruff==0.16.9 black==26.5.1 \
 && apt-get purge -y python3-pip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/lint
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY eslint.config.mjs ruff.toml run.mjs ./

# Files to check are mounted read-only at /opt/lint/work, inside ESLint's base path.
ENV RUFF_NO_CACHE=true BLACK_CACHE_DIR=/tmp/black NODE_ENV=production
USER node
ENTRYPOINT ["node", "/opt/lint/run.mjs"]
