FROM node:22-alpine
RUN corepack enable
WORKDIR /app

# Install deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/cli/package.json packages/cli/
COPY packages/sdk/package.json packages/sdk/
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm --filter web build
RUN pnpm --filter server build

# Move web build to where serveStatic expects it
RUN cp -r packages/web/dist public
# Copy migrations to where the built migrate.ts expects them
RUN mkdir -p packages/server/dist/db/migrations && cp packages/server/src/db/migrations/*.sql packages/server/dist/db/migrations/ 2>/dev/null; \
    mkdir -p packages/server/dist/migrations && cp packages/server/src/db/migrations/*.sql packages/server/dist/migrations/ 2>/dev/null; \
    true

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
