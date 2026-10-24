# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ARG VERSION=0.3.0
LABEL org.opencontainers.image.title="MailBeacon" \
      org.opencontainers.image.description="SMTP server that turns email alerts into Gotify, ntfy, Pushover, Discord, Slack, Telegram, Apprise and webhook notifications" \
      org.opencontainers.image.source="https://github.com/Nerdy-Technician/MailBeacon" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"
# Pull in Debian security updates newer than the base image.
RUN apt-get update && apt-get upgrade -y --no-install-recommends && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    MAILBEACON_DATA_DIR=/data \
    MAILBEACON_SMTP_PORT=2525 \
    MAILBEACON_WEB_PORT=8080
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
COPY package.json ./
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# drop npm/corepack from the runtime image; the app does not need them
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && mkdir -p /data && chown node:node /data
# Runs as "node" (uid 1000). Data volumes left owned by root by older versions:
# start once with --user 0 (the entrypoint then chowns /data and drops to node),
# or chown the volume to 1000:1000. See docker-entrypoint.sh.
USER node
VOLUME ["/data"]
EXPOSE 2525 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MAILBEACON_WEB_PORT||8080)+'/healthz?core=1').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
