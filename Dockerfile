# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build
ENV NODE_ENV=development
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
COPY web ./web
RUN npm run build

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS production-dependencies
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DATA_DIR=/app/data \
    DEMO_MODE=false
LABEL org.opencontainers.image.title="OrderFlow Event Platform" \
      org.opencontainers.image.description="Event-driven order, inventory, payment, retry, and DLQ demonstration platform" \
      org.opencontainers.image.source="https://github.com/TarunT27/orderflow-event-platform"
WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 4000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "const port=process.env.PORT||4000;fetch('http://127.0.0.1:'+port+'/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server/start.js"]
