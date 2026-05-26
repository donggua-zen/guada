# Docker 端口配置最佳实践

## 默认配置（推荐）

```yaml
services:
  backend:
    # ports 配置被注释，不暴露后端端口
    # ports:
    #   - "127.0.0.1:3000:3000"
  
  frontend:
    ports:
      - "8787:80"
```

### 优势

✅ **最高安全性** - 后端无法从外部直接访问  
✅ **零端口冲突** - 不占用宿主机端口  
✅ **统一管理** - 所有流量通过 Nginx 反向代理  
✅ **内部通信正常** - 前端仍可通过 Docker 内部网络访问后端  

### 访问方式

- 前端界面：`http://localhost:8787`
- 后端 API：`http://localhost:8787/api/v1`（通过 Nginx 代理）

---

## 按需开启后端端口

### 场景 1：本地调试（推荐）

```yaml
services:
  backend:
    ports:
      - "127.0.0.1:3000:3000"  # 仅本机可访问
```

**适用场景**：
- 开发调试
- API 测试
- 健康检查

**访问地址**：`http://localhost:3000/api/v1`

**安全性**：⭐⭐⭐⭐ 高（仅本地）

---

### 场景 2：公开访问（谨慎使用）

```yaml
services:
  backend:
    ports:
      - "3000:3000"  # 所有网络可访问
```

**适用场景**：
- 第三方系统集成
- 独立的 API 服务
- 微服务架构

**访问地址**：`http://your-server-ip:3000/api/v1`

**安全性**：⭐⭐ 中（需配合防火墙和认证）

**注意事项**：
- ⚠️ 确保 JWT_SECRET 足够强
- ⚠️ 配置防火墙规则
- ⚠️ 启用 HTTPS
- ⚠️ 定期审计访问日志

---

### 场景 3：自定义端口

如果宿主机端口冲突，可以映射到其他端口：

```yaml
services:
  backend:
    ports:
      - "127.0.0.1:3001:3000"  # 宿主机 3001 → 容器 3000
```

**访问地址**：`http://localhost:3001/api/v1`

**注意**：Nginx 配置不需要修改，因为它使用容器内部端口。

---

## 如何切换配置

### 步骤 1：编辑 docker-compose.yml

找到 backend 服务的 ports 配置，根据需要取消注释或修改。

### 步骤 2：重启服务

```bash
# 重启后端服务
docker-compose up -d backend

# 或者重启所有服务
docker-compose up -d
```

### 步骤 3：验证配置

```bash
# 查看端口映射
docker-compose ps

# 测试访问
curl http://localhost:8787/api/v1/health
curl http://localhost:3000/api/v1/health  # 如果开启了后端端口
```

---

## 安全建议

### 1. 生产环境

```yaml
# 推荐：完全不暴露后端端口
backend:
  # ports: []  # 保持注释状态
```

### 2. 开发环境

```yaml
# 推荐：仅本地访问
backend:
  ports:
    - "127.0.0.1:3000:3000"
```

### 3. 必须公开时

```yaml
# 配合以下安全措施
backend:
  ports:
    - "3000:3000"

# 并在 .env 中设置强密钥
JWT_SECRET=<使用 openssl rand -base64 32 生成>
```

---

## 常见问题

### Q1: 不暴露后端端口，前端怎么访问？

A: 前端 Nginx 通过 Docker 内部网络直接访问后端容器，使用的是容器名和容器内部端口：

```nginx
proxy_pass http://backend:3000/api/v1/;
```

这不受宿主机端口配置影响。

### Q2: 如何检查端口是否被占用？

```bash
# Windows
netstat -ano | findstr ":3000"

# Linux/Mac
netstat -tuln | grep 3000
```

### Q3: 多个 Docker 项目会冲突吗？

A: 如果使用默认配置（不暴露后端端口），不会冲突。每个项目的前端都使用自己的容器，互不影响。

### Q4: 开启后端端口后，Nginx 还需要吗？

A: 仍然需要。Nginx 提供：
- 静态文件服务
- HTTPS 支持
- Gzip 压缩
- 缓存控制
- 统一入口

即使开启了后端端口，也建议通过 Nginx 访问。

---

## 总结

| 配置方式 | 安全性 | 便利性 | 适用场景 |
|---------|--------|--------|---------|
| 不暴露端口 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 生产环境（推荐） |
| 仅本地访问 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 开发调试 |
| 公开访问 | ⭐⭐ | ⭐⭐⭐⭐⭐ | 特殊需求 |

**最佳实践**：默认不暴露，按需开启，用后即关。
