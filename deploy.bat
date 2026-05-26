@echo off
setlocal enabledelayedexpansion

echo =========================================
echo GuaDa AI Docker Deployment
echo =========================================

REM Check if Docker is installed
where docker >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: Docker is not installed
    exit /b 1
)

REM Check if .env file exists (in backend-ts directory)
if not exist backend-ts\.env (
    echo Warning: .env file not found in backend-ts\. Copying from backend-ts\.env.example...
    copy backend-ts\.env.example backend-ts\.env
    echo Please edit backend-ts\.env file and set JWT_SECRET before continuing.
    exit /b 1
)

REM Build images
echo Building Docker images...
docker-compose build --no-cache
if %ERRORLEVEL% neq 0 (
    echo Error: Docker build failed!
    exit /b 1
)

REM Start services
echo Starting services...
docker-compose up -d
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to start services!
    exit /b 1
)

REM Wait for services
if %ERRORLEVEL% neq 0 (
    echo Error: Docker compose up failed!
    exit /b 1
)

echo Waiting for services to start...
timeout /t 10 /nobreak >nul

REM Check status
echo.
echo =========================================
echo Deployment Complete!
echo =========================================
echo.
echo Services Status:
docker-compose ps
echo.
echo Access URLs:
echo   - Frontend: http://localhost:8787
echo   - Backend API: http://localhost:3000/api/v1
echo   - With Proxy: http://localhost:8080
echo.
echo View Logs:
echo   docker-compose logs -f backend
echo   docker-compose logs -f frontend
echo.
echo Stop Services:
echo   docker-compose down
echo.
