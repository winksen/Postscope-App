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

ARG APP_VERSION=0.0.1

LABEL org.opencontainers.image.title="PostScope"
LABEL org.opencontainers.image.description="Offline-capable Postman collection analyzer"
LABEL org.opencontainers.image.version="${APP_VERSION}"

ENV NODE_ENV=production
ENV PORT=3010
ENV LOGGING_MODE=off
ENV PUBLIC_LANDING_PAGE=false
ENV APP_VERSION=${APP_VERSION}

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json ./
COPY server ./server

EXPOSE 3010
VOLUME ["/app/data"]

CMD ["npm", "run", "start"]
