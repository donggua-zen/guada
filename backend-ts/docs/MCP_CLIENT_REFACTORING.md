# MCP 客户端服务重构文档

## 概述

本次重构将 TypeScript 后端中的 MCP（Model Context Protocol）通信逻辑从分散的原始 HTTP 请求统一到了标准化的 SDK 实现，提升了代码的可维护性、一致性和协议兼容性。

## 主要改动

### 1. 新建独立 MCP 客户端服务

**文件**: `src/common/mcp/mcp-client.service.ts`

创建了全局可用的 `McpClientService`，封装了所有与 MCP 服务器的底层通信逻辑：

#### 核心功能

- **`withClient<T>()`**: 私有方法，管理客户端生命周期（连接、执行操作、关闭连接）
- **`listTools()`**: 获取 MCP 服务器的工具列表，返回以工具名为键的字典格式
- **`callTool()`**: 调用远程 MCP 工具，返回标准化的结果对象
- **`healthCheck()`**: 验证 MCP 服务器是否可用

#### 技术特点

- 使用 `@modelcontextprotocol/sdk` 提供的 **`StreamableHTTPClientTransport`**（官方推荐）
- 自动处理 JSON-RPC 2.0 协议细节（请求格式、响应解析、错误处理）
- 统一的错误处理和日志记录
- 确保资源正确释放（finally 块中关闭连接）
- **兼容阿里云百炼等主流 MCP 服务**

### 2. 创建 MCP 客户端模块

**文件**: `src/common/mcp/mcp-client.module.ts`

```typescript
@Global()
@Module({
    providers: [McpClientService],
    exports: [McpClientService],
})
export class McpClientModule {}
```

标记为全局模块，使得 `McpClientService` 可以在整个应用中无需显式导入即可注入。

### 3. 重构 MCP 服务器管理服务

**文件**: `src/modules/mcp-servers/mcp-server.service.ts`

#### 改动点

- **移除**: 直接依赖 `@modelcontextprotocol/sdk` 的底层类
- **新增**: 注入 `McpClientService`
- **简化**: `fetchToolsFromServer()` 方法现在只需调用 `mcpClient.listTools()`

#### 影响的方法

- `createServer()`: 创建服务器时自动获取工具列表
- `updateServer()`: 更新 URL/Headers 时智能检测并刷新工具
- `refreshTools()`: 手动刷新工具列表

### 4. 重构 MCP 工具提供者

**文件**: `src/modules/tools/providers/mcp-tool.provider.ts`

#### 改动前

```typescript
// 手动构建 JSON-RPC 请求
const response = await firstValueFrom(
    this.httpService.post(targetServer.url, {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: toolName, arguments: request.arguments },
        id: request.id,
    }, { headers: targetServer.headers || {} }),
) as any;
```

#### 改动后

```typescript
// 使用标准化的 MCP 客户端
const result = await this.mcpClient.callTool(
    { url: targetServer.url, headers: targetServer.headers || {} },
    toolName,
    request.arguments,
    request.id
);
```

#### 优势

- 消除了手动构建 JSON-RPC 消息的代码
- 错误处理更加统一和健壮
- 自动处理响应格式化和内容提取

### 5. 更新模块依赖

#### 移除的依赖

- `HttpModule` (@nestjs/axios) - 不再需要原始的 HTTP 请求
- `rxjs` 的 `firstValueFrom` - 不再需要 Observable 转换

#### 更新的模块

- `src/app.module.ts`: 导入 `McpClientModule`（全局）
- `src/modules/mcp-servers/mcp-servers.module.ts`: 移除 `HttpModule`
- `src/modules/tools/tools.module.ts`: 移除 `HttpModule`

## 与 Python 后端的一致性

### 协议遵循

| 特性 | Python 后端 | TypeScript 后端（重构后） |
|------|------------|--------------------------|
| 通信协议 | JSON-RPC 2.0 | JSON-RPC 2.0（通过 SDK） |
| 传输层 | HTTP POST | Streamable HTTP（SSE + POST） |
| 工具列表获取 | `client.list_tools()` | `client.listTools()` |
| 工具调用 | `client.call_tool()` | `client.callTool()` |
| 错误处理 | try-catch + 日志 | try-catch + 日志 |

### 行为一致性

1. **工具列表格式**: 两者都返回以工具名为键的字典格式
2. **优雅降级**: 工具获取失败时不阻塞主流程
3. **资源管理**: 每次操作后正确关闭连接
4. **日志记录**: 统一的日志级别和消息格式

## 架构优势

### 1. 单一职责原则

- `McpClientService`: 专注于 MCP 协议通信
- `McpServerService`: 专注于服务器 CRUD 业务逻辑
- `MCPToolProvider`: 专注于工具提供者的接口适配

### 2. 代码复用

