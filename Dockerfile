# Stage 1: Build server and frontend
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages/server/package*.json packages/server/
COPY packages/web/package*.json packages/web/
COPY packages/cli/package*.json packages/cli/
RUN npm install && npm install @rollup/rollup-linux-x64-musl
COPY . .
RUN npm run build --workspace=packages/server && npm run build --workspace=packages/web

# Stage 2: Production server
FROM node:22-alpine
RUN addgroup -S draw && adduser -S draw -G draw
WORKDIR /app
COPY package*.json ./
COPY packages/server/package*.json packages/server/
COPY packages/web/package*.json packages/web/
COPY packages/cli/package*.json packages/cli/
RUN npm install --omit=dev && chown -R draw:draw /app
COPY --chown=draw:draw --from=build /app/packages/server/dist packages/server/dist
COPY --chown=draw:draw --from=build /app/packages/web/dist packages/server/public
USER draw
EXPOSE 3900
CMD ["node", "packages/server/dist/index.js"]
