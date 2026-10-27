#!/bin/sh
set -e

echo "========================================="
echo "GuaDa AI Backend Starting..."
echo "========================================="

# Ensure data directories exist
mkdir -p /app/data/uploads
mkdir -p /app/data/compression-states
mkdir -p /app/logs

# Check if dist exists
if [ ! -f /app/dist/main.js ]; then
  echo "Error: /app/dist/main.js not found!"
  echo "Contents of /app/dist:"
  ls -la /app/dist/ || echo "dist directory not found"
  exit 1
fi

echo "Starting NestJS application..."
exec node dist/main.js
