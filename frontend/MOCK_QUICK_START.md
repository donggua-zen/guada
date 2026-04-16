# 前端 Mock 测试方案使用指南

## 📋 概述

本方案提供了一套完整的前端 Mock 测试基础设施，具有以下特点：

### ✅ 核心优势

1. **生产环境零影响**：生产环境完全跳过 Mock 逻辑，无任何性能开销
2. **接口兼容**：保持 `export const apiService` 不变，所有现有导入无需修改
3. **无全局注入**：不需要修改 main.js，不需要 provide/inject
4. **按需加载**：Mock 模块仅在开发环境且启用 Mock 时才动态导入
5. **灵活切换**：支持环境变量和运行时两种切换方式

## 🚀 快速开始

### 方式一：环境变量配置（推荐）

1. 在项目根目录创建 `.env.local` 文件：

```bash
# 启用 Mock 模式
VITE_ENABLE_MOCK=true

# 选择预设场景
VITE_MOCK_SCENARIO=NORMAL_TEXT
```

2. 重启开发服务器：

```bash
npm run dev
```

### 方式二：运行时动态切换

在开发环境中，点击右下角的 🎭 浮动按钮打开 Mock 控制面板，可以：
- 开启/关闭 Mock 模式
- 选择不同的测试场景
- 查看当前配置
- 应用更改并刷新页面

**注意**：动态切换后，API Service 会自动重新初始化，但为了确保所有组件都使用新的实例，建议刷新页面。

## 🎭 预设场景

| 场景名称 | 说明 | 适用测试 |
|---------|------|----------|
| `NORMAL_TEXT` | 正常文本输出 | 基础流式显示 |
| `WITH_THINKING` | 包含思考过程 | Thinking UI、计时器 |
| `WITH_TOOL_CALLS` | 工具调用 | 工具调用展示 |
| `THINKING_AND_TOOLS` | 思考+工具调用 | 复杂交互流程 |
| `ERROR_TIMEOUT` | 超时错误 | 错误处理、重试机制 |
| `ERROR_API` | API 错误 | 错误提示、恢复策略 |
| `LONG_TEXT` | 长文本输出 | ScrollContainer 自动滚动 |

### 再生模式支持

Mock 服务完全支持后端的三种再生模式：

1. **overwrite**（默认）：删除旧消息，创建新消息
   - `create` 事件返回新的 `messageId`
   
2. **multi_version**：保留旧消息，创建新版本
   - `create` 事件返回传入的 `assistantMessageId`
   - 与后端行为完全一致
   
3. **append**：追加新模式
   - `create` 事件返回新的 `messageId`

## 📦 架构设计

### Mock 拦截的方法

在 Mock 模式下，以下方法会被拦截，**不会实际请求后端**：

1. **`chat()`** - 流式对话接口
   - 模拟 LLM 的流式输出
   - 支持 thinking、tool_calls 等高级特性
   - 完全符合 SSE 格式

2. **`createMessage()`** - 创建用户消息
   - 模拟消息创建过程
   - 返回符合后端格式的 mock 消息对象
   - 包含 100ms 模拟延迟

### 未被 Mock 的方法

其他 API 方法（如 `getProfile`、`login`、`getSessions` 等）仍然会调用真实后端。

如需完全离线测试，可以考虑：
- 使用浏览器缓存
- 配置本地代理服务器
- 扩展 Mock 覆盖更多方法

### 文件结构

```
frontend/src/services/
├── ApiService.ts              # 原始 API Service + Mock 集成
└── mockStreamService.ts       # Mock 流式服务（纯函数）

frontend/src/components/dev/
└── MockControlPanel.vue       # Mock 测试面板（仅开发环境）

frontend/.env.mock             # Mock 配置示例
frontend/MOCK_QUICK_START.md   # 本文档
```

### 工作流程

```
应用启动
  ↓
ApiService.ts 初始化
  ↓
检查环境 (PROD/DEV)
  ↓
├─ 生产环境 → 直接返回真实 ApiService
└─ 开发环境
     ↓
  检查 VITE_ENABLE_MOCK
     ↓
  ├─ false → 返回真实 ApiService
  └─ true  → 创建包装实例（仅覆盖 chat 方法）
```

## 🔧 配置选项

### 环境变量

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `VITE_ENABLE_MOCK` | boolean | false | 是否启用 Mock 模式 |
| `VITE_MOCK_SCENARIO` | string | - | 预设场景名称 |
| `VITE_MOCK_CUSTOM_CONFIG` | JSON | - | 自定义配置（JSON 字符串） |

