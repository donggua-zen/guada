# GuaDa AI Docker 部署指南

本文档提供 GuaDa AI 系统的 Docker 容器化部署方案，包括快速开始、配置说明、运维管理和故障排查。

## 一、环境要求

### 前置条件
- **Docker**: ≥ 20.10.x
- **Docker Compose**: ≥ 2.0.x
- **操作系统**: Linux / Windows (WSL2) / macOS

### 验证安装
```bash
docker --version
docker-compose --version
```

---

## 二、快速开始

### 1. 克隆项目并配置

```bash
# 克隆项目
git clone <repository-url>
cd ai_chat

# 复制环境变量配置文件（文件位于 backend-ts 目录下）
cp backend-ts/.env.example backend-ts/.env

# 编辑 .env 文件，修改 JWT_SECRET
nano backend-ts/.env
```

**必须修改的配置**：
```bash
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
```

> ⚠️ **重要**：生产环境务必使用强随机字符串作为 JWT_SECRET

### 2. 一键部署

#### Linux/macOS
```bash
chmod +x deploy.sh
./deploy.sh
```

#### Windows
```batch
deploy.bat
```

### 3. 访问应用

部署完成后，可以通过以下地址访问：

- **前端界面**: http://localhost:8787
- **后端 API**: http://localhost:8787/api/v1 （通过 Nginx 代理）

> **注意**：默认配置下，后端端口不对外暴露，只能通过前端 Nginx 访问。如需直接访问后端（用于调试），请参考下面的「如何开启后端端口」章节。

> **Windows 用户**：如 `localhost` 无法访问，请使用 `http://127.0.0.1:8787`（IPv6 解析问题）。

---

## 三、架构说明

### 服务组成

```
┌─────────────────────────────────────────┐
│           Docker Compose                 │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────────────┐              │
│  │   Frontend (Nginx)   │              │
│  │  - 静态文件服务       │              │
│  │  - API 反向代理       │              │
│  │  Port: 80            │              │
│  └──────────┬───────────┘              │
│             │ 代理请求                   │
│             ↓                           │
│  ┌──────────────────────┐              │
│  │   Backend (NestJS)   │              │
│  │  Port: 3000          │              │
│  │  - 数据库迁移自动执行  │              │
│  └──────────┬───────────┘              │
│             │                          │
│    ┌────────▼────────┐                │
│    │  Docker Volumes │                │
│    │  - SQLite DB    │                │
│    │  - Vector DB    │                │
│    │  - Uploads      │                │
│    │  - Logs         │                │
│    └─────────────────┘                │
└─────────────────────────────────────────┘
```

### 服务说明

| 服务 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| backend | Node.js 20 Slim (Debian) | 3000 | NestJS 后端服务，启动时自动执行数据库迁移 |
| frontend | Nginx Alpine | 80 | Vue 前端 + Nginx 反向代理 |

### 数据持久化

使用 Docker Volume 持久化以下数据：

- `backend-data`: SQLite 数据库和向量数据库
- `backend-uploads`: 用户上传的文件
- `backend-logs`: 应用日志
- `backend-static`: 静态资源

---

## 四、数据库迁移

### 自动迁移机制

数据库迁移在 **NestJS 后端启动时自动执行**，无需手动操作。迁移运行器 (`MigrationRunner`) 基于 `better-sqlite3` 直接执行 DDL，不依赖 Prisma CLI。

**启动时行为**：

| 场景 | 检测条件 | 行为 |
|------|---------|------|
| 全新安装 | 无业务表 | 执行 baseline SQL 创建全部表结构 + 导入默认数据 |
| 版本升级 | `_app_migrations` 表有记录 | 仅执行新增的 pending 迁移 |
| 首次升级旧版 | 有业务表但无迁移记录 | 标记当前迁移为已应用，仅执行后续迁移 |

### 备份策略

- 执行迁移前自动 WAL checkpoint + 备份数据库
- 保留最近 3 份备份，自动清理更旧的
- 备份文件位于 `/app/data/` 目录，命名格式：`ai_chat.db.bak.<timestamp>`

### 迁移日志

```bash
# 查看迁移日志
docker-compose logs backend | grep MigrationRunner

# 预期输出（首次部署）：
# [MigrationRunner] 检测到全新安装，执行基线迁移...
# [MigrationRunner] 全新安装完成，已标记 1 个迁移为已应用
```

### 查看已应用的迁移

```bash
# 容器内查询迁移记录
docker-compose exec backend sqlite3 /app/data/ai_chat.db \
  "SELECT * FROM _app_migrations ORDER BY id;"
```

> ⚠️ **注意**：生产容器中**不包含 Prisma CLI**（已移至 devDependencies 以减小镜像体积）。不要在容器内执行 `npx prisma db push` 或 `npx prisma migrate` 等命令——这些命令在容器中不可用且不需要。

---

## 五、配置说明

### 1. 如何开启后端端口（可选）

默认配置下，后端端口不对外暴露，只能通过前端 Nginx 反向代理访问。这是**最安全**的配置方式。

#### 方法 1：仅本地访问（推荐用于调试）

