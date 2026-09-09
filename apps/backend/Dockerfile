FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY apps/backend/package*.json ./
RUN npm ci
COPY apps/backend/ ./
RUN npm run build && npm prune --omit=dev
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --chown=node:node apps/backend/scripts/migrate.cjs ./scripts/migrate.cjs
USER node
CMD ["node", "dist/main.js"]
