# AI Chat 项目 - 编译、启动与部署完整指南

**最后更新**: 2026-04-05  
**项目结构**: 前端 (Vue 3 + Vite) + 后端 (NestJS + TypeScript)

---

## 📋 目录

1. [项目架构概览](#项目架构概览)
2. [环境要求](#环境要求)
3. [后端 (backend-ts)](#后端-backend-ts)
4. [前端 (frontend)](#前端-frontend)
5. [开发环境实践](#开发环境实践)
6. [生产环境部署](#生产环境部署)
7. [常见问题](#常见问题)

---

## 🏗️ 项目架构概览

```
ai_chat/
├── frontend/              # Vue 3 前端应用
│   ├── src/              # 源代码
│   ├── package.json      # 依赖配置
│   └── vite.config.ts    # Vite 配置
│
├── backend-ts/           # NestJS 后端应用
│   ├── src/              # 源代码
│   ├── prisma/           # Prisma ORM 配置
│   ├── package.json      # 依赖配置
│   └── .env              # 环境变量
│
└── backend/              # Python 后端（备用）
```

### 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| **前端** | Vue 3 | ^3.5.21 |
| | Vite | ^7.3.0 |
| | Pinia | ^3.0.4 |
| | Element Plus | ^2.13.0 |
| | Tailwind CSS | ^4.1.18 |
| **后端** | NestJS | ^11.1.18 |
| | TypeScript | ^6.0.2 |
| | Prisma ORM | ^5.22.0 |
| | Qdrant | ^1.17.0 |
| | SQLite | (通过 Prisma) |

---

## 💻 环境要求

### 必需软件

| 软件 | 最低版本 | 推荐版本 | 说明 |
|------|---------|---------|------|
| Node.js | 18.x | 20.x LTS | JavaScript 运行时 |
| npm | 9.x | 10.x | 包管理器 |
| Docker | 20.x | 最新版 | Qdrant 向量数据库 |
| Git | 2.x | 最新版 | 版本控制 |

### 检查环境

```bash
# 检查 Node.js 版本
node --version

# 检查 npm 版本
npm --version

# 检查 Docker 版本
docker --version
```

---

## 🔧 后端 (backend-ts)

### 1. 安装依赖

```bash
cd backend-ts
npm install
```

### 2. 配置环境变量

编辑 `.env` 文件：

```env
# 数据库配置
DATABASE_URL="file:./dev.db"

# JWT 配置
JWT_SECRET="your-secret-key-change-in-production"

# OpenAI API 配置（可选，用于 LLM 功能）
OPENAI_API_KEY="sk-your-api-key"
OPENAI_BASE_URL="https://api.openai.com/v1"
```

### 3. 初始化数据库

```bash
# 生成 Prisma Client
npx prisma generate

# 创建数据库迁移
npx prisma migrate dev --name init

# （可选）查看数据库
npx prisma studio
```

### 4. 启动 Qdrant 向量数据库

```bash
# Windows
.\start-qdrant.bat

# Linux/Mac
docker run -d \
  --name qdrant \
  -p 6333:6333 \
  -v ./data/qdrant_db:/qdrant/storage \
  qdrant/qdrant
```

验证 Qdrant 是否运行：
```bash
curl http://localhost:6333/collections
```

### 5. 编译和启动

#### 开发模式（推荐）

```bash
# 热重载开发模式
npm run start:dev

# 调试模式
npm run start:debug
```

#### 生产模式

```bash
# 1. 编译 TypeScript
npm run build

# 2. 启动生产服务器
npm run start:prod
```

### 6. 可用脚本

| 命令 | 说明 | 使用场景 |
|------|------|---------|
| `npm run build` | 编译 TypeScript | 生产部署前 |
| `npm run start` | 启动开发服务器 | 快速测试 |
| `npm run start:dev` | 热重载开发模式 | **日常开发** |
| `npm run start:debug` | 调试模式 | 问题排查 |
| `npm run start:prod` | 生产模式 | **生产部署** |

---

## 🎨 前端 (frontend)

### 1. 安装依赖

```bash
cd frontend
npm install
```

### 2. 配置代理

编辑 `vite.config.ts`，确保代理指向正确的后端地址：

```typescript
server: {
  proxy: {
    '/api/v1': {
      target: 'http://localhost:3000', // TS 后端默认端口
      changeOrigin: true,
    },
    '/static': {
      target: 'http://localhost:3000',
      changeOrigin: true
    }
  }
}
```

**注意**: 当前配置指向 `localhost:8800`（Python 后端），如需切换到 TS 后端，请改为 `localhost:3000`。

### 3. 启动开发服务器

```bash
# 开发模式（热重载）
npm run dev

# 访问地址: http://localhost:5173
```

### 4. 构建生产版本

```bash
# 构建优化后的静态文件
npm run build

# 预览生产构建
npm run preview
```

构建产物位于 `dist/` 目录。

### 5. 可用脚本

| 命令 | 说明 | 输出目录 |
|------|------|---------|
| `npm run dev` | 开发服务器 | - |
| `npm run build` | 生产构建 | `dist/` |
| `npm run preview` | 预览构建 | - |

---

## 🚀 开发环境实践

### 推荐工作流程

#### 1. 启动顺序

```bash
# 终端 1: 启动 Qdrant
cd backend-ts
.\start-qdrant.bat

# 终端 2: 启动后端
cd backend-ts
npm run start:dev

# 终端 3: 启动前端
cd frontend
npm run dev
```

#### 2. 开发调试技巧

**后端调试**:
```bash
# 启用详细日志
export DEBUG=*
npm run start:dev

# 使用 VS Code 调试
# 配置 .vscode/launch.json
```

**前端调试**:
- 使用 Vue DevTools 浏览器扩展
- 访问 `http://localhost:5173/__inspect/` 查看模块转换
- 查看 `stats.html` 分析打包体积

#### 3. 数据库管理

```bash
# 可视化数据库
npx prisma studio

# 重置数据库（开发环境）
npx prisma migrate reset

# 创建新迁移
npx prisma migrate dev --name add_xxx_field
```

#### 4. 代码规范

**后端**:
- 遵循 NestJS 模块化架构
- Controller → Service → Repository 分层
- 使用 DTO 进行数据验证

**前端**:
- 使用 Composition API
- 组件按功能组织
- 使用 Pinia 管理状态

---

## 🌐 生产环境部署

### 方案一：传统服务器部署（推荐）

#### 1. 服务器要求

- **操作系统**: Ubuntu 20.04+ / CentOS 8+
- **CPU**: 2+ 核心
- **内存**: 4GB+ RAM
- **存储**: 20GB+ SSD
- **网络**: 公网 IP + 域名

#### 2. 安装依赖

```bash
# 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 安装 Nginx
sudo apt-get install nginx
```

#### 3. 部署后端

```bash
# 上传代码到服务器
scp -r backend-ts/ user@server:/opt/ai-chat/

# 服务器上执行
cd /opt/ai-chat/backend-ts

# 安装依赖
npm ci --production

# 配置环境变量
cp .env.example .env
nano .env  # 编辑生产配置

# 初始化数据库
npx prisma generate
npx prisma migrate deploy

# 启动 Qdrant
docker run -d \
  --name qdrant \
  --restart always \
  -p 6333:6333 \
  -v ./data/qdrant_db:/qdrant/storage \
  qdrant/qdrant

# 使用 PM2 管理进程
npm install -g pm2
pm2 start npm --name "ai-chat-backend" -- run start:prod
pm2 save
pm2 startup
```

#### 4. 部署前端

```bash
# 本地构建
cd frontend
npm run build

# 上传到服务器
scp -r dist/ user@server:/var/www/ai-chat/

# 配置 Nginx
sudo nano /etc/nginx/sites-available/ai-chat
```

**Nginx 配置示例**:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /var/www/ai-chat;
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 代理
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # 静态资源代理
    location /static/ {
        proxy_pass http://localhost:3000;
    }

    # SSE 流式响应支持
    location /api/v1/chat/completions {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

```bash
# 启用站点
sudo ln -s /etc/nginx/sites-available/ai-chat /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# 配置 HTTPS（Let's Encrypt）
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

#### 5. 进程管理

**使用 PM2 管理后端**:

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs ai-chat-backend

# 重启服务
pm2 restart ai-chat-backend

# 监控
pm2 monit
```

**配置自动重启**:

```bash
# 创建 ecosystem.config.js
module.exports = {
  apps: [{
    name: 'ai-chat-backend',
    script: 'npm',
    args: 'run start:prod',
    cwd: '/opt/ai-chat/backend-ts',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
    }
  }]
};
```

### 方案二：Docker Compose 部署

创建 `docker-compose.yml`:

```yaml
version: '3.8'

services:
  # Qdrant 向量数据库
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - ./data/qdrant_db:/qdrant/storage
    restart: always

  # 后端服务
  backend:
    build:
      context: ./backend-ts
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=file:./dev.db
      - JWT_SECRET=${JWT_SECRET}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - qdrant
    volumes:
      - ./backend-ts/data:/app/data
      - ./backend-ts/static:/app/static
    restart: always

  # 前端服务（Nginx）
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - backend
    restart: always

volumes:
  qdrant_data:
```

**启动命令**:

```bash
docker-compose up -d
```

### 方案三：云平台部署

#### Vercel + Railway

1. **前端部署到 Vercel**:
   ```bash
   vercel deploy
   ```

2. **后端部署到 Railway**:
   - 连接 GitHub 仓库
   - 设置环境变量
   - 自动部署

#### AWS / Azure / GCP

使用各自的容器服务或虚拟机部署，参考方案一的步骤。

---

## ⚙️ 环境变量配置

### 后端环境变量 (.env)

```env
# 数据库
DATABASE_URL="file:./dev.db"

# JWT
JWT_SECRET="your-super-secret-key-min-32-chars"
JWT_EXPIRES_IN="7d"

# OpenAI
OPENAI_API_KEY="sk-xxx"
OPENAI_BASE_URL="https://api.openai.com/v1"

# 服务器
PORT=3000
NODE_ENV=production

# 文件上传
MAX_FILE_SIZE=52428800  # 50MB
UPLOAD_DIR=./static/uploads
```

### 前端环境变量 (.env.production)

```env
VITE_API_BASE_URL=/api/v1
VITE_APP_TITLE=AI Chat
```

---

## 🔍 常见问题

### 1. 端口冲突

**问题**: `Error: listen EADDRINUSE: address already in use :::3000`

**解决**:
```bash
# 查找占用端口的进程
lsof -i :3000  # Linux/Mac
netstat -ano | findstr :3000  # Windows

# 杀死进程
kill -9 <PID>  # Linux/Mac
taskkill /F /PID <PID>  # Windows
```

### 2. Prisma 错误

**问题**: `Prisma Client could not be generated`

**解决**:
```bash
# 重新生成
npx prisma generate

# 清理缓存
rm -rf node_modules/.prisma
npx prisma generate
```

### 3. Qdrant 连接失败

**问题**: `Failed to connect to Qdrant`

**解决**:
```bash
# 检查容器状态
docker ps | grep qdrant

# 查看日志
docker logs qdrant

# 重启容器
docker restart qdrant
```

### 4. 前端代理错误

**问题**: `Proxy error: Could not proxy request`

**解决**:
- 确认后端正在运行
- 检查 `vite.config.ts` 中的代理配置
- 确认端口号正确

### 5. 构建失败

**问题**: TypeScript 编译错误

**解决**:
```bash
# 清理构建缓存
rm -rf dist
rm -rf node_modules/.cache

# 重新安装依赖
npm ci

# 重新构建
npm run build
```

### 6. 内存不足

**问题**: `JavaScript heap out of memory`

**解决**:
```bash
# 增加 Node.js 内存限制
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

---

## 📊 性能优化建议

### 后端优化

1. **数据库索引**: 确保常用查询字段有索引
2. **连接池**: 配置适当的数据库连接池大小
3. **缓存**: 使用 Redis 缓存频繁查询
4. **压缩**: 启用 Gzip 压缩

### 前端优化

1. **代码分割**: 使用动态导入
2. **懒加载**: 路由级别懒加载
3. **图片优化**: 使用 WebP 格式
4. **CDN**: 静态资源使用 CDN

### 监控

1. **日志**: 集中日志管理（ELK Stack）
2. **指标**: Prometheus + Grafana
3. **告警**: 设置关键指标告警
4. **APM**: New Relic / Datadog

---

## 🔒 安全建议

1. **HTTPS**: 始终使用 HTTPS
2. **环境变量**: 不要硬编码敏感信息
3. **CORS**: 配置严格的 CORS 策略
4. **速率限制**: 防止 API 滥用
5. **输入验证**: 前后端都进行验证
6. **定期更新**: 保持依赖最新

---

## 📞 技术支持

遇到问题时：

1. 查看日志: `pm2 logs` / `docker logs`
2. 检查文档: 项目 README
3. 搜索 Issue: GitHub Issues
4. 联系团队: 内部技术支持

---

**最后更新**: 2026-04-05  
**维护者**: AI Chat Team
