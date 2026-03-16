# Stage 1: Build frontend
FROM node:22-alpine AS web-build
WORKDIR /app
COPY package*.json ./
COPY packages/web/package*.json packages/web/
COPY packages/server/package*.json packages/server/
COPY packages/cli/package*.json packages/cli/
# Full install + explicit rollup platform binary for Alpine
RUN npm install && npm install @rollup/rollup-linux-x64-musl
COPY packages/web/ packages/web/
RUN npm run build --workspace=packages/web

# Stage 2: Production server
FROM node:22-alpine
RUN addgroup -S draw && adduser -S draw -G draw
WORKDIR /app
COPY package*.json ./
COPY packages/server/package*.json packages/server/
COPY packages/cli/package*.json packages/cli/
COPY packages/web/package*.json packages/web/
RUN npm install --omit=dev && chown -R draw:draw /app
COPY --chown=draw:draw packages/server/ packages/server/
COPY --chown=draw:draw --from=web-build /app/packages/web/dist packages/server/public
USER draw
EXPOSE 3900
CMD ["node", "packages/server/src/index.js"]
