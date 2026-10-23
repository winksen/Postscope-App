# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

ARG APP_VERSION=0.1.28

LABEL org.opencontainers.image.title="PostScope"
LABEL org.opencontainers.image.description="Offline-capable Postman collection analyzer"
LABEL org.opencontainers.image.version="${APP_VERSION}"

ENV NODE_ENV=production
ENV PORT=3010
ENV LOGGING_MODE=off
ENV PUBLIC_LANDING_PAGE=false
ENV APP_VERSION=${APP_VERSION}
ENV DATA_DIR=/app/data

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server ./server
# The server shares the analysis engine (redaction, rule policy) with the browser bundle.
COPY --chown=node:node src/lib ./src/lib
COPY --chown=node:node src/types ./src/types

# Run as the unprivileged `node` user; the data volume must be writable by uid 1000.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3010
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3010)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run node directly (not via npm) so SIGTERM reaches the server for a graceful shutdown.
CMD ["node", "--import", "tsx", "server/index.ts"]