编辑 `docker-compose.yml`，找到 backend 服务的 ports 配置：

```yaml
services:
  backend:
    # 取消注释下面两行
    ports:
      - "127.0.0.1:3000:3000"
```

然后重启服务：

```bash
docker-compose up -d backend
```

#### 方法 2：完全不暴露（默认，最安全）

保持 `docker-compose.yml` 中的 ports 配置为注释状态。所有流量通过 Nginx 统一管理。

---

### 2. 环境变量

编辑 `backend-ts/.env` 文件：

```bash
# JWT 密钥（必须修改）
JWT_SECRET=your-strong-secret-key

# 后端配置
PORT=3000
NODE_ENV=production

# 数据库路径（容器内路径）
DATABASE_URL=file:/app/data/ai_chat.db
VECTOR_DB_PATH=/app/data/vector_db.sqlite

# 基础 URL（部署时留空，使用相对路径）
# 留空表示前端通过 Nginx 反代访问后端，避免外部域名解析问题
BASE_URL=
```

### 3. 自定义端口

编辑 `docker-compose.yml`：

```yaml
services:
  frontend:
    ports:
      - "8081:80"    # 宿主机 8081 -> 容器 80
```

### 4. 调整资源限制

```yaml
deploy:
  resources:
    limits:
      cpus: '4'
      memory: 4G
    reservations:
      cpus: '1'
      memory: 1G
```

---

## 六、常用命令

### 启动与停止

```bash
# 启动所有服务
docker-compose up -d

# 停止所有服务
docker-compose down

# 重启特定服务
docker-compose restart backend
docker-compose restart frontend

# 停止并删除数据卷（⚠️ 谨慎使用！会删除所有数据）
docker-compose down -v
```

### 查看状态

```bash
# 查看服务状态
docker-compose ps

# 查看资源使用
docker stats

# 查看日志
docker-compose logs -f backend
docker-compose logs -f frontend

# 查看最近 100 行日志
docker-compose logs --tail=100 backend
```

### 进入容器

```bash
# 进入后端容器
docker-compose exec backend sh

# 检查数据库文件
docker-compose exec backend ls -lh /app/data/
```

### 构建与更新

```bash
# 重新构建镜像
docker-compose build --no-cache

# 拉取最新代码并重新部署
git pull
docker-compose build --no-cache
docker-compose up -d

# 清理旧镜像
docker image prune -f
```

---

## 七、数据库管理

### 备份数据库

```bash
# 方法 1: 使用 docker cp
docker cp guada-backend:/app/data/ai_chat.db ./backup-$(date +%Y%m%d).db

# 方法 2: 使用容器内临时文件
docker-compose exec -T backend cp /app/data/ai_chat.db /tmp/backup.db
docker cp guada-backend:/tmp/backup.db ./backup.db

# 同时备份向量数据库
docker cp guada-backend:/app/data/vector_db.sqlite ./vector_backup.sqlite
```

### 恢复数据库

```bash
# 停止服务
docker-compose down

# 恢复数据库文件
docker cp ./backup.db guada-backend:/app/data/ai_chat.db

# 删除 WAL/SHM 文件（避免冲突）
docker-compose run --rm --entrypoint sh backend -c "rm -f /app/data/ai_chat.db-wal /app/data/ai_chat.db-shm"

# 重新启动服务
docker-compose up -d
```

### 自动备份脚本

创建 `backup.sh`：

```bash
#!/bin/bash
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# 备份数据库
docker-compose exec -T backend cp /app/data/ai_chat.db /tmp/backup.db
docker cp guada-backend:/tmp/backup.db "$BACKUP_DIR/ai_chat_$TIMESTAMP.db"

# 压缩备份
gzip "$BACKUP_DIR/ai_chat_$TIMESTAMP.db"

# 删除 30 天前的备份
find $BACKUP_DIR -name "ai_chat_*.db.gz" -mtime +30 -delete

echo "Backup completed: ai_chat_$TIMESTAMP.db.gz"
```

设置定时任务：

```bash
# 每天凌晨 2 点备份
crontab -e
0 2 * * * /path/to/backup.sh >> /var/log/guada-backup.log 2>&1
```

---

## 八、HTTPS 配置（可选）

### 1. 准备 SSL 证书

将证书文件放入 `nginx/ssl/` 目录：

```bash
mkdir -p nginx/ssl
cp your-domain.crt nginx/ssl/cert.pem
cp your-domain.key nginx/ssl/key.pem
```

### 2. 修改前端 Nginx 配置

编辑 `frontend/nginx.conf`，添加 HTTPS 支持：

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    root /usr/share/nginx/html;
    index index.html;

    # ... 其他配置（反向代理等）
}

# HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

### 3. 启用 HTTPS 端口

编辑 `docker-compose.yml`，取消注释 HTTPS 端口映射：

```yaml
frontend:
  ports:
    - "80:80"
    - "443:443"  # 取消注释此行
  volumes:
    - ./nginx/ssl:/etc/nginx/ssl:ro  # 取消注释此行
```

### 4. 使用 Let's Encrypt（推荐）

