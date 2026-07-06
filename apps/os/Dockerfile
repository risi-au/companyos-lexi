# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json tsconfig.json ./
COPY apps/os/package.json ./apps/os/package.json
COPY packages/api/package.json ./packages/api/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/mcp/package.json ./packages/mcp/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --filter @companyos/os... --filter @companyos/db

FROM deps AS install
COPY apps/os ./apps/os
COPY packages/api ./packages/api
COPY packages/db ./packages/db
COPY packages/mcp ./packages/mcp
COPY packages/ui ./packages/ui
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline --filter @companyos/os... --filter @companyos/db

FROM install AS build
# Build-time placeholders: Next.js "collecting page data" imports route modules, which
# assert these exist. Never present in the runtime images (separate FROM stages);
# real values come from the deploy environment.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
ENV BETTER_AUTH_SECRET="build-placeholder"
RUN pnpm --filter @companyos/os build

FROM deps AS migrate-install
COPY packages/db ./packages/db
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline --filter @companyos/db

FROM node:22-alpine AS os
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=build --chown=nextjs:nodejs /app/apps/os/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/os/.next/static ./apps/os/.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "apps/os/server.js"]

FROM node:22-alpine AS migrate
ENV NODE_ENV=production
WORKDIR /app/packages/db
COPY --from=migrate-install /app/node_modules /app/node_modules
COPY --from=migrate-install /app/packages/db ./
CMD ["node", "node_modules/drizzle-kit/bin.cjs", "migrate"]
