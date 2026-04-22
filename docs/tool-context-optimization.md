# 工具编排上下文优化

## 优化概述

本次优化引入了 `ToolContext` 类和 `ToolContextFactory` 工厂，解决了 `ToolOrchestrator` 中上下文传递的代码冗余问题。

**第二次优化**：通过让 `ContextManagerService.getContextForLLMInference()` 返回已创建的 `toolContext`，实现了上下文的复用，避免了在 `AgentService` 中重复创建。

**第三次优化**：将 `getAllTools()` 的调用从 `ContextManagerService` 移到调用方，实现职责分离和按需加载。

## 问题分析

### 优化前的问题

1. **代码冗余**：在 `AgentService` 和 `ContextManagerService` 中重复构建相同的 context 对象结构
2. **类型不安全**：使用 `any` 类型，缺乏类型约束
3. **维护困难**：context 结构变化需要同步修改多处代码

示例（优化前的冗余代码）：
```typescript
const toolContext = {
  injectParams: { session_id: sessionId, user_id: userId },
  providerConfigs: {
    mcp: { enabledTools: mergedSettings?.mcpServers ?? true },
    time: { enabledTools: mergedSettings?.tools?.includes('get_current_time') ?? true },
    memory: { enabledTools: mergedSettings?.tools?.includes('memory') ?? false },
    knowledge_base: { enabledTools: containsKnowledgeBase },
  },
  getProviderConfig: (ns: string) => { ... },
};
```

## 解决方案

### 1. 新建 ToolContext 类

**文件位置**：`src/modules/tools/tool-context.ts`

核心功能：
- `ToolContext`：封装工具执行所需的所有配置和参数
- `ProviderConfig`：定义提供者配置接口
- `ToolContextFactory`：提供统一的上下文创建方法

主要优势：
- 类型安全：使用 TypeScript 接口明确定义结构
- 职责清晰：数据容器与行为分离
- 易于测试：可以独立 mock 和测试

### 2. 修改 ToolOrchestrator

**变更点**：
- 所有方法的 `context: any` 参数改为 `context: ToolContext`
- 使用 `context.isToolEnabled(namespace)` 替代冗长的条件判断
- 修复日志输出 bug：`${allTools}` → `${allTools.length}`

### 3. 修改 ContextManagerService

**第一次优化**：
- 注入 `ToolContextFactory`
- 使用工厂方法创建上下文
- 消除了约 20 行冗余代码

**第三次优化**：
- 从返回值中移除 `tools` 字段
- 不再在内部调用 `getAllTools()`
- `getContextForTokenStats` 中自行调用 `getAllTools()`（因为需要工具定义进行 Token 统计）
- 职责更清晰：只负责构建上下文，不负责获取工具

### 4. 修改 AgentService

**第二次优化**：
- ~~注入 `ToolContextFactory`~~（第二次优化后移除）
- 从 `getContextForLLMInference()` 的返回值中解构出 `toolContext`
- 直接使用复用的 `toolContext`，无需再次创建
- 消除了约 13 行冗余代码和 1 个不必要的依赖注入

**第三次优化**：
- 从返回值中移除 `tools` 解构
- 在调用方根据模型特性决定是否调用 `getAllTools()`
- 避免不必要的工具获取操作（如果模型不支持 tools）
- 消除了重复的特性检查逻辑

**优化效果**：
- ✅ 避免重复创建相同的上下文对象
- ✅ 减少依赖注入，简化构造函数
- ✅ 确保整个请求生命周期使用同一个上下文实例

### 5. 更新 ToolsModule

**变更点**：
- 将 `ToolContextFactory` 添加到 providers
- 导出 `ToolContextFactory` 供其他模块使用

## 优化效果

### 代码量对比

| 文件 | 优化前 | 最终 | 总变化 |
|------|--------|------|--------|
| tool-context.ts | 0 | +97 | +97 |
| tool-orchestrator.service.ts | 119 | 120 | +1 |
| context-manager.service.ts | 491 | 477 | -14 |
| agent.service.ts | 590 | 572 | -18 |
| tools.module.ts | 30 | 32 | +2 |
| **总计** | **1230** | **1298** | **+68** |

虽然总代码量略有增加，但：
- ✅ 消除了约 58 行重复代码
- ✅ 新增了可复用的工厂类（97 行）
- ✅ 提高了代码质量和可维护性
- ✅ 避免了重复创建上下文对象
- ✅ 实现了按需加载工具定义

### 质量提升

1. **类型安全**：从 `any` 类型升级为明确的接口定义
2. **单一职责**：Context 构建逻辑集中在 Factory
3. **易于扩展**：新增工具提供者只需修改 Factory
4. **可测试性**：可以独立测试 Factory 和 Context
5. **性能优化**：避免重复创建相同的上下文对象
6. **依赖简化**：AgentService 不再需要直接依赖 ToolContextFactory
7. **按需加载**：只在需要时获取工具定义，避免不必要的计算
8. **职责分离**：ContextManager 只负责构建上下文，不负责获取工具

## 使用示例

### 创建工具上下文

```typescript
// 1. 在 ContextManagerService 中创建并返回上下文
const { messages, toolContext } = await this.contextManager.getContextForLLMInference(
  sessionId,
  userId,
  messageId,
  maxMessages,
  mergedSettings,
  skipToolCalls,
);

// 2. 在 AgentService 中根据需要获取工具定义
const canUseTools = features.includes("tools");
const tools = canUseTools ? await this.toolOrchestrator.getAllTools(toolContext) : undefined;

// 3. 复用同一个 toolContext 执行工具调用
const toolResponses = await this.toolOrchestrator.executeBatch(
  toolCalls,
  toolContext, // 直接使用，无需重新创建
);
```

### 访问上下文信息

```typescript
// 获取提供者配置
const config = toolContext.getProviderConfig('mcp');

// 检查工具是否启用
const isEnabled = toolContext.isToolEnabled('memory');

// 访问注入参数
const sessionId = toolContext.injectParams.session_id;
```

## 兼容性说明

- ✅ 向后兼容：现有工具提供者接口未改变
- ✅ 无破坏性变更：只是重构了上下文传递方式
- ⚠️ 需要重新编译：TypeScript 类型检查会更严格

## 后续优化建议

1. **单元测试**：为 `ToolContextFactory` 添加完整的单元测试
2. **配置验证**：在 Factory 中添加参数验证逻辑
3. **缓存优化**：如果上下文创建频繁，可以考虑缓存机制
4. **文档完善**：为每个工具提供者添加使用示例

## 相关文件

- `src/modules/tools/tool-context.ts` - 新增
- `src/modules/tools/tool-orchestrator.service.ts` - 修改
- `src/modules/chat/context-manager.service.ts` - 修改
- `src/modules/chat/agent.service.ts` - 修改
- `src/modules/tools/tools.module.ts` - 修改
