# syntax=docker/dockerfile:1

FROM node:25-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
# Web bundle (dist/) and the compiled server and CLI (dist-node/).
RUN npm run build && npm run build:node

FROM node:25-alpine AS runtime
WORKDIR /app

ARG APP_VERSION=0.3.12

LABEL org.opencontainers.image.title="PostScope"
LABEL org.opencontainers.image.description="Offline-capable Postman collection analyzer"
LABEL org.opencontainers.image.version="${APP_VERSION}"

ENV NODE_ENV=production
ENV PORT=3010
ENV LOGGING_MODE=off
ENV PUBLIC_LANDING_PAGE=false
ENV APP_VERSION=${APP_VERSION}
ENV DATA_DIR=/app/data

# The compiled server and CLI bundle everything they import, so the image needs no node_modules, no tsx and
# no TypeScript sources: just the web bundle, two JavaScript files and package.json (version and module type).
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-node ./dist-node
COPY --chown=node:node package.json ./

# Run as the unprivileged `node` user; the data volume must be writable by uid 1000.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3010
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3010)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run node directly (not via npm) so SIGTERM reaches the server for a graceful shutdown.
CMD ["node", "dist-node/server.js"]
