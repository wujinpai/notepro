# NotePro 多用户笔记广场 —— 单镜像（Node 24，node:sqlite）
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.app.json tsconfig.server.json vite.config.ts index.html ./
COPY server ./server
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data
ENV STORAGE_DIR=/app/storage
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data /app/storage/images
EXPOSE 3001
VOLUME ["/app/data", "/app/storage"]
CMD ["node", "dist/server/index.js"]