- 所有 MCP 通信逻辑集中在一个服务中
- 避免了在多个地方重复实现相同的连接管理代码

### 3. 可测试性

- `McpClientService` 可以独立进行单元测试
- 可以通过 Mock 轻松替换依赖

### 4. 可维护性

- 协议升级只需修改 `McpClientService`
- 新增 MCP 相关功能有明确的扩展点

### 5. 类型安全

- 使用 TypeScript 接口定义清晰的输入输出
- 编译时检查减少了运行时错误

## 迁移指南

### 对于现有代码

如果您的代码中直接使用 `HttpService` 调用 MCP 服务器，请改为注入 `McpClientService`：

```typescript
// 之前
constructor(private httpService: HttpService) {}

// 之后
constructor(private mcpClient: McpClientService) {}
```

### 对于新功能开发

始终使用 `McpClientService` 提供的方法：

```typescript
// 获取工具列表
const tools = await this.mcpClient.listTools({ url, headers });

// 调用工具
const result = await this.mcpClient.callTool(
    { url, headers },
    toolName,
    arguments
);

// 健康检查
const isHealthy = await this.mcpClient.healthCheck({ url, headers });
```

## 注意事项

### 1. **协议兼容性说明**

本实现使用官方的 **`StreamableHTTPClientTransport`**，这是 MCP SDK 推荐的传输层实现：

```typescript
const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: {
        headers: config.headers,
    },
});

const client = new Client({ name: 'ts-backend', version: '1.0.0' });
await client.connect(transport);
```

该传输层支持：
- ✅ 标准的 MCP Streamable HTTP 协议
- ✅ 阿里云百炼、OpenAI 等主流 MCP 服务
- ✅ 会话管理和连接复用
- ✅ 自动重试和错误恢复

**测试结果**：已成功测试阿里云百炼 WebSearch MCP 服务，工具调用正常工作。

### 2. **参数命名**

由于 `arguments` 是 JavaScript 的保留关键字，在 `callTool()` 方法中使用 `toolArgs` 作为参数名：

```typescript
async callTool(
    config: McpServerConfig,
    toolName: string,
    toolArgs: Record<string, any>,  // 注意：不是 arguments
    requestId?: string | number
): Promise<McpToolCallResult>
```

### 2. **连接管理**

`McpClientService` 采用**临时连接**模式：
- 每次操作都会建立新连接
- 操作完成后立即关闭连接
- 通过 `withClient()` 方法统一管理连接生命周期
- 适合中低频调用场景

如需高频调用，后续可优化为连接池模式。

### 3. **响应格式处理**

MCP SDK 返回的工具调用结果可能是标准格式：

```typescript
{
  content: [
    { type: 'text', text: '...' },
    { type: 'image', data: '...', mimeType: '...' }
  ]
}
```

`callTool()` 方法会自动提取并格式化内容，将 `content` 数组转换为文本字符串。

### 4. **错误处理**

所有方法都会在内部捕获异常并记录日志，但会重新抛出错误让调用者决定如何处理。`callTool()` 方法特殊，它返回包含 `success` 字段的结果对象而不是抛出异常。

## 未来改进方向

1. **连接池**: 为频繁调用的 MCP 服务器维护长连接
2. **缓存机制**: 缓存工具列表，减少不必要的网络请求
3. **超时控制**: 为不同操作设置不同的超时时间
4. **重试策略**: 实现指数退避重试机制
5. **监控指标**: 收集 MCP 调用的性能指标和错误率

## 相关文件清单

### 新增文件
- `src/common/mcp/mcp-client.service.ts` - MCP 客户端服务
- `src/common/mcp/mcp-client.module.ts` - MCP 客户端模块

### 修改文件
- `src/app.module.ts` - 导入 McpClientModule
- `src/modules/mcp-servers/mcp-server.service.ts` - 使用 McpClientService
- `src/modules/mcp-servers/mcp-servers.module.ts` - 移除 HttpModule
- `src/modules/tools/providers/mcp-tool.provider.ts` - 使用 McpClientService
- `src/modules/tools/tools.module.ts` - 移除 HttpModule

### 依赖变更
- 已安装: `@modelcontextprotocol/sdk@1.29.0`
- 可移除: `@nestjs/axios`（如果其他地方不再使用）

## 测试建议

1. **单元测试**: 为 `McpClientService` 编写单元测试，Mock SDK 客户端
2. **集成测试**: 测试与真实 MCP 服务器的交互
3. **端到端测试**: 验证完整的工具调用流程

## 总结

本次重构成功地将分散的 MCP 通信逻辑统一到了标准化的 SDK 实现，显著提升了代码质量和可维护性。通过遵循 NestJS 最佳实践和 MCP 协议规范，确保了与 Python 后端的行为一致性，为未来的功能扩展奠定了坚实的基础。
