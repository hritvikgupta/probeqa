# Multi-stage build for probe-app on Fly.io (app.probeqa.com).
#
# Stage 1 (deps)    — install full npm deps so vite + tsc + tsx are available
# Stage 2 (builder) — build the Vite SPA into dist/
# Stage 3 (runner)  — runtime image: dist/ + server source + prod node_modules,
#                     served by tsx with SERVE_STATIC=1 so /api and the SPA
#                     share one origin.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV SERVE_STATIC=1

# Drop dev-only packages to shrink the runtime image, then add tsx (used to
# execute the TypeScript server entry point without a separate compile step).
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm install tsx --no-save

# Playwright runs the testing browser. The Chromium download lives in the
# runtime image so the agent has it on cold start.
RUN npx playwright install --with-deps chromium

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server

EXPOSE 8080
CMD ["npx", "tsx", "server/index.ts"]
