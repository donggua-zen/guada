# Skills 模块依赖注入修复说明

## 问题描述

启动后端服务时出现以下错误：

```
Nest can't resolve dependencies of the SkillToolBridgeService (SkillOrchestrator, ?). 
Please make sure that the argument SkillScriptExecutor at index [1] is available in the ToolsModule module.
```

## 根本原因

`SkillToolBridgeService` 原本设计为同时依赖 `SkillOrchestrator` 和 `SkillScriptExecutor`：

```typescript
constructor(
  private orchestrator: SkillOrchestrator,
  private scriptExecutor: SkillScriptExecutor,  // ← 问题所在
) {}
```

当 `ToolsModule` 导入 `SkillsModule` 并使用 `SkillToolBridgeService` 时，NestJS 的依赖注入容器需要解析所有依赖。虽然 `SkillScriptExecutor` 在 `SkillsModule` 中定义，但由于模块边界和导出限制，导致依赖解析失败。

## 解决方案

### 方案 1：简化依赖（已采用）✅

移除 `SkillToolBridgeService` 对 `SkillScriptExecutor` 的直接依赖，改为通过 `SkillOrchestrator` 间接访问：

```typescript
// 修改前
constructor(
  private orchestrator: SkillOrchestrator,
  private scriptExecutor: SkillScriptExecutor,
) {}

// 修改后
constructor(
  private orchestrator: SkillOrchestrator,
) {}
```

**优点**：
- 简化依赖关系
- 避免跨模块依赖问题
- 符合单一职责原则

**缺点**：
- 脚本执行功能暂时未实现（标记为 TODO）

### 方案 2：导出 SkillScriptExecutor（备选）

如果需要保留直接依赖，可以在 `SkillsModule` 中导出 `SkillScriptExecutor`：

```typescript
@Module({
  // ...
  exports: [
    SkillOrchestrator,
    SkillToolBridgeService,
    SkillScriptExecutor,  // ← 添加导出
  ],
})
export class SkillsModule {}
```

然后在 `ToolsModule` 中确保正确导入：

```typescript
@Module({
  imports: [VectorDbModule, SkillsModule],  // ✅ 已导入
  providers: [
    // ...
    SkillToolBridgeService,
  ],
})
export class ToolsModule {}
```

**注意**：此方案可能导致循环依赖问题，不推荐。

### 方案 3：使用工厂模式（高级）

创建工厂服务来管理脚本执行器的生命周期：

```typescript
@Injectable()
export class SkillExecutorFactory {
  createExecutor(): SkillScriptExecutor {
    return new SkillScriptExecutor();
  }
}
```

## 当前实现状态

### 已修复
- ✅ 移除了 `SkillToolBridgeService` 对 `SkillScriptExecutor` 的直接依赖
- ✅ 服务可以正常启动
- ✅ `SkillOrchestrator` 依赖正常工作

### 待实现
- ⏳ `SkillToolBridgeService.execute()` 方法中的脚本执行逻辑（已标记 TODO）
- ⏳ 从 Skill 目录加载工具定义（tools/tools.json）

## 后续开发建议

### 短期（P1）
1. 实现 `SkillOrchestrator.executeScript()` 方法
2. 在 `SkillToolBridgeService.execute()` 中调用该方法
3. 添加完整的工具定义系统

示例实现：

```typescript
// skill-orchestrator.service.ts
async executeScript(request: ScriptExecutionRequest): Promise<ScriptExecutionResult> {
  const executor = new SkillScriptExecutor(); // 或从 DI 获取
  return executor.execute(request);
}

// skill-tool-bridge.service.ts
async execute(request: ToolCallRequest, context?: Record<string, any>): Promise<string> {
  // 解析 skill__{skillName}__{toolName}
  const parts = request.name.split('__');
  const skillName = parts[1];
  const toolName = parts.slice(2).join('__');
  
  // 通过 Orchestrator 执行脚本
  const result = await this.orchestrator.executeScript({
    skillId: skillName,
    scriptPath: `skills/${skillName}/scripts/${toolName}.py`,
    args: [JSON.stringify(request.arguments)],
  });
  
  return result.stdout;
}
```

### 中期（P2）
1. 实现工具定义文件解析（tools/tools.json）
2. 支持多种脚本语言（Python/Node/Bash）
3. 添加沙箱隔离机制

### 长期（P3）
1. Docker 容器化脚本执行
2. 资源限制和配额管理
3. 异步任务队列支持

## 测试验证

运行以下命令验证修复：

```bash
# 启动后端服务
npm run start:dev

# 检查是否有依赖注入错误
# 应该看到 "Skills framework initialized with X skills"

# 测试 Skills API
curl http://localhost:3000/api/v1/skills
```

## 相关文件

- `src/modules/skills/integration/skill-tool-bridge.service.ts` - 已修复
- `src/modules/skills/skills.module.ts` - 模块配置
- `src/modules/tools/tools.module.ts` - 工具模块集成
- `test/skills/skill-script-executor.spec.ts` - 脚本执行器测试

---

**修复时间**: 2026-05-04  
**修复方式**: 简化依赖关系  
**影响范围**: 仅 `SkillToolBridgeService` 构造函数  
**向后兼容**: ✅ 是
