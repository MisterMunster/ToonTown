# syntax=docker/dockerfile:1
#
# Toon Town - two-stage image:
#   1. build:   install everything, `vite build` + precompress into /app/dist
#   2. runtime: Node + Express + dist only, running as the unprivileged "node" user
#
#   docker build -t toon-town .
#   docker run --rm -p 8080:8080 -e GAME_PASSWORD=sunny-otter-42 toon-town

# ---------- 1. build the static game ----------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

# Dependencies first so this layer is cached until package*.json change.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---------- 2. small runtime image ------------------------------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

# Production dependencies only. Babylon.js and the font are already bundled
# into dist/ by Vite, so the server needs nothing but Express: drop the
# client-only packages (~100 MB), npm's cache, and npm/corepack themselves
# (the container runs `node` directly, never npm).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && rm -rf node_modules/@babylonjs node_modules/@fontsource \
 && npm cache clean --force \
 && rm -rf /root/.npm /tmp/* \
      /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Root-owned and read-only for the app user: the server can't modify itself.
COPY --from=build /app/dist ./dist
COPY server ./server

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-8080}/healthz" || exit 1

CMD ["node", "server/server.js"]
