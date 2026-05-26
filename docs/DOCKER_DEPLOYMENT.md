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
# 或
code backend-ts/.env
```

**必须修改的配置**：
```bash
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-2026
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

---

## 三、架构说明

### 服务组成

```
┌─────────────────────────────────────────┐
│           Docker Compose                 │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────────────────────┐       │
│  │   Frontend (Nginx)           │       │
│  │  - 静态文件服务               │       │
│  │  - API 反向代理               │       │
│  │  Port: 80                    │       │
│  └──────────┬───────────────────┘       │
│             │ 代理请求                   │
│             ↓                           │
│  ┌──────────────────────┐              │
│  │   Backend (NestJS)   │              │
│  │  Port: 3000          │              │
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
| backend | Node.js 20 Slim (Debian) | 3000 | NestJS 后端服务 |
| frontend | Nginx Alpine | 80 | Vue 前端 + Nginx 反向代理 |

> **注意**：前端 Nginx 同时承担静态文件服务和 API 反向代理的双重角色，无需额外的 Nginx 容器。

### 数据持久化

使用 Docker Volume 持久化以下数据：

- `backend-data`: SQLite 数据库和向量数据库
- `backend-uploads`: 用户上传的文件
- `backend-logs`: 应用日志
- `backend-static`: 静态资源

---

## 四、配置说明

### 1. 如何开启后端端口（可选）

默认配置下，后端端口不对外暴露，只能通过前端 Nginx 反向代理访问。这是**最安全**的配置方式。

如果你需要直接访问后端 API（例如用于调试、监控或第三方集成），可以按需开启后端端口。

#### 方法 1：仅本地访问（推荐用于调试）

编辑 `docker-compose.yml`，找到 backend 服务的 ports 配置：

```yaml
services:
  backend:
    # ... 其他配置
    
    # 取消注释下面两行
    ports:
      - "127.0.0.1:3000:3000"
```

然后重启服务：

```bash
docker-compose up -d backend
```

访问地址：`http://localhost:3000/api/v1`

**特点**：
- ✅ 只有本机可以访问
- ✅ 外部网络无法访问
- ✅ 适合开发调试

#### 方法 2：公开访问（谨慎使用）

编辑 `docker-compose.yml`：

```yaml
services:
  backend:
    # ... 其他配置
    
    # 取消注释并修改为
    ports:
      - "3000:3000"
```

然后重启服务：

```bash
docker-compose up -d backend
```

访问地址：`http://your-server-ip:3000/api/v1`

**特点**：
- ⚠️ 任何网络都可以访问
- ⚠️ 需要确保防火墙和 JWT 安全配置正确
- ⚠️ 仅在有特殊需求时使用

#### 方法 3：完全不暴露（默认，最安全）

保持 `docker-compose.yml` 中的 ports 配置为注释状态：

```yaml
services:
  backend:
    # ... 其他配置
    
    # ports:
    #   - "127.0.0.1:3000:3000"
```

**特点**：
- ✅ 最高安全性
- ✅ 零端口冲突风险
- ✅ 所有流量通过 Nginx 统一管理
- ℹ️ 前端仍然可以通过 Docker 内部网络访问后端

---

### 2. 环境变量

编辑 `backend-ts/.env` 文件：

```bash
# JWT 密钥（必须修改）
JWT_SECRET=your-strong-secret-key

# 后端配置
BACKEND_PORT=3000
NODE_ENV=production

# 数据库路径（容器内路径）
DATABASE_URL=file:/app/data/ai_chat.db
VECTOR_DB_PATH=/app/data/vector_db.sqlite

# 基础 URL（部署时留空，使用相对路径）
# 留空表示前端通过 Nginx 反代访问后端，避免外部域名解析问题
BASE_URL=
```

### 3. docker-compose.yml 配置

主要配置项说明：

