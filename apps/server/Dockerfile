# ------------------------------------------------------------
# web-monitor 服务端镜像
# 多阶段构建：依赖安装 -> 构建 -> 运行（仅保留生产依赖，镜像更小）
# ------------------------------------------------------------
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/types/package.json packages/types/package.json
RUN pnpm install --frozen-lockfile --filter @web-monitor/server... || pnpm install --filter @web-monitor/server...

FROM deps AS build
COPY . .
RUN pnpm --filter @web-monitor/types build \
 && pnpm --filter @web-monitor/server exec prisma generate \
 && pnpm --filter @web-monitor/server build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/prisma ./apps/server/prisma
WORKDIR /app/apps/server

EXPOSE 8787
CMD ["node", "dist/main.js"]
