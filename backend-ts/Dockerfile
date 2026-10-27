# ========================================
# Stage 1: Builder
# ========================================
FROM node:20-slim AS builder

# 与仓库布局保持一致（构建上下文是仓库根）：backend-ts 的 preinstall/postinstall
# 用 ../scripts/xxx 引用仓库根脚本，只有保持 backend-ts 与 scripts 同级才能解析到
WORKDIR /repo/backend-ts

# Install build dependencies for native modules
RUN sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list 2>/dev/null; \
    apt-get update && apt-get install -y python3 make g++ libsqlite3-dev && rm -rf /var/lib/apt/lists/*

# 统一使用 pnpm：只有 pnpm 会应用 patches/ 下的 node-pty 补丁（npm ci 会静默冲掉补丁）
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

# Copy package files
COPY backend-ts/package.json backend-ts/pnpm-lock.yaml backend-ts/pnpm-workspace.yaml ./
COPY backend-ts/patches ./patches/
COPY scripts /repo/scripts/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY backend-ts/ .

# Build the application (remove tsbuildinfo to force full rebuild)
RUN rm -f tsconfig.tsbuildinfo && pnpm run build

# Remove devDependencies, keep production deps only.
# pnpm 的 .pnpm 布局自包含：原生模块及其兄弟依赖（sharp → @img/*）
# 都会随 node_modules 一起保留
RUN pnpm prune --prod



# ========================================
# Stage 2: Production
# ========================================
FROM node:20-slim AS production

WORKDIR /app

# Install runtime dependencies only (no build tools needed - better-sqlite3 uses prebuilt binaries)
RUN sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list 2>/dev/null; \
    apt-get update && apt-get install -y sqlite3 tini wget && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs nestjs

# Copy built application from builder stage
COPY --from=builder /repo/backend-ts/dist ./dist

# Copy package.json (运行时可能读取版本号等信息)
COPY backend-ts/package.json ./

# Copy the whole pruned node_modules from builder (自包含 pnpm 布局，含 .pnpm)
COPY --from=builder /repo/backend-ts/node_modules ./node_modules

# Remove unnecessary files from node_modules to reduce size
RUN find node_modules -type f \( \
        -name "*.d.ts" -o \
        -name "*.map" -o \
        -name "*.md" -o \
        -name "*.test.js" -o \
        -name "*.spec.js" -o \
        -name "*.test.ts" -o \
        -name "*.spec.ts" -o \
        -name ".eslintrc*" -o \
        -name ".prettierrc*" -o \
        -name "tsconfig.json" -o \
        -name "jest.config.*" \
    \) -delete 2>/dev/null || true && \
    find node_modules -type d \( \
        -name "docs" -o \
        -name "doc" -o \
        -name "examples" -o \
        -name "test" -o \
        -name "tests" -o \
        -name "__tests__" -o \
        -name "coverage" -o \
        -name ".github" \
    \) -exec rm -rf {} + 2>/dev/null || true

# Create necessary directories
RUN mkdir -p data/uploads data/compression-states logs static && \
    chown -R nestjs:nodejs /app

# Copy static files from builder
COPY --from=builder /repo/backend-ts/static ./static

# Copy bundled skills from builder (用于同步到 skills/.system/)
COPY --from=builder /repo/backend-ts/bundled-skills ./bundled-skills

# Copy bundled agents / providers from builder (内置助手模板 / 供应商类型目录；与 electron 包保持一致)
COPY --from=builder /repo/backend-ts/bundled-agents ./bundled-agents
COPY --from=builder /repo/backend-ts/bundled-providers ./bundled-providers


# Copy entrypoint script and convert line endings
COPY backend-ts/docker-entrypoint.sh /usr/local/bin/
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && \
    chmod +x /usr/local/bin/docker-entrypoint.sh

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 3000

# Health check - use a simple endpoint that doesn't require auth
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/settings/auto-login || exit 1

# Use tini as init system
ENTRYPOINT ["tini", "--"]
CMD ["/usr/local/bin/docker-entrypoint.sh"]
