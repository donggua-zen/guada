# GuaDa AI Docker 快速开始

## 5 分钟快速部署

### 1️⃣ 前置检查

```bash
# 确认 Docker 已安装
docker --version
docker-compose --version
```

### 2️⃣ 配置环境变量

```bash
# 复制配置文件（位于 backend-ts 目录下）
cp backend-ts/.env.example backend-ts/.env

# 编辑并修改 JWT_SECRET（必须！）
nano backend-ts/.env
```

```bash
JWT_SECRET=your-super-secret-key-change-this
```

### 3️⃣ 一键部署

```bash
# Linux/macOS
chmod +x deploy.sh
./deploy.sh

# Windows
deploy.bat
```

### 4️⃣ 访问应用

- 🌐 **前端**: http://localhost:8787 （如无法访问，尝试 http://127.0.0.1:8787）
- 🔧 **后端 API**: http://localhost:8787/api/v1 （通过 Nginx 代理）

> 💡 **提示**：默认配置下后端端口不暴露。如需直接访问后端（调试用），请查看 [完整文档](docs/DOCKER_DEPLOYMENT.md) 中的「如何开启后端端口」章节。

默认账户：`guada` / `guada`

---

## 常用命令速查

### 启动与停止

```bash
docker-compose up -d          # 启动服务
docker-compose down           # 停止服务
docker-compose restart        # 重启所有服务
docker-compose restart backend # 重启后端
```

### 查看状态

```bash
docker-compose ps             # 查看服务状态
docker stats                  # 查看资源使用
docker-compose logs -f        # 查看日志
```

### 数据库管理

```bash
# 备份数据库
docker cp guada-backend:/app/data/ai_chat.db ./backup.db

# 恢复数据库
docker cp ./backup.db guada-backend:/app/data/ai_chat.db
docker-compose restart backend
```

### 进入容器

```bash
docker-compose exec backend sh   # 进入后端容器
docker-compose exec frontend sh  # 进入前端容器
```

### 更新部署

```bash
git pull                        # 拉取最新代码
docker-compose build --no-cache # 重新构建
docker-compose up -d            # 重新启动
```

---

## 故障排查

### 容器无法启动

```bash
docker-compose logs backend     # 查看详细日志
docker-compose ps               # 检查服务状态
```

### 端口冲突

```bash
# 修改 docker-compose.yml 中的端口
ports:
  - "3001:3000"  # 改为其他端口
```

### 重置所有数据

```bash
docker-compose down -v          # ⚠️ 删除所有数据
docker-compose up -d            # 重新初始化
```

---

## 更多信息

详细文档请查看：[Docker 部署完整指南](DOCKER_DEPLOYMENT.md)

技术支持 QQ 群：1047993501
