# 日志系统配置说明

## 📁 日志存储位置

### Electron 环境下（开发和生产）

所有日志统一存储在**用户数据目录**中，确保应用更新时不会丢失：

```
Windows: %APPDATA%/GuaDa/
├── logs/                    # 后端日志目录（Winston）
│   ├── error-2026-04-29.log
│   ├── warn-2026-04-29.log
│   ├── combined-2026-04-29.log
│   └── *.gz                 # 压缩的旧日志
├── main.log                 # Electron 主进程日志（electron-log）
├── ai_chat.db               # 数据库文件
├── vector_db.sqlite         # 向量数据库
└── file_stores/             # 用户上传文件
```

### 独立运行后端（非 Electron）

如果直接运行 `npm run start:dev` 或 `npm run start:prod`：

```
backend-ts/logs/             # 默认在项目根目录下
├── error-YYYY-MM-DD.log
├── warn-YYYY-MM-DD.log
└── combined-YYYY-MM-DD.log
```

可通过环境变量自定义：
```bash
LOGS_DIR=/custom/path npm run start:prod
```

---

## 🔧 环境变量配置

| 变量名 | 说明 | Electron 环境 | 独立后端 |
|--------|------|--------------|---------|
| `LOGS_DIR` | 后端日志目录 | ✅ 自动设置为 `userData/logs` | 可选，默认为 `backend-ts/logs` |
| `SETTINGS_DIR` | 设置文件目录 | ✅ 自动设置为 `userData` | 可选 |
| `UPLOAD_ROOT_DIR` | 上传文件目录 | ✅ 自动设置为 `userData/file_stores` | 可选 |

---

## 📊 日志轮转策略

### 后端日志（Winston）

| 日志类型 | 文件名格式 | 保留时间 | 单文件大小限制 | 压缩 |
|---------|-----------|---------|---------------|------|
| 错误日志 | `error-YYYY-MM-DD.log` | 7天 | 20MB | ✅ |
| 警告日志 | `warn-YYYY-MM-DD.log` | 7天 | 30MB | ✅ |
| 综合日志 | `combined-YYYY-MM-DD.log` | 14天 | 50MB | ✅ |

### Electron 主进程日志（electron-log）

- 文件位置：`userData/main.log`
- 最大大小：50MB
- 自动轮转：内置管理

---

## ⚠️ 重要提示

1. **用户数据持久化**：所有日志、数据库、上传文件都存储在用户数据目录，应用更新（覆盖安装）时**不会丢失**。

2. **磁盘空间管理**：
   - Winston 会自动清理超过保留天数的日志
   - 单个日志文件达到大小限制后会自动创建新文件
   - 旧日志会自动压缩为 `.gz` 格式节省空间

3. **手动清理**：如需手动清理日志，可安全删除 `logs/` 目录下的所有文件（不会影响应用运行）。

4. **调试技巧**：
   ```bash
   # Windows 快速打开日志目录
   explorer %APPDATA%\GuaDa\logs
   
   # macOS
   open ~/Library/Logs/GuaDa
   
   # Linux
   xdg-open ~/.config/GuaDa/logs
   ```

---

## 🛠️ 自定义配置

如需调整日志策略，修改以下文件：

### 后端日志配置
`backend-ts/src/common/logger/winston.config.ts`

```typescript
// 调整保留天数
maxFiles: '30d', // 改为30天

// 调整文件大小
maxSize: '100m', // 改为100MB

// 禁用压缩（提升性能但占用更多空间）
zippedArchive: false,
```

### Electron 日志配置
`electron/main.ts`

```typescript
log.transports.file.maxSize = 100 * 1024 * 1024 // 改为100MB
log.transports.file.level = 'debug' // 记录更详细的日志
```
