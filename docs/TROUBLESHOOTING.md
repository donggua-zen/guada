# GuaDa AI 故障排查指南

本文档提供常见问题及其解决方案，帮助快速定位和解决部署过程中遇到的问题。

---

## 目录

- [数据库问题](#数据库问题)
- [Prisma 相关问题](#prisma-相关问题)
- [端口与网络问题](#端口与网络问题)
- [环境变量问题](#环境变量问题)
- [权限问题](#权限问题)
- [构建与启动问题](#构建与启动问题)
- [SSE 流式传输问题](#sse-流式传输问题)
- [日志查看与调试](#日志查看与调试)
- [后端进程静默死亡（dev 环境）](#后端进程静默死亡dev-环境)

---

## 数据库问题

### 1. 数据库表不存在

**症状**：
```
Error: Table 'User' does not exist in the database
```

**原因**：
- 数据库文件存在但表结构未初始化
- 连接到了错误的数据库文件

**解决方案**：

```bash
cd backend-ts

# 方法一：重新初始化（会清空数据）
pnpm run db:seed:force

# 方法二：仅同步表结构（保留数据）
npx prisma db push

# 验证数据库
pnpm run db:verify
```

**预防措施**：
- 确保 `DATABASE_URL` 配置正确
- 检查所有配置文件中的路径是否一致

---

### 2. 数据库锁定错误

**症状**：
```
SqliteError: database is locked
```

**原因**：
- 多个进程同时访问数据库
- 之前的进程未正常关闭

**解决方案**：

```bash
# 查找并杀死占用数据库的进程
lsof backend-ts/data/ai_chat.db
kill -9 <PID>

# 或删除锁文件（SQLite 自动管理，通常不需要手动删除）
rm backend-ts/data/ai_chat.db-shm
rm backend-ts/data/ai_chat.db-wal
```

---

### 3. 数据库路径不一致

**症状**：
- 种子脚本执行成功，但后端启动后找不到数据
- 不同操作连接到不同的数据库文件

**原因**：
项目中存在多个数据库路径配置，如果不设置环境变量会导致路径不一致。

**解决方案**：

确保所有地方使用统一的数据库路径：

1. **检查 `.env` 文件**：
   ```ini
   DATABASE_URL="file:./data/ai_chat.db"
   ```

2. **验证 PrismaService**：
   ```typescript
   // src/common/database/prisma.service.ts
   const databaseUrl = configService.get<string>("DATABASE_URL") || "file:./data/ai_chat.db";
   ```

3. **验证 prisma.config.ts**：
   ```typescript
   url: process.env["DATABASE_URL"] || "file:./data/ai_chat.db"
   ```

4. **验证 seed.ts**：
   ```typescript
   const databaseUrl = process.env.DATABASE_URL || "file:./data/ai_chat.db";
   ```

**最佳实践**：始终设置 `DATABASE_URL` 环境变量，不要依赖默认值。

---

## Prisma 相关问题

### 4. Prisma Client 未生成

**症状**：
```
error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.
```

**原因**：
- 安装依赖后未执行 `prisma generate`
- `postinstall` 脚本失败

**解决方案**：

```bash
cd backend-ts

# 手动生成 Prisma Client
npx prisma generate

# 验证生成结果
ls node_modules/@prisma/client
```

**预防措施**：

在 `package.json` 中添加 `postinstall` 脚本（已完成）：
```json
{
  "scripts": {
    "postinstall": "prisma generate"
  }
}
```

这样每次执行 `pnpm install` 时会自动生成客户端。

---

### 5. Prisma Schema 变更未应用

**症状**：
- 代码中使用了新字段，但运行时提示字段不存在
- 迁移失败

**解决方案**：

```bash
cd backend-ts

# 开发环境：直接推送变更
npx prisma db push

# 生产环境：使用迁移
npx prisma migrate deploy
```

**注意**：
- `db push` 适用于开发环境，不生成迁移文件
- `migrate deploy` 适用于生产环境，按顺序应用迁移文件

---

## 端口与网络问题

### 6. 端口被占用

**症状**：
```
Error: listen EADDRINUSE: address already in use :::3000
```

**解决方案**：

```bash
# 方法一：查找并杀死占用端口的进程
# Linux/macOS
lsof -i :3000
kill -9 <PID>

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# 方法二：更换端口
export PORT=3001
pnpm run start:dev
```

**预防措施**：

在启动前检查端口：
```bash
# Linux/macOS
ss -tlnp | grep 3000

# Windows
netstat -an | findstr 3000
```

---

### 7. 前端无法连接后端 API

**症状**：
- 浏览器控制台显示 CORS 错误或 404
- API 请求失败

**原因**：
- 后端未启动或端口不正确
- Vite Proxy 配置仅在开发模式有效
- 生产环境缺少反向代理配置

**解决方案**：

**开发环境**：
1. 确认后端运行在 `http://localhost:3000`
2. 检查 `frontend/vite.config.ts` 中的 proxy 配置

**生产环境**：
1. 配置 Nginx 反向代理（见[生产部署文档](PRODUCTION_DEPLOYMENT.md)）
2. 或在前端设置 `VITE_API_BASE_URL` 环境变量

```bash
# 前端 .env.production
VITE_API_BASE_URL=https://api.yourdomain.com
```

---

## 环境变量问题

### 8. 环境变量未加载

**症状**：
- 使用默认配置而非 `.env` 中的配置
- 连接到错误的数据库

**解决方案**：

```bash
# 1. 确认 .env 文件存在
ls -la backend-ts/.env

# 2. 检查文件格式（不能有 BOM 或特殊字符）
cat backend-ts/.env | head -n 5

# 3. 验证 dotenv 是否正确加载
node -e "require('dotenv').config(); console.log(process.env.DATABASE_URL)"

# 4. PM2 环境中手动传递环境变量
pm2 start dist/main.js --name guada-backend --env production
```

**常见错误**：

❌ 错误写法：
```ini
DATABASE_URL = "file:./data/ai_chat.db"  # 等号两边有空格
```

✅ 正确写法：
```ini
DATABASE_URL="file:./data/ai_chat.db"
```

---

### 9. JWT_SECRET 未配置

**症状**：
- 登录成功后无法保持会话
- Token 验证失败

**解决方案**：

```bash
# 生成强随机密钥
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 复制到 .env
JWT_SECRET="生成的密钥"
```

**安全提醒**：
- 生产环境务必修改默认的 JWT_SECRET
- 不要将 `.env` 文件提交到 Git

---

## 权限问题

### 10. Nginx Permission Denied

**症状**：
- Nginx 返回 500 错误
- 错误日志显示 `Permission denied`

**原因**：
- 项目部署在 `/root` 目录下
- Nginx worker 进程以 `www-data` 用户运行，无权访问

**解决方案**：

```bash
# 方法一：移动项目到公共目录（推荐）
sudo mv /root/guada-ai /opt/guada-ai
sudo chown -R $USER:$USER /opt/guada-ai

# 方法二：修改 Nginx 用户（不推荐）
# 编辑 /etc/nginx/nginx.conf
# user root;
```

**正确的部署路径**：
- `/opt/guada-ai`
- `/var/www/guada-ai`
- `/home/deploy/guada-ai`

**避免的路径**：
- ❌ `/root/...`
- ❌ `/home/<user>/...` （除非 Nginx 以该用户运行）

---

### 11. 上传文件权限不足

**症状**：
- 文件上传失败
- 错误：`EACCES: permission denied`

**解决方案**：

```bash
# 确保上传目录存在且可写
mkdir -p backend-ts/data/uploads
chmod -R 755 backend-ts/data/uploads

# 如果使用 PM2，确保运行用户有权限
sudo chown -R $(whoami):$(whoami) backend-ts/data
```

---

## 构建与启动问题

### 12. TypeScript 编译错误

**症状**：
```
error TS2307: Cannot find module 'xxx'
```

**解决方案**：

```bash
cd backend-ts

# 清理并重新安装
rm -rf node_modules package-lock.json
pnpm install

# 重新构建
pnpm run build
```

---

### 13. 原生模块 ABI 版本不匹配

**症状**：
```
Error: The module 'better-sqlite3.node' was compiled against a different Node.js version
```

**原因**：
Node.js 版本升级后，原生模块需要重新编译。

**解决方案**：

```bash
cd backend-ts

# 重新编译原生模块
npm rebuild better-sqlite3

# 或全部重建
npm rebuild
```

**Electron 环境**：
```bash
pnpm run rebuild:electron
```

---

### 14. 内存溢出

**症状**：
```
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed
```

**解决方案**：

```bash
# 增加 Node.js 内存限制
NODE_OPTIONS="--max-old-space-size=4096" pnpm run start:prod

# PM2 配置
pm2 start dist/main.js --name guada-backend --node-args="--max-old-space-size=4096"
```

---

## SSE 流式传输问题

### 15. AI 回复中断

**症状**：
- AI 回复到一半突然停止
- 前端显示 "连接断开"
- 浏览器控制台显示 `504 Gateway Time-out`

**原因**：
- Nginx 代理超时设置过短
- LLM API 响应缓慢或生成时间长
- 复杂任务需要多轮工具调用，总时长超过超时限制

**解决方案**：

**1. 检查 Nginx 错误日志**：
```bash
# 查看是否有超时错误
grep "upstream timed out" /var/log/nginx/guada-error.log

# 查看最近的错误
tail -n 50 /var/log/nginx/guada-error.log
```

**2. 调整 Nginx 流式 API 超时时间**：

编辑 `/etc/nginx/sites-available/guada-ai`，找到流式 API 配置：

```nginx
location /api/v1/chat/completions {
    proxy_pass http://localhost:3000/api/v1/chat/completions;
    
    # 根据实际需求调整超时时间
    proxy_send_timeout 3600s;    # 1 小时
    proxy_read_timeout 3600s;    # 1 小时
    
    # 确保禁用缓冲
    proxy_buffering off;
}
```

**3. 常见超时场景及建议配置**：

| 场景 | 预计时长 | 建议超时 |
|------|---------|----------|
| 简单问答 | < 1 分钟 | 120s |
| 中等长度对话 | 5-15 分钟 | 1800s (30分钟) |
| 长文本生成 | 15-30 分钟 | 3600s (1小时) |
| 复杂多轮工具调用 | 30-60 分钟 | 3600s (1小时) |
| 超长对话/分析 | 1-2 小时 | 7200s (2小时) |

**4. 重新加载 Nginx 配置**：
```bash
sudo nginx -t                    # 测试配置
sudo systemctl reload nginx      # 重新加载
```

**5. 如果仍然超时，考虑优化策略**：
- 使用更快的 LLM 模型
- 优化 Prompt，减少不必要的上下文
- 启用上下文压缩功能
- 将长任务拆分为多个短任务
- 检查后端日志，确认是否有其他瓶颈

---

### 16. SSE 事件格式错误

**症状**：
- 前端无法解析 SSE 事件
- 收到完整响应而非流式数据

**解决方案**：

检查后端响应头：
```typescript
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
```

---

## 日志查看与调试

### 17. 查看后端日志

```bash
# 开发模式（控制台输出）
pnpm run start:dev

# 生产模式（文件日志）
tail -f backend-ts/logs/combined.log
tail -f backend-ts/logs/error.log

# PM2 日志
pm2 logs guada-backend
pm2 logs guada-backend --lines 100
```

### 18. 查看前端日志

```bash
# 浏览器开发者工具
# Console 标签页查看 JavaScript 错误
# Network 标签页查看 API 请求
```

### 19. 查看 Nginx 日志

```bash
# 访问日志
sudo tail -f /var/log/nginx/guada-access.log

# 错误日志
sudo tail -f /var/log/nginx/guada-error.log
```

### 20. 启用调试模式

```bash
# 后端调试模式
pnpm run start:debug

# 然后在 Chrome 中打开 chrome://inspect
# 点击 "Open dedicated DevTools for Node"
```

---

## 后端进程静默死亡（dev 环境）

### 21. 后端过一段时间就访问不了，但没有任何报错

**症状**：

```
[1] 22:15:35.695 > BridgeServer: client disconnected
[1] 22:15:43.911 > Frontend loaded, checking for updates...
```

之后再刷新前端，所有请求报"无法连接到服务器"；后端落盘日志（`~/.guada-dev/logs/combined-*.log`）戛然而止，但控制台没有任何错误输出，也没有弹出"后端异常退出"对话框。

**故障链（2026-09-08 结论，2026-09-21 用退出码修正）**：

1. 真正的 NestJS 子进程（`ts-node-dev` 的 child）突然死亡。`BridgeServer: client disconnected` 表示 named pipe 真正关闭（bridge-server.ts 无心跳机制，只会因进程退出/连接关闭而触发）。
2. `ts-node-dev --respawn` 对子进程死亡的处理是**静默的**（`node_modules/ts-node-dev/lib/index.js` 中 `child.on('exit')` 仅 `child = undefined`）：不打印、不重启，直到下次文件变更（`restart()` 发现 `child` 已空才 `start()`）。注意它与文件变更触发的重启不同——后者会打印 `Restarting, xxx has been modified`。
   推论：死亡后是否自愈，取决于其后有没有文件变更。2026-09-21 06:16 那次 8s 后恢复即属此类；2026-09-20 22:21 那次 20 分钟无人重启。
3. Electron 只监控 npx 包装进程（`electron/main.ts` 的 `backendProcess.on("exit")`），包装进程未退出，因此崩溃弹窗、`backend-crash.log` 都不会触发。
4. ~~指向外部强杀（杀软）~~ —— **该结论已被证据推翻**：三个观测点在 dev 下全部失效，"没有证据"是观测装置坏了，不是死亡方式干净。2026-09-21 06:16 用句柄等待抓到真实退出码 **1**，后端 error 日志同期只有 3 条
   `进程级 uncaughtException: EPIPE: broken pipe, write`（栈顶 `winston/lib/winston/transports/console.js` → `Socket._write`）：
   dev 下后端 stdout 是经 cmd/npx/ts-node-dev 继承的命名管道，包装链断裂后**下一次 console 写入即 EPIPE**，冒泡成 uncaughtException，被 `logFatal` 当作致命错误 `process.exit(1)`——即后端因"日志管道断了"而自杀。已修复：`backend-ts/src/main.ts` 吞掉 stdout/stderr 的 EPIPE/EOF 流错误，不再退出进程。
   注意退出码语义不可反推：
   - `1` 有两种来源 —— `logFatal` 主动退出（error 日志同刻必有「进程级 …」条目），以及 ts-node-dev 热重载/停机时的 `child.kill('SIGTERM')`（Windows 上即 TerminateProcess，退出码也是 1，error 日志无条目；2026-09-21 06:38 改文件触发重启即为此例）；
   - `0` 既可能是优雅 `process.exit(0)`，也可能是外部 `taskkill /F`（TerminateProcess 的退出码由调用方给）；
   - `0xC0000409`（fail-fast）绕过 WER，故"无 WER 事件"不能排除原生崩溃。
5. **切换会话触发的原生崩溃（2026-09-21 07:34 抓到实证）**：句柄监视记录后端 PID 22100 退出码 `-1073741819` = **0xC0000005 STATUS_ACCESS_VIOLATION**，且 Application 日志无 EventID 1000、`CrashDumps` 无 node.exe.dmp、winston 无任何 error 条目 —— 与"死前零输出、不重连、无重启"的历史 Mode B 完全吻合。落盘日志的最后 4 行正是切换会话时的
   `POST /api/v1/sessions/:id/workspace/watch`（两个会话、同一 `workspacePath`，交替各 2 次 → `setWatchScope` → `@parcel/watcher` 在途 subscribe 与 unsubscribe 交叠）。待办：用同形状并发压 `workspace-watcher.service.ts` 复现，并开 `HKCU\...\Windows Error Reporting\LocalDumps` 收 node.exe 用户态 dump 以定位 faulting 模块。


**已内置的观测与取证手段**：

| 手段 | 位置 | 说明 |
| ---- | ---- | ---- |
| 真实进程退出码 | `electron/main.ts` `watchBackendRealExit` / 日志前缀 `[BackendExit]` | 后端经 bridge `port_ready` 上报自身 PID，Electron 起一个 PowerShell 助手 `OpenProcess`+`WaitForSingleObject`+`GetExitCodeProcess` 阻塞等待，死亡时打印退出码及其语义，并写 `backend-crash.log`。10s 内若有新 PID/bridge 重连则判为热重载（info），否则为非预期死亡（error） |
| 健康看门狗 | `electron/main.ts` `startBackendWatchdog` | 15s 探测 `/api/v1/health`，连续 3 次失败写 `[BackendWatchdog]` 错误日志，**含失败原因分类**（连接被拒 / 超时 / HTTP 状态）+ 包装进程与真实进程各自的存活状态。仅记录日志，不自动重启 |
| 诊断报告 | `logs/diagnostic-reports/` | 后端 spawn 注入 `NODE_OPTIONS=--report-on-fatalerror --report-uncaught-exception`。**Node 不会自建 `--report-dir`**，目录缺失时报告被静默丢弃（此前该目录一直不存在，故从未产出一份报告）；现已在 spawn 前 `mkdir -p`。外部强杀与 `process.exit()` 都不产生报告，报告缺失不可作为"他杀"证据 |
| 进程级异常落盘 | `backend-ts/src/main.ts` | `uncaughtException`/`unhandledRejection` 写 winston error 日志后退出；stdout/stderr 的 EPIPE 不再计入致命错误 |
| Bridge 断开时长 | `electron/bridge-server.ts` | `client disconnected` 附带连接时长：秒级+随后 `client authenticated` = 热重载；永不重连 = 进程死亡且无文件变更触发重启 |
| 进程树清理 | `electron/main.ts` `forceKillBackendTree` | 停机时对包装树与真实 PID 分别 `taskkill` 并用 `isPidAlive` 验证，清理不干净会留下 `[BackendStop] 进程树未清理干净` 日志（历史上静默泄漏过 6 套 cmd→npx→ts-node-dev 树） |
| 手工句柄监视 | `scripts/watch-backend-exit.ps1` | 应用未重启时想抓现场：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-backend-exit.ps1 -IntervalSec 3`，自动定位后端孙进程，退出时打印退出码+内存/句柄/线程时间线 CSV |

**事故后取证步骤**：

```bash
# 1. 先看 Electron 侧的定性日志（含真实退出码）
grep -E "BackendExit|BackendStop|BackendWatchdog" ~/AppData/Roaming/guada-dev/logs/main.log
# 2. 后端自身日志：退出码 1 的现场一定在这里
grep -E "进程级|uncaughtException" ~/.guada-dev/logs/error-*.log
# 3. 原生崩溃/OOM 报告（需 dev 重启过一次应用让目录被创建）
ls ~/.guada-dev/logs/diagnostic-reports/
# 4. Windows 事件日志（EventID 1000 = Application Error；fail-fast 不写事件，无记录不等于没崩）
wevtutil qe Application "/q:*[System[(EventID=1000)]]" /rd:true /c:10 /f:text
```

**缓解措施**：dev 下后端死亡后，改任一 backend 文件即可让 ts-node-dev 重启它（或重启应用）。若 `[BackendExit]` 给出 `0xC0000409`/`0xC0000005` 一类原生码且无 WER 记录，再考虑杀软白名单（`D:\AI\ai_chat`、node 安装目录、`npx.cmd`/`ts-node-dev` 相关进程）。

---


创建 `diagnose.sh` 脚本快速检查系统状态：

```bash
#!/bin/bash

echo "=== GuaDa AI 系统诊断 ==="
echo ""

# 1. Node.js 版本
echo "1. Node.js 版本:"
node --version
echo ""

# 2. 检查 .env 文件
echo "2. 环境变量配置:"
if [ -f backend-ts/.env ]; then
    echo "✓ .env 文件存在"
    grep DATABASE_URL backend-ts/.env
else
    echo "✗ .env 文件不存在"
fi
echo ""

# 3. 检查 Prisma Client
echo "3. Prisma Client:"
if [ -d backend-ts/node_modules/@prisma/client ]; then
    echo "✓ Prisma Client 已生成"
else
    echo "✗ Prisma Client 未生成，请运行: npx prisma generate"
fi
echo ""

# 4. 检查数据库文件
echo "4. 数据库文件:"
if [ -f backend-ts/data/ai_chat.db ]; then
    echo "✓ 数据库文件存在"
    ls -lh backend-ts/data/ai_chat.db
else
    echo "✗ 数据库文件不存在，请运行: pnpm run db:seed:force"
fi
echo ""

# 5. 检查端口占用
echo "5. 端口 3000 状态:"
if command -v lsof &> /dev/null; then
    lsof -i :3000 || echo "端口 3000 未被占用"
else
    echo "lsof 命令不可用"
fi
echo ""

# 6. 检查 PM2 状态
echo "6. PM2 进程状态:"
if command -v pm2 &> /dev/null; then
    pm2 list
else
    echo "PM2 未安装"
fi
echo ""

echo "=== 诊断完成 ==="
```

使用方法：
```bash
chmod +x diagnose.sh
./diagnose.sh
```

---

## 获取帮助

如果以上方案无法解决问题：

1. **查看完整日志**：收集后端、前端、Nginx 的完整日志
2. **检查系统信息**：操作系统、Node.js 版本、npm 版本
3. **重现步骤**：详细记录操作步骤
4. **联系支持**：加入 QQ 群 1047993501 寻求技术支持

**提交问题时请提供**：
- 错误日志（脱敏敏感信息）
- 操作系统和 Node.js 版本
- 复现步骤
- 相关配置文件（`.env` 脱敏后）

---

**最后更新**: 2026-05-12