```yaml
services:
  backend:
    environment:
      - JWT_SECRET=${JWT_SECRET}  # 从 .env 文件读取
      - PORT=3000
      - DATABASE_URL=file:/app/data/ai_chat.db
      # ... 其他配置
    
    volumes:
      - backend-data:/app/data    # 数据持久化
      - backend-uploads:/app/data/uploads
      - backend-logs:/app/logs
    
    deploy:
      resources:
        limits:
          cpus: '2'               # CPU 限制
          memory: 2G              # 内存限制

  frontend:
    build:
      args:
        - VITE_API_BASE_URL=/api/v1  # API 地址
```

### 4. 自定义配置

#### 修改端口映射

编辑 `docker-compose.yml`：

```yaml
services:
  backend:
    ports:
      - "3001:3000"  # 宿主机 3001 -> 容器 3000
  
  frontend:
    ports:
      - "8081:80"    # 宿主机 8081 -> 容器 80
```

#### 调整资源限制

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

## 五、常用命令

### 启动与停止

```bash
# 启动所有服务
docker-compose up -d

# 停止所有服务
docker-compose down

# 重启特定服务
docker-compose restart backend
docker-compose restart frontend

# 停止并删除数据卷（⚠️ 谨慎使用！）
docker-compose down -v
```

### 查看状态

```bash
# 查看服务状态
docker-compose ps

# 查看资源使用
docker stats

# 查看容器详细信息
docker inspect guada-backend
```

### 查看日志

```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f backend
docker-compose logs -f frontend

# 查看最近 100 行日志
docker-compose logs --tail=100 backend
```

### 进入容器

```bash
# 进入后端容器
docker-compose exec backend sh

# 进入前端容器
docker-compose exec frontend sh

# 在容器内执行命令
docker-compose exec backend ls -lh /app/data
```

### 构建与更新

```bash
# 重新构建镜像
docker-compose build --no-cache

# 拉取最新代码并重新部署
git pull
docker-compose build --no-cache
docker-compose up -d

# 清理未使用的镜像
docker image prune -f
```

---

## 六、数据库管理

### 备份数据库

```bash
# 方法 1: 直接复制数据库文件
docker-compose exec backend cp /app/data/ai_chat.db /tmp/backup.db
docker cp guada-backend:/tmp/backup.db ./backup-$(date +%Y%m%d_%H%M%S).db

# 方法 2: 使用 docker cp
docker cp guada-backend:/app/data/ai_chat.db ./backup.db

# 备份向量数据库
docker cp guada-backend:/app/data/vector_db.sqlite ./vector_backup.sqlite
```

### 恢复数据库

```bash
# 停止服务
docker-compose down

# 恢复数据库文件
docker cp ./backup.db guada-backend:/app/data/ai_chat.db
docker cp ./vector_backup.sqlite guada-backend:/app/data/vector_db.sqlite

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

## 七、HTTPS 配置（可选）

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

# 证书位置
# /etc/letsencrypt/live/yourdomain.com/fullchain.pem
# /etc/letsencrypt/live/yourdomain.com/privkey.pem

# 复制到项目目录
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/key.pem

# 重启服务
docker-compose restart frontend
```

---

## 八、性能优化

### 1. 调整资源限制

根据服务器配置调整 `docker-compose.yml`：

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '4'      # 根据 CPU 核心数调整
          memory: 4G     # 根据可用内存调整
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

### 3. 优化 Nginx 缓存

前端 `nginx.conf` 已配置静态资源缓存：