```bash
# 安装 Certbot
sudo apt-get install certbot

# 获取证书
sudo certbot certonly --standalone -d yourdomain.com

# 复制到项目目录
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/key.pem

# 重启服务
docker-compose restart frontend
```

---

## 九、性能优化

### 1. 调整资源限制

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 4G
```

### 2. 启用日志轮转

```yaml
services:
  backend:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 3. 数据库维护

定期清理日志和临时文件：

```bash
docker-compose exec backend sh
rm -rf /app/logs/*.log.*
find /app/data/temp-attachments -type f -mtime +7 -delete
```

---

## 十、故障排查

### 1. 容器无法启动

```bash
# 查看详细日志
docker-compose logs backend

# 检查健康状态
docker inspect guada-backend | grep -A 10 Health

# 进入容器调试
docker-compose exec backend sh

# 检查数据库文件权限
docker-compose exec backend ls -lh /app/data/
```

### 2. 数据库迁移失败

```bash
# 查看迁移运行器日志
docker-compose logs backend | grep -i migration

# 检查迁移追踪表
docker-compose exec backend sqlite3 /app/data/ai_chat.db \
  "SELECT * FROM _app_migrations ORDER BY id;"

# 检查是否有备份文件
docker-compose exec backend ls -lh /app/data/ai_chat.db.bak.*

# 手动恢复备份（如迁移导致问题）
docker-compose down
docker cp ./backup.db guada-backend:/app/data/ai_chat.db
# 删除 WAL/SHM
docker-compose run --rm --entrypoint sh backend -c "rm -f /app/data/ai_chat.db-wal /app/data/ai_chat.db-shm"
docker-compose up -d
```

> ⚠️ **不要在容器内执行 prisma 命令**。生产容器不含 Prisma CLI。数据库迁移由 MigrationRunner 在 NestJS 启动时自动处理。

### 3. 端口冲突

```bash
# 查看端口占用
netstat -tuln | grep 8787

# 修改 docker-compose.yml 中的端口映射
ports:
  - "8788:80"  # 改为其他端口
```

### 4. 内存不足

```bash
# 查看资源使用
docker stats

# 调整容器内存限制
deploy:
  resources:
    limits:
      memory: 1G  # 降低内存限制
```

### 5. SSE 流式传输中断

确保 Nginx 配置正确：

```nginx
location /api/v1/ {
    proxy_buffering off;
    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 3600s;
}
```

---

## 十一、安全建议

### 1. 修改默认密钥

```bash
# 生成强随机密钥
openssl rand -base64 32

# 更新 .env 文件
JWT_SECRET=<生成的密钥>
```

### 2. 限制网络访问

```yaml
services:
  backend:
    ports:
      - "127.0.0.1:3000:3000"  # 仅允许本地访问
```

### 3. 使用非 root 用户

Dockerfile 已配置非 root 用户运行：

```dockerfile
USER nestjs  # backend
```

### 4. 防火墙配置

```bash
# Ubuntu (UFW)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## 十二、常见问题 FAQ

### Q1: localhost 无法访问怎么办？

在 Windows + Docker Desktop 环境下，`http://localhost:8787` 可能因 IPv6 解析问题无法访问。

**解决方案**：使用 `http://127.0.0.1:8787`

### Q2: 如何重置数据库？

```bash
# 停止并删除数据卷
docker-compose down -v

# 重新启动，MigrationRunner 会自动执行全新安装
docker-compose up -d
```

### Q3: 如何查看数据库内容？

```bash
# 查看表结构
docker-compose exec backend sqlite3 /app/data/ai_chat.db ".tables"

# 查询用户表
docker-compose exec backend sqlite3 /app/data/ai_chat.db "SELECT id, username FROM user;"

# 查看迁移记录
docker-compose exec backend sqlite3 /app/data/ai_chat.db "SELECT * FROM _app_migrations;"
```

### Q4: 如何修改前端 API 地址？

编辑 `docker-compose.yml`：

```yaml
frontend:
  build:
    args:
      - VITE_API_BASE_URL=http://your-api-server/api/v1
```

然后重新构建：

```bash
docker-compose build frontend
docker-compose up -d frontend
```

### Q5: 升级版本后需要手动迁移数据库吗？

**不需要**。后端启动时 MigrationRunner 会自动检测并执行 pending 迁移。只需正常更新代码、重新构建并启动即可：

```bash
git pull
docker-compose build --no-cache
docker-compose up -d
```

---

## 附录：完整架构图

```
用户浏览器
    ↓
Frontend Nginx (80/443)
    ├─→ / → 前端静态文件 (/usr/share/nginx/html)
    ├─→ /api/v1/* → Backend (backend:3000)
    ├─→ /uploads/* → Backend (backend:3000)
    └─→ /static/* → Backend (backend:3000)
         ↓
    NestJS Backend
         ├─ MigrationRunner (启动时自动迁移)
         ├─ SQLite Database (/app/data/ai_chat.db)
         ├─ Vector Database (/app/data/vector_db.sqlite)
         ├─ File Storage (/app/data/uploads)
         └─ Logs (/app/logs)
```

---

**技术支持**：遇到问题请加 QQ 群 1047993501 或查看项目 README。
