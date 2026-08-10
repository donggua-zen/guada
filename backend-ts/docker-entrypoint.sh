#!/bin/sh
set -e

echo "========================================="
echo "GuaDa AI Backend Starting..."
echo "========================================="

# Ensure data directories exist
mkdir -p /app/data/uploads
mkdir -p /app/data/compression-states
mkdir -p /app/logs

# Set default database URL if not provided
export DATABASE_URL=${DATABASE_URL:-file:/app/data/ai_chat.db}

echo "Database URL: $DATABASE_URL"

# Check if dist exists
if [ ! -f /app/dist/main.js ]; then
  echo "Error: /app/dist/main.js not found!"
  echo "Contents of /app/dist:"
  ls -la /app/dist/ || echo "dist directory not found"
  exit 1
fi

# Database migrations are handled automatically by MigrationRunner on NestJS startup.
# No need for prisma db push or manual seed — MigrationRunner handles:
# - First run: baseline schema + seed data
# - Upgrades: incremental migrations
# - Legacy 0.5.2: bootstrap detection + mark baseline as applied

echo "Starting NestJS application..."
exec node dist/main.js