```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

### 4. 数据库优化

定期清理日志和临时文件：

```bash
# 进入容器清理
docker-compose exec backend sh
rm -rf /app/logs/*.log.*
find /app/data/temp-attachments -type f -mtime +7 -delete
```

---

## 九、故障排查

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

### 2. 数据库问题

```bash
# 检查数据库文件是否存在
docker-compose exec backend ls -lh /app/data/*.db

# 重新初始化数据库
docker-compose exec backend npx prisma db push --accept-data-loss
docker-compose exec backend npm run db:seed:force

# 查看 Prisma 状态
docker-compose exec backend npx prisma status
```

### 3. 端口冲突

```bash
# 查看端口占用
netstat -tuln | grep 3000
netstat -tuln | grep 80

# 修改 docker-compose.yml 中的端口映射
ports:
  - "3001:3000"  # 改为其他端口
```

### 4. 内存不足

```bash
# 查看资源使用
docker stats

# 增加 swap 空间（Linux）
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 调整容器内存限制
deploy:
  resources:
    limits:
      memory: 1G  # 降低内存限制
```

### 5. 网络连接问题

```bash
# 检查网络
docker network ls
docker network inspect guada-network

# 测试容器间通信
docker-compose exec backend ping frontend
docker-compose exec frontend wget -qO- http://backend:3000/api/v1/health

# 重建网络
docker-compose down
docker-compose up -d
```

### 6. SSE 流式传输中断

确保 Nginx 配置正确：

```nginx
location /api/v1/ {
    proxy_buffering off;
    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 3600s;
}
```

---

## 十、监控与维护

### 1. 健康检查

```bash
# 检查服务健康状态
curl http://localhost:3000/api/v1/health  # 如开启了后端端口
curl http://localhost:8787/  # 前端默认端口

# 查看健康检查日志
docker inspect guada-backend | jq '.[].State.Health'
```

### 2. 日志分析

```bash
# 查看错误日志
docker-compose logs backend | grep ERROR

# 查看警告日志
docker-compose logs backend | grep WARN

# 导出日志
docker-compose logs backend > backend.log
```

### 3. 磁盘空间管理

```bash
# 查看 Docker 磁盘使用
docker system df

# 清理未使用的资源
docker system prune -a

# 清理卷
docker volume prune
```

### 4. 版本更新

```bash
# 拉取最新代码
git pull

# 重新构建
docker-compose build --no-cache

# 滚动更新（零停机）
docker-compose up -d --no-deps backend
docker-compose up -d --no-deps frontend

# 清理旧镜像
docker image prune -f
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
USER nginx-user  # frontend
```

### 4. 定期更新镜像

```bash
# 更新基础镜像
docker-compose pull
docker-compose up -d
```

### 5. 防火墙配置

```bash
# Ubuntu (UFW)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# CentOS (firewalld)
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

---

## 十二、常见问题 FAQ

### Q1: localhost 无法访问怎么办？

在 Windows + Docker Desktop 环境下，`http://localhost:8787` 可能因 IPv6 解析问题无法访问。

**解决方案**：

1. **直接使用 IPv4 地址访问**：
   ```
   http://127.0.0.1:8787
   ```

2. **原因说明**：
   - `localhost` 在 Windows 上可能优先解析到 `::1`（IPv6）
   - Docker Desktop on Windows 的 IPv6 端口转发存在限制
   - `127.0.0.1` 强制使用 IPv4，可以正常访问

3. **Linux / macOS 用户**：
   - 通常 `localhost` 可以正常访问
   - 如遇问题，同样可使用 `127.0.0.1`

### Q2: 如何重置数据库？

```bash
docker-compose down -v
docker-compose up -d
```

### Q3: 如何查看数据库内容？

```bash
# 安装 sqlite3
docker-compose exec backend apt-get update && apt-get install -y sqlite3

# 查询数据库
docker-compose exec backend sqlite3 /app/data/ai_chat.db ".tables"
docker-compose exec backend sqlite3 /app/data/ai_chat.db "SELECT * FROM user;"
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

### Q5: 容器启动很慢怎么办？

1. 检查资源限制是否过低
2. 查看日志确认是否有错误
3. 尝试增加内存限制
4. 检查磁盘 I/O 性能

### Q6: 如何实现高可用？

目前设计为单实例部署，如需高可用：

1. 使用 Kubernetes 替代 Docker Compose
2. 将 SQLite 迁移到 PostgreSQL
3. 使用负载均衡器
4. 配置多副本

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
         ├─ SQLite Database (/app/data/ai_chat.db)
         ├─ Vector Database (/app/data/vector_db.sqlite)
         ├─ File Storage (/app/data/uploads)
         └─ Logs (/app/logs)
```

---

**技术支持**：遇到问题请加 QQ 群 1047993501 或查看项目 README。
