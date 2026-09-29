# ERP 生产镜像（豆包/任意支持 Docker 的平台）
# 构建/启动完全自控，规避 lark-cli、脚本契约等不确定因素。
FROM node:20-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build:prod
# 剥离仅构建期需要的 dev 依赖，缩小镜像
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS run
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production
# 必填环境变量（运行时通过 -e 或平台「环境变量」注入）：
#   SUDA_DATABASE_URL       云端可达的 PostgreSQL 连接串（不可用 localhost）
#   FORCE_AUTHN_INNERAPI_DOMAIN  任意可达 URL 占位，如 https://placeholder.local
EXPOSE 3000
WORKDIR /app/dist
CMD ["node", "server/main.js"]
