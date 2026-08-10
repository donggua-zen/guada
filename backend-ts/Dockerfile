# ========================================
# Stage 1: Builder
# ========================================
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list 2>/dev/null; \
    apt-get update && apt-get install -y python3 make g++ libsqlite3-dev && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for build)
RUN PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma npm ci

# Copy source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the application (remove tsbuildinfo to force full rebuild)
RUN rm -f tsconfig.tsbuildinfo && npm run build



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

# Copy package files
COPY package*.json ./

# Install production dependencies only
# postinstall "prisma generate || echo 'skipped'" handles missing CLI gracefully
RUN PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma npm ci --omit=dev && \
    npm cache clean --force && \
    # Remove unnecessary files from node_modules to reduce size
    find node_modules -type f \( \
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

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy generated Prisma Client from builder (prisma CLI not installed in prod)
COPY --from=builder /app/node_modules/.prisma /app/node_modules/.prisma

# Create necessary directories
RUN mkdir -p data/uploads data/compression-states logs static && \
    chown -R nestjs:nodejs /app

# Copy static files from builder
COPY --from=builder /app/static ./static

# Copy bundled skills from builder (用于同步到 skills/.system/)
COPY --from=builder /app/bundled-skills ./bundled-skills



# Copy entrypoint script and convert line endings
COPY docker-entrypoint.sh /usr/local/bin/
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
