# GuaDa AI 生产环境部署指南

本文档提供 GuaDa AI 系统的完整生产环境部署方案，包括后端服务、前端静态资源、反向代理配置和进程守护。

## 一、环境要求

### 系统要求
- **Node.js**: ≥ 18.x（推荐 20.x LTS）
- **npm**: ≥ 9.x
- **操作系统**: Linux (Ubuntu/CentOS) / Windows Server / macOS

### 前置软件
```bash
# 安装 Node.js 和 npm（以 Ubuntu 为例）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node --version  # 应显示 v20.x.x
npm --version   # 应显示 9.x.x 或更高
```

---

## 二、后端部署

### 1. 克隆项目并安装依赖

```bash
# 建议部署路径（避免权限问题）
sudo mkdir -p /opt/guada-ai
sudo chown $USER:$USER /opt/guada-ai
cd /opt/guada-ai

# 克隆项目
git clone <repository-url> .
cd backend-ts

# 安装依赖（自动打 node-pty / parcel-watcher 补丁）
pnpm install
```

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑配置文件
nano .env
```

**必须修改的配置项**：

```ini
# JWT 密钥（生产环境务必修改为强随机字符串）
JWT_SECRET="your-production-secret-key-here-change-this"

# 服务器端口
PORT=3000

# 运行环境
NODE_ENV=production

# 上传文件目录（使用绝对路径）
UPLOAD_ROOT_DIR=/opt/guada-ai/backend-ts/data/uploads
UPLOAD_URL_PREFIX=/uploads

# 基础 URL（设置为实际域名或 IP）
BASE_URL=https://api.yourdomain.com
```

### 3. 首次启动

```bash
pnpm run build
pnpm run start:prod
```

首次启动会自动创建文件化存储：`sessions/_meta.db`、`account.json`、`agents/`、
`providers/`、`data/kb/` 等。**无需数据库 seed，也不再生成 `ai_chat.db`。**

### 4. 构建生产版本

```bash
pnpm run build
```

构建完成后，产物位于 `dist/` 目录。

### 5. 启动服务

#### 方式一：直接启动（测试用）
```bash
pnpm run start:prod
```

#### 方式二：使用 PM2 进程守护（推荐）

```bash
# 全局安装 PM2
pnpm add -g pm2

# 启动应用
pm2 start dist/main.js --name guada-backend

# 设置开机自启
pm2 startup systemd
pm2 save

