# 技术债清单

记录已识别、但尚未立项或明确暂缓的问题。每条包含现状、风险、改造方向与关联文件。

约定：

- **待办**：已确认需要处理，等待排期立项。
- **暂缓项**：已确认存在，但当前明确不处理（保留记录以免遗忘）。

---

## 待办

### 1. 外部插件无沙箱隔离

**现状**

外部插件经 `require()` 直接加载进后端主进程，与后端共享同一 Node 运行时和权限：

- 入口解析与加载：[`external-plugin-loader.ts`](../backend-ts/src/modules/plugins/external/external-plugin-loader.ts) —— `requireWithFallback()` 临时 patch `Module._resolveFilename` 把 `backend-ts/node_modules` 作为回退搜索路径，require 完成后恢复；dev 源优先加载 `.ts`，user 源仅加载 `.js`。
- 实例化时**不经过 NestJS DI**（`new PluginClass()`），插件能力只能通过 `onLoad(api)` 的 `PluginApi` 获得，但代码本身不受任何限制。
- 安装/更新/卸载：[`plugin-source.ts`](../backend-ts/src/modules/plugins/external/plugin-source.ts) —— 支持 `github:` / `gitee:` / `git:` / `local:` 分发源，git 源走 `git clone`。

**风险**

插件代码拥有与后端进程完全等同的权限，可直接：

- 读写任意文件（含 `.env`、密钥、用户数据）
- 发起任意网络请求（数据外泄）
- 调用 `child_process` 执行任意命令
- 篡改进程内全局状态（包括 `PluginRegistry` 与其它插件的注册数据）

**现有防护（不足以构成隔离）**

- manifest.json 必填字段校验（id/name/version/description）
- 内建插件 id 优先，外部同名插件跳过
- 路径穿越防护（icon / assets / UI component 端点）
- 管理接口（安装/卸载/更新/RPC/数据写入）走 `AuthGuard` 鉴权，查询类为 `@Public`

这些是**输入校验与访问控制**，不是运行时隔离——插件一旦加载即完全可信。

**改造方向（择一或组合）**

1. **进程隔离**：插件在独立子进程中运行，通过 IPC 转发 `PluginApi` 调用与工具执行。隔离最彻底，但需处理序列化、生命周期与工具流式返回。
2. **worker_threads + 权限清单**：在 worker 中加载插件，manifest 声明所需能力（fs / net / child_process），宿主按清单构造受限的 `PluginApi` 与模块代理。隔离强度中等，实现成本较低。
3. **静态扫描 + 安装期准入**：安装时扫描插件源码中的高危 API（`child_process`、`fs`、`net`、`eval`、`Function`），命中则拒绝或要求管理员确认。只能拦低努力攻击者，不能替代运行时隔离。

配套还需要：插件的**权限声明 UI**（安装时向管理员展示申请的能力）与**运行时审计日志**。

**关联文件**

- `backend-ts/src/modules/plugins/external/external-plugin-loader.ts`
- `backend-ts/src/modules/plugins/external/plugin-source.ts`
- `backend-ts/src/modules/plugins/plugins.controller.ts`（安装/卸载/更新/RPC 端点）
- `backend-ts/src/modules/plugins/api/plugin-api.ts`（需按能力清单裁剪的接口面）

---

## 暂缓项

已确认存在、当前明确不处理的问题。

| 问题 | 现状 | 关联文件 |
|---|---|---|
| `dangerLevel` 字段无消费方 | 全链路只声明与存储，执行器、AgentEngine、前端均不读取，不做拦截或 UI 分级 | `types/plugin.types.ts`、`toolkit/toolkit.ts`、`api/plugin-api.ts`、`builtins/file.plugin.ts` 等赋值处 |
| `params` 字段无消费方 | 角色插件条目的预留扩展位，解析器只读 `toolkits_filter/deny/allow`，前端读写也不含它 | `types/plugin.types.ts`（`RolePluginEntryConfig`）、`plugin.manager.ts`（`applyRoleLayer`） |
| 跨插件工具重名无仲裁 | 同名工具都会进入发送给 LLM 的 tools 数组（供应商会因此报 400），执行时按注册顺序命中第一个，后注册者不可达。**MCP 侧已处理**：添加服务器时检测重名并报错，注册期对运行期引入的冲突确定性保留创建更早的那个、跳过另一个并记 error；其余插件仍无仲裁 | `tool-executor.service.ts`（`findTool` / `toFlatToolDefs`）、`registry/plugin-registry.ts`、`mcp-servers/mcp-tool-name.ts` |
| MCP 每次调用新建连接 | `withClient` 为每次 `listTools`/`callTool` 新建 transport 与 Client，用完即关；无连接复用/池化、无重试、无单次调用超时（仅有 10s 连接超时） | `common/mcp/mcp-client.service.ts`；架构文档亦已列出该项 |

> MCP 连接池一项在 [`PROJECT_ARCHITECTURE.md`](./PROJECT_ARCHITECTURE.md) 中也有记录，此处仅作交叉引用，避免两处描述漂移。

### 暂缓项 · 插件系统重构期间发现（2026-09-15）

本轮改插件门控与 MCP 时顺带发现、未修的项。都经过代码核实。

| 问题 | 现状 | 关联文件 |
|---|---|---|
| MCP `streamableHttp` 分支是死代码 | 先 `config.type?.toLowerCase()`，随后却与 `"streamableHttp"` 比较，永不成立。功能无影响（落入同一 else 分支），但该分支的专属调试日志失效 | `common/mcp/mcp-client.service.ts`（`withClient` 的协议判定） |
| MCP `callTool` 不透传 `isError` | 异常被吞成 `{success:false, content:"Error: …"}`，而插件只返回 `result.content` → **LLM 无法区分工具失败与正常输出**，会把错误当数据用 | `common/mcp/mcp-client.service.ts`、`modules/mcp-servers/tools/mcp.plugin.ts` |
| MCP `healthCheck()` 无调用方 | 死 API；前端也没有"测试连接"按钮，连通性只在创建/更新/刷新抓工具时被间接验证 | `common/mcp/mcp-client.service.ts` |
| `registerPlugin` 的 catch 兜底与其它保护不一致 | 只认 `category === "core"`，不认 `system`/`essential`。配置读取异常时 system 非 essential 插件（mcp/skill/sub_agent）会被置为 disabled | `modules/plugins/plugin.manager.ts`（`registerPlugin` 的 catch） |
| 外部插件可自declare `category` / `essential` | `validateManifest` 只校验 id/name/version/description，不剥离这两个字段；外部插件借此获得"不可启停 + 免于批量禁用"。`governance` 已堵，`category`/`essential` 未堵 | `modules/plugins/external/external-plugin-loader.ts` |
| Skills 的逐技能过滤只在 prompt 生效 | `settings.skills` 的过滤作用在 skill 插件的提示词上，`skill_learn` 工具本身不校验 → 被角色关掉的技能仍可被 learn 到 | `modules/skills/plugins/skill.plugin.ts` |
| `category: "system"` 兼任三种职责 | 不可启停、不进通用启停列表、`/plugins/query` 的过滤判据。工具包治理已拆为工具包级 `governance`，插件级的这三项仍混在 `category` 上 | `modules/plugins/plugin.manager.ts`、`plugins.controller.ts` |
