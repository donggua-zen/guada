# Browser Bridge 使用指南

## 概述

Browser Bridge 提供两种通信模式，用于 Electron 和 Backend 之间的浏览器自动化功能通信。

## 通信模式

### 1. TCP 模式（开发环境默认）

**适用场景**：开发调试、热重载

**特点**：
- ✅ 支持 `ts-node-dev` 热重载
- ✅ 独立进程，不受 Electron 生命周期影响
- ✅ 易于调试（可用 Postman/curl 测试）

**配置**：
```bash
# 环境变量（自动设置，无需手动配置）
BROWSER_BRIDGE_MODE=tcp
BROWSER_BRIDGE_PORT=3001
```

**启动流程**：
1. Electron 启动 TCP Server 监听 `http://127.0.0.1:3001/browser-tool`
2. Backend 通过 HTTP POST 发送请求
3. Electron 处理请求并返回 JSON 响应

### 2. IPC 模式（生产环境默认）

**适用场景**：生产打包、最高安全性

**特点**：
- ✅ 绝对安全（进程级别隔离）
- ✅ 零网络开销（内存级别通信）
- ✅ 无端口冲突风险

**配置**：
```bash
# 环境变量（自动设置，无需手动配置）
BROWSER_BRIDGE_MODE=ipc
```

**启动流程**：
1. Electron 启动时初始化 IPC 监听器
2. Backend 通过 `process.send()` 发送请求
3. Electron 通过 `process.on('message')` 接收并处理

## 环境变量说明

| 变量名 | 可选值 | 默认值 | 说明 |
|--------|--------|--------|------|
| `BROWSER_BRIDGE_MODE` | `tcp` / `ipc` | 开发:`tcp`, 生产:`ipc` | 通信模式 |
| `BROWSER_BRIDGE_PORT` | 任意端口号 | `3001` | TCP 模式下的端口号 |
| `ELECTRON_APP` | `true` / `false` | - | 标识是否在 Electron 环境中 |

## 调试方法

### 开发模式调试

1. **启动应用**：
   ```bash
   npm run dev:electron
   ```

2. **查看日志**：
   - Electron 日志：控制台输出
   - Backend 日志：`backend-ts/logs/`

3. **测试 TCP 连接**：
   ```bash
   curl -X POST http://127.0.0.1:3001/browser-tool \
     -H "Content-Type: application/json" \
     -d '{"id":"test","method":"navigate","params":{"url":"https://example.com"}}'
   ```

4. **修改代码**：
   - 修改 Backend 代码会自动热重载
   - 修改 Electron 代码需要重启应用

### 生产模式调试

1. **构建应用**：
   ```bash
   npm run build:electron
   ```

2. **强制使用 IPC 模式**：
   ```bash
   BROWSER_BRIDGE_MODE=ipc npm run start:electron
   ```

3. **查看日志**：
   - Electron 日志：用户数据目录下的日志文件
   - Backend 日志：用户数据目录下的 `logs/` 文件夹

## 工具列表

Browser Bridge 提供以下工具：

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `navigate` | 导航到指定 URL | `url`, `window_id?` |
| `execute_js` | 执行 JavaScript | `code`, `window_id?` |
| `screenshot` | 截取页面截图 | `window_id?` |
| `get_page_content` | 获取页面内容 | `selector?`, `window_id?` |
| `go_back` | 浏览器后退 | `window_id?` |
| `go_forward` | 浏览器前进 | `window_id?` |
| `reload` | 刷新页面 | `window_id?` |
| `click` | 点击元素 | `selector`, `window_id?` |
| `fill_input` | 填写输入框 | `selector`, `value`, `window_id?` |
| `open_new_window` | 打开新窗口 | `url?` |
| `close_window` | 关闭窗口 | `window_id` |

## 常见问题

### Q1: 开发模式下 Browser Bridge 无法连接？

**检查清单**：
1. 确认 `BROWSER_BRIDGE_MODE=tcp`
2. 确认端口未被占用：`netstat -ano | findstr :3001`
3. 查看 Electron 日志是否有 "Browser Bridge TCP started"

### Q2: 生产模式下 Browser Bridge 不可用？

**可能原因**：
1. 未设置 `ELECTRON_APP=true`
2. IPC 通道未正确初始化
3. 检查 Backend 日志是否有 "No IPC channel available"

### Q3: 如何切换通信模式？

**方法**：
```bash
# 强制使用 TCP
BROWSER_BRIDGE_MODE=tcp npm run dev:electron

# 强制使用 IPC
BROWSER_BRIDGE_MODE=ipc npm run dev:electron
```

## 安全说明

- **TCP 模式**：仅监听 `127.0.0.1`，外部无法访问
- **IPC 模式**：完全进程隔离，最安全
- **无痕浏览**：所有窗口关闭后自动清除数据
- **超时清理**：30分钟无活动自动关闭窗口

## 性能优化建议

1. **复用窗口**：使用 `window_id` 参数复用已有窗口
2. **及时关闭**：不需要的窗口调用 `close_window`
3. **避免并发**：同一时间不要打开过多窗口
4. **合理超时**：长时间操作设置合适的超时时间
