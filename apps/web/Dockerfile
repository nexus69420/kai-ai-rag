# syntax=docker/dockerfile:1

# ── deps ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

# ── build ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts || npm install --ignore-scripts
COPY . .
# Next collects page data at build time; the app must not need a DB to compile.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── tools ─────────────────────────────────────────────────────────────
# Same image shape as the build stage, used for one-shot jobs that need
# tsx and the eval/seed sources: `docker compose run --rm seed`.
FROM build AS tools
ENV NODE_ENV=development
CMD ["npx", "tsx", "scripts/seed.ts"]

# ── runtime ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup -S kai && adduser -S kai -G kai

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/eval ./eval

# PDF originals and the PGlite fallback both live here.
RUN mkdir -p /app/.data /app/uploads && chown -R kai:kai /app/.data /app/uploads
USER kai

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
