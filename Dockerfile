# ---- 构建阶段 ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . .
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 运行阶段 ----
FROM node:22-alpine AS runner
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/Lemonadepu21/putv"
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
ENV SQLITE_PATH=/app/data/putv.sqlite

# 非 root 用户
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 nextjs -G nodejs \
    && mkdir -p /app/data && chown nextjs:nodejs /app/data && chmod 700 /app/data

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/LICENSE ./LICENSE
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts/create-admin.ts ./scripts/create-admin.ts
COPY --from=builder /app/src/server/database.ts /app/src/server/identity.ts ./src/server/
COPY --from=builder /app/node_modules/server-only ./node_modules/server-only

VOLUME ["/app/data"]

USER nextjs

EXPOSE 8080
CMD ["node", "server.js"]
