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

## 四、数据存储与升级

### 自动初始化 / schema 升级

后端启动时自动完成文件化存储初始化，无需手动迁移命令：

- `sessions/_meta.db`：会话元数据与分组（`SessionMetaStore`，基于 `user_version` 幂等升级）
- `data/kb/<kbId>/kb.db`：知识库（`KbDatabaseService`）
- `sessions/<id>/seg-*.jsonl`：消息事件日志

旧 `ai_chat.db` 不再被读取；从 Prisma 时代（≤ v0.5.6）升级的用户需先安装 v1.0.8
完成迁移，再升级到当前版本。

### 备份策略

数据都在挂载卷内，直接备份整个数据目录即可（见「七、数据管理」）。
不再有“迁移前自动备份数据库”的步骤。

### 升级日志

```bash
# 查看启动日志（含 _meta.db / kb.db schema 升级）
docker-compose logs backend | grep -E "SessionMetaStore|KbDatabaseService|schema"
```

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

## 七、数据管理

### 备份数据

数据全部在挂载卷 `/app/data`（会话、知识库、上传文件）与 `/app/.config`
（`account.json` 等设置）内。直接打包整个目录：

```bash
# 从运行中的容器导出（tar 流，无需停服务；SQLite 为 WAL 模式，建议低峰执行）
docker-compose exec -T backend tar -czf - -C /app data .config \
  > "./guada-data-$(date +%Y%m%d).tar.gz"
```

### 恢复数据

```bash
docker-compose down

# 把备份解回容器卷（借助临时容器挂载同一个卷）
docker run --rm -v ai_chat_backend-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar -xzf /backup/guada-data-YYYYMMDD.tar.gz -C /data"

docker-compose up -d
```

> 卷名取决于仓库目录名（`docker volume ls` 查看，通常为 `<目录名>_backend-data`）。
> 如果账户文件在 `/app/.config` 而不是数据卷里，请同时备份/恢复它。

### 自动备份脚本

创建 `backup.sh`：

```bash
#!/bin/bash
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# 备份数据卷（会话 / 知识库 / 上传文件）+ 账户设置
docker-compose exec -T backend tar -czf - -C /app data .config \
  > "$BACKUP_DIR/guada-data_$TIMESTAMP.tar.gz"

# 删除 30 天前的备份
find "$BACKUP_DIR" -name "guada-data_*.tar.gz" -mtime +30 -delete

echo "Backup completed: guada-data_$TIMESTAMP.tar.gz"
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

### 2. `_meta.db` / `kb.db` 升级失败

```bash
# 查看启动日志里的 schema 升级错误
docker-compose logs backend | grep -E "SessionMetaStore|KbDatabaseService|schema"

# 检查数据目录与权限
docker-compose exec backend ls -la /app/data/sessions
docker-compose exec backend ls -la /app/data/kb

# 恢复备份（如升级导致问题）
docker-compose down
docker cp ./guada-data-backup.tar.gz guada-backend:/tmp/
docker-compose run --rm --entrypoint sh backend -c \
  "rm -rf /app/data/* && tar -xzf /tmp/guada-data-backup.tar.gz -C /app"
docker-compose up -d
```

> 文件化存储没有独立的迁移命令；schema 升级由后端启动时自动完成。
> 旧 `ai_chat.db` 不再被读取，从 Prisma 时代升级请先安装 v1.0.8。

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

### Q2: 如何重置数据？

```bash
# 停止并删除数据卷（会清空会话、知识库、账户）
docker-compose down -v

# 重新启动，后端会自动创建空的文件化存储
docker-compose up -d
```

### Q3: 如何查看数据内容？

```bash
# 会话元数据库
docker-compose exec backend sqlite3 /app/data/sessions/_meta.db ".tables"
docker-compose exec backend sqlite3 /app/data/sessions/_meta.db "SELECT id, title FROM sessions LIMIT 20;"

# 知识库（每库一个 kb.db）
docker-compose exec backend sh -c 'for db in /app/data/kb/*/kb.db; do echo "== $db"; sqlite3 "$db" ".tables"; done'
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

### Q5: 升级版本后需要手动迁移数据吗？

**不需要**。后端启动时会自动完成 `_meta.db` / `kb.db` 的 schema 升级。只需正常更新代码、重新构建并启动即可：

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
         ├─ 会话元数据库 (/app/data/sessions/_meta.db)
         ├─ JSONL 消息 (/app/data/sessions/<id>/seg-*.jsonl)
         ├─ 知识库 (/app/data/kb/<kbId>/kb.db + raw/)
         ├─ File Storage (/app/data/uploads)
         └─ Logs (/app/logs)
```

---

**技术支持**：遇到问题请加 QQ 群 1047993501 或查看项目 README。
