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

DB_FILE="/app/data/ai_chat.db"

# Sync database schema using db push (creates tables if not exists)
echo "Syncing database schema..."
DATABASE_URL="$DATABASE_URL" npx prisma db push --config=prisma.config.js --accept-data-loss || echo "Warning: Schema sync failed, continuing anyway"

# Run seed script to initialize default data
echo "Running database seed..."
if [ -f /app/dist/scripts/seed.js ]; then
  node /app/dist/scripts/seed.js --force || echo "Warning: Seed failed, continuing anyway"
else
  echo "Warning: Compiled seed script not found, skipping seed"
fi

echo "Starting NestJS application..."
exec node dist/main.js