### MockConfig 选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enableThinking` | boolean | false | 是否启用思考过程 |
| `enableToolCalls` | boolean | false | 是否启用工具调用 |
| `chunkDelay` | number | 50 | 每个文本块之间的延迟（毫秒） |
| `thinkingDelay` | number | 800 | 思考过程的延迟（毫秒） |
| `toolCallDelay` | number | 1500 | 工具调用的延迟（毫秒） |
| `errorType` | string | 'none' | 错误类型：'none' \| 'timeout' \| 'network_error' \| 'api_error' |
| `errorAtChunk` | number | -1 | 在第几个 chunk 后触发错误 |
| `customText` | string | - | 自定义文本内容 |
| `customThinking` | string | - | 自定义思考内容 |
| `customToolCalls` | array | - | 自定义工具调用 |

## 🧪 测试用例示例

### 测试 ScrollContainer 自动滚动

```bash
# .env.local
VITE_ENABLE_MOCK=true
VITE_MOCK_SCENARIO=LONG_TEXT
```

这将生成一段较长的文本，您可以观察 ScrollContainer 是否正确自动滚动到底部。

### 测试 Thinking UI 状态

```bash
# .env.local
VITE_ENABLE_MOCK=true
VITE_MOCK_SCENARIO=WITH_THINKING
```

验证思考状态的 UI 显示、计时器等功能。

### 测试错误处理

```bash
# 测试超时错误
VITE_MOCK_SCENARIO=ERROR_TIMEOUT

# 测试 API 错误
VITE_MOCK_SCENARIO=ERROR_API
```

验证错误提示、重试机制等。

### 测试工具调用流程

```bash
# .env.local
VITE_ENABLE_MOCK=true
VITE_MOCK_SCENARIO=WITH_TOOL_CALLS
```

验证工具调用的 UI 展示、参数解析等。

## 🔄 切换真实/ Mock 模式

### 方法一：修改环境变量

编辑 `.env.local`：

```bash
# 切换到真实后端
VITE_ENABLE_MOCK=false

# 切换到 Mock 模式
VITE_ENABLE_MOCK=true
```

然后重启开发服务器。

### 方法二：使用 Mock 控制面板

1. 点击右下角 🎭 浮动按钮
2. 切换 Mock 开关
3. 选择场景
4. 点击"应用并刷新"

## 📝 注意事项

1. **仅在开发环境使用**：Mock 模式仅用于前端开发和测试，生产环境应始终使用真实后端。

2. **清除缓存**：切换 Mock 模式后，建议清除浏览器缓存或硬刷新（Ctrl+Shift+R）。

3. **TypeScript 类型**：Mock Service 完全兼容原有的 TypeScript 类型定义，不会影响类型检查。

4. **性能考虑**：Mock 模式会引入额外的延迟以模拟真实网络环境，如需快速测试可减小 `chunkDelay` 值。

5. **生产环境保护**：通过 `import.meta.env.PROD` 判断，生产环境直接返回真实 ApiService，Mock 代码不会被执行。

## 🐛 常见问题

### Q: Mock 模式没有生效？

A: 请检查：
1. `.env.local` 文件是否存在且配置正确
2. 是否重启了开发服务器
3. 浏览器控制台是否有 "🎭 开发环境：使用 Mock API Service" 日志

### Q: 切换场景时报错 "require is not defined"？

A: 这个问题已经修复！Vite 环境不支持 `require()`，已改用动态 `import()`。
- 原因：Vite 使用 ES Modules，不支持 CommonJS 的 `require`
- 解决：使用 `await import()` 动态加载模块
- 确保您的代码是最新版本

### Q: 启用 Mock 后出现 "xxx is not a function" 错误？

A: 这个问题已经修复！确保您的代码是最新版本。
- 原因：展开运算符不会复制原型链上的方法
- 解决：使用 `Object.create` 保持原型链继承
- 详情：查看 `MOCK_PROTOTYPE_FIX.md`

### Q: 如何自定义文本内容？

A: 有三种方式：
1. 修改 `mockStreamService.ts` 中的预设场景
2. 使用 `VITE_MOCK_CUSTOM_CONFIG` 环境变量
3. 通过 Mock 控制面板选择场景

### Q: Mock 数据会影响真实数据吗？

A: 不会。Mock 模式完全独立，不会影响后端数据库或真实 API 调用。

### Q: 生产环境会打包 Mock 代码吗？

A: 不会。通过以下条件保障：
- `import.meta.env.PROD` 判断，生产环境不执行 Mock 逻辑
- 动态 `import()` 确保 Mock 模块仅在需要时加载
- Tree-shaking 会自动移除未使用的代码

## 📚 相关文件

- `frontend/src/services/ApiService.ts` - API Service 主文件（含 Mock 集成）
- `frontend/src/services/mockStreamService.ts` - Mock 流式服务核心实现
- `frontend/src/components/dev/MockControlPanel.vue` - Mock 测试面板
- `frontend/.env.mock` - Mock 配置示例
- `frontend/MOCK_QUICK_START.md` - 本文档

## 🤝 贡献

欢迎提交新的预设场景或改进现有功能！
