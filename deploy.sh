#!/bin/bash
set -e

echo "========================================="
echo "GuaDa AI Docker Deployment"
echo "========================================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "Error: Docker Compose is not installed"
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Warning: .env file not found. Copying from .env.example..."
    cp .env.example .env
    echo "Please edit .env file and set JWT_SECRET before continuing."
    exit 1
fi

# Pull latest images
echo "Pulling latest images..."
docker-compose pull || echo "Warning: Could not pull images (first build?)"

# Build images
echo "Building Docker images..."
docker-compose build --no-cache

# Start services
echo "Starting services..."
docker-compose up -d

# Wait for services to be healthy
echo "Waiting for services to start..."
sleep 10

# Check status
echo ""
echo "========================================="
echo "Deployment Complete!"
echo "========================================="
echo ""
echo "Services Status:"
docker-compose ps
echo ""
echo "Access URLs:"
echo "  - Frontend: http://localhost:80"
echo "  - Backend API: http://localhost:3000/api/v1"
echo "  - With Proxy: http://localhost:8080"
echo ""
echo "View Logs:"
echo "  docker-compose logs -f backend"
echo "  docker-compose logs -f frontend"
echo ""
echo "Stop Services:"
echo "  docker-compose down"
echo ""