# 查看状态
pm2 status
pm2 logs guada-backend
```

**PM2 配置文件** (`ecosystem.config.js`)：

```javascript
module.exports = {
  apps: [{
    name: 'guada-backend',
    script: './dist/main.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
```

使用配置启动：
```bash
pm2 start ecosystem.config.js
```

---

## 三、前端部署

### 1. 构建生产版本

```bash
cd frontend

# 安装依赖
pnpm install

# 配置 API 地址（可选）
# 方法一：修改 vite.config.ts 中的 base 选项
# 方法二：设置环境变量 VITE_API_BASE_URL
export VITE_API_BASE_URL=https://api.yourdomain.com

# 构建
pnpm run build
```

构建完成后，产物位于 `dist/` 目录。

### 2. 部署静态文件

```bash
# 将构建产物复制到 Web 服务器目录
sudo cp -r dist/* /var/www/guada-frontend/
```

---

## 四、Nginx 反向代理配置

### 1. 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt-get install nginx

# CentOS/RHEL
sudo yum install nginx
```

### 2. 配置反向代理

创建配置文件 `/etc/nginx/sites-available/guada-ai`：

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # 日志配置
    access_log /var/log/nginx/guada-access.log;
    error_log /var/log/nginx/guada-error.log;

    # 前端静态文件
    location / {
        root /var/www/guada-frontend;
        index index.html;
        try_files $uri $uri/ /index.html;
        
        # 缓存控制
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }

    # 后端 API 代理（普通 API）
    location /api/v1/ {
        proxy_pass http://localhost:3000/api/v1/;
        proxy_http_version 1.1;
        
        # WebSocket 支持（SSE 流式传输需要）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 请求头转发
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 超时设置（普通 API 请求）
        proxy_connect_timeout 60s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
        
        # 缓冲设置
        proxy_buffering off;
        proxy_cache_bypass $http_upgrade;
    }

    # 流式 API 代理（Agent 对话、SSE 流式输出）
    # 为长时间运行的 LLM 对话设置更长的超时时间
    location /api/v1/chat/completions {
        proxy_pass http://localhost:3000/api/v1/chat/completions;
        proxy_http_version 1.1;
        
        # WebSocket 支持（SSE 流式传输必需）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 请求头转发
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 超时设置（流式对话可能需要数分钟甚至数小时）
        proxy_connect_timeout 60s;
        proxy_send_timeout 3600s;    # 1 小时发送超时
        proxy_read_timeout 3600s;    # 1 小时读取超时
        
        # 关键：禁用缓冲，确保实时流式传输
        proxy_buffering off;
        proxy_cache_bypass $http_upgrade;
        
        # 可选：针对超长对话可设置为更长时间
        # proxy_send_timeout 7200s;  # 2 小时
        # proxy_read_timeout 7200s;  # 2 小时
    }

    # 静态资源代理（上传文件）
    location /uploads/ {
        proxy_pass http://localhost:3000/uploads/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        
        # 大文件支持
        client_max_body_size 50M;
    }

    # 基础静态资源代理
    location /static/ {
        proxy_pass http://localhost:3000/static/;
        proxy_set_header Host $host;
    }
}
```

### Nginx 超时配置说明

**为什么要区分普通 API 和流式 API 的超时时间？**

1. **普通 API 请求**（如登录、查询列表等）
   - 通常响应时间在几秒内
   - 设置较短的超时（120s）可以快速发现并处理异常
   - 避免长时间占用连接资源

2. **流式 API 请求**（Agent 对话、SSE 流式输出）
   - LLM 生成可能需要数分钟甚至数小时
   - 特别是复杂任务、多轮工具调用、长文本生成等场景
   - 需要设置更长的超时时间（默认 1 小时，可根据需要调整）

**超时参数说明**：

- `proxy_connect_timeout`: 与后端建立连接的超时时间（60s 足够）
- `proxy_send_timeout`: 向后端发送请求的超时时间
- `proxy_read_timeout`: 从后端读取响应的超时时间（最关键）

**如何根据实际需求调整超时时间？**

```nginx
# 示例 1: 中等长度对话（10-30 分钟）
proxy_send_timeout 1800s;   # 30 分钟
proxy_read_timeout 1800s;

# 示例 2: 长时间对话（1-2 小时）
proxy_send_timeout 3600s;   # 1 小时
proxy_read_timeout 3600s;

# 示例 3: 超长对话或复杂任务（2-4 小时）
proxy_send_timeout 7200s;   # 2 小时
proxy_read_timeout 7200s;

# 示例 4: 极长时间任务（不推荐，建议优化业务逻辑）
proxy_send_timeout 14400s;  # 4 小时
proxy_read_timeout 14400s;
```

**注意事项**：

1. **过长的超时时间会占用服务器资源**，建议根据实际业务需求合理设置
2. **如果经常遇到超时**，考虑优化以下方面：
   - 使用更快的 LLM 模型
   - 优化 Prompt，减少不必要的上下文
   - 启用上下文压缩功能
   - 将长任务拆分为多个短任务
3. **监控超时情况**：定期检查 Nginx 错误日志，分析超时原因
   ```bash
   grep "upstream timed out" /var/log/nginx/guada-error.log
   ```

### 3. 启用配置并重启 Nginx

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/guada-ai /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx

# 设置开机自启
sudo systemctl enable nginx
```

### 4. 配置 HTTPS（推荐）

使用 Let's Encrypt 免费证书：

```bash
# 安装 Certbot
sudo apt-get install certbot python3-certbot-nginx

# 自动获取并配置证书
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# 自动续期测试
sudo certbot renew --dry-run
```

---

## 五、防火墙与安全配置

### 1. 配置防火墙

```bash
# Ubuntu (UFW)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp  # SSH
sudo ufw enable

# CentOS (firewalld)
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
```

### 2. 文件权限设置

```bash
# 设置正确的所有权
sudo chown -R www-data:www-data /var/www/guada-frontend
sudo chown -R $USER:$USER /opt/guada-ai/backend-ts

# 设置目录权限
chmod -R 755 /var/www/guada-frontend
chmod -R 755 /opt/guada-ai/backend-ts/data
```

---

## 六、监控与维护

### 1. 日志查看

```bash
# 后端日志（PM2）
pm2 logs guada-backend

# 后端日志（文件）
tail -f /opt/guada-ai/backend-ts/logs/combined.log

# Nginx 访问日志
sudo tail -f /var/log/nginx/guada-access.log

# Nginx 错误日志
sudo tail -f /var/log/nginx/guada-error.log
```

### 2. 健康检查

创建健康检查端点（已在系统中实现）：

```bash
# 测试后端服务
curl http://localhost:3000/api/v1/health

# 测试前端
curl http://localhost:80
```

### 3. 备份策略

```bash
#!/bin/bash
# backup.sh - 数据目录备份脚本
#
# 需要备份的是「数据根」下的文件化存储，而不是某个数据库文件：
#   sessions/     会话元信息 _meta.db + JSONL 消息 + 工作流快照
#   data/kb/      知识库（kb.json / kb.db / raw/）
#   account.json  账户
#   agents/ providers/ file_stores/ 等配置与上传文件
# DATA_ROOT 必须与后端实际使用的 USERDATA_DIR / SESSION_DATA_DIR 一致。

BACKUP_DIR="/opt/guada-ai/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DATA_ROOT="/opt/guada-ai/backend-ts"

mkdir -p $BACKUP_DIR

# 备份数据根下的文件化存储（不存在的路径自动跳过）
tar -czf "$BACKUP_DIR/guada-data_$TIMESTAMP.tar.gz" \
  -C "$DATA_ROOT" \
  --ignore-failed-read \
  sessions data account.json agents providers file_stores 2>/dev/null || true

# 删除 30 天前的备份
find $BACKUP_DIR -name "guada-data_*.tar.gz" -mtime +30 -delete

echo "Backup completed: guada-data_$TIMESTAMP.tar.gz"
```

设置定时任务：
```bash
# 每天凌晨 2 点备份
crontab -e
0 2 * * * /opt/guada-ai/backup.sh >> /var/log/guada-backup.log 2>&1
```

---

## 七、常见问题排查

### 1. 会话列表为空 / `_meta.db` 不存在

**症状**：启动后侧栏没有会话，或日志提示无法打开 `sessions/_meta.db`

**解决**：
```bash
# 确认数据根与权限（SESSION_DATA_DIR / USERDATA_DIR 必须指向实际数据目录）
ls -la sessions/_meta.db
ls -la data/kb

# 目录权限
chown -R $USER:$USER sessions data
```

### 2. 旧版 Prisma 主库数据不可见

**症状**：从 ≤ v0.5.6 直接升级后，旧会话/账户/供应商没有出现

**原因**：当前版本已移除 Prisma 主库与 DB→文件迁移脚手架，不再读取 `ai_chat.db`。

**解决**：
1. 先安装 **v1.0.8** 启动一次，让旧版迁移完成；
2. 再升级到当前版本。
3. 旧 `ai_chat.db` / `vector_db.sqlite` 仍在磁盘上，不会被自动删除。

### 3. 端口冲突

**症状**：`EADDRINUSE: address already in use :::3000`

**解决**：
```bash
# 查找占用端口的进程
lsof -i :3000

# 杀死进程
kill -9 <PID>

# 或修改端口
export PORT=3001
```

### 4. 权限拒绝

**症状**：Nginx 返回 500 Permission denied

**解决**：
```bash
# 确保部署路径不在 /root 目录下
sudo mv /root/guada-ai /opt/guada-ai

# 设置正确权限
sudo chown -R www-data:www-data /var/www/guada-frontend
```

### 5. 环境变量未加载

**症状**：连接到错误的数据库或使用默认配置

**解决**：
```bash
# 确认 .env 文件存在
ls -la backend-ts/.env

# 检查环境变量（数据根）
cat backend-ts/.env | grep -E "USERDATA_DIR|SESSION_DATA_DIR"

# PM2 中手动设置
pm2 delete guada-backend
pm2 start dist/main.js --name guada-backend --env production
```

### 6. SSE 流式传输中断

**症状**：AI 回复到一半断开

**解决**：
```nginx
# Nginx 配置中添加
proxy_buffering off;
proxy_cache_bypass $http_upgrade;
proxy_read_timeout 300s;
```

---

## 八、性能优化建议

### 1. Node.js 优化

```bash
# 增加内存限制
NODE_OPTIONS="--max-old-space-size=4096" pm2 start dist/main.js --name guada-backend
```

### 2. Nginx 优化

```nginx
# 启用 Gzip 压缩
gzip on;
gzip_types text/plain text/css application/json application/javascript text/xml;
gzip_min_length 1000;

#  worker 进程数
worker_processes auto;
```

### 3. 数据库优化

```bash
# 定期清理日志
find /opt/guada-ai/backend-ts/logs -name "*.log" -mtime +7 -delete
```

---

## 九、更新与升级

### 1. 代码更新

```bash
cd /opt/guada-ai
git pull origin main

cd backend-ts
pnpm install
pnpm run build
pm2 restart guada-backend
```

### 2. 数据存储升级

无需执行数据库迁移命令。后端启动时会自动完成：

- `sessions/_meta.db` 的 `user_version` schema 升级（`SessionMetaStore`）
- 各知识库 `kb.db` 的 schema 升级（`KbDatabaseService`）

旧 `ai_chat.db` 不再被读取；如需从 Prisma 时代升级，请先安装 v1.0.8 完成迁移。

---

## 十、快速部署脚本

提供一键部署脚本 `deploy.sh`：

```bash
#!/bin/bash
set -e

echo "=== GuaDa AI 生产环境部署 ==="

# 1. 安装依赖
echo "安装后端依赖..."
cd backend-ts
pnpm install

# 2. 构建后端（首次启动会自动创建文件化存储）
echo "构建后端..."
pnpm run build

# 3. 构建前端
echo "构建前端..."
cd ../frontend
pnpm install
pnpm run build

# 4. 部署前端
echo "部署前端..."
sudo cp -r dist/* /var/www/guada-frontend/

# 5. 启动后端
echo "启动后端服务..."
cd ../backend-ts
pm2 start dist/main.js --name guada-backend
pm2 save

echo "=== 部署完成 ==="
echo "后端: http://localhost:3000"
echo "前端: http://localhost:80"
```

使用方法：
```bash
chmod +x deploy.sh
./deploy.sh
```

---

## 附录：完整架构示意图

```
用户浏览器
    ↓
Nginx (80/443)
    ├─→ / → 前端静态文件 (/var/www/guada-frontend)
    ├─→ /api/v1/* → 后端 API (localhost:3000)
    ├─→ /uploads/* → 上传文件 (localhost:3000)
    └─→ /static/* → 静态资源 (localhost:3000)
         ↓
    NestJS Backend (PM2 守护)
         ├─ 会话元数据库 (sessions/_meta.db)
         ├─ JSONL 消息 (sessions/<id>/seg-*.jsonl)
         ├─ 知识库 (data/kb/<kbId>/kb.db + raw/)
         └─ 上传文件 (data/uploads 或 file_stores/)
```

---

**技术支持**：遇到问题请加 QQ 群 1047993501 或查看项目 README。
