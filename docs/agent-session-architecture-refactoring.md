# Agent · Session 架构重构方案

## 一、当前问题

### 1.1 架构现状

当前系统存在两个彼此独立但数据处理逻辑高度重合的服务：

```
ChatController         SessionsController
    |                        |
    v                        v
AgentService          SessionService
(agent.service.ts)    (session.service.ts)
    |    |                    |    |
    |    +-- mergeSessionSettings()   +-- mergeSessionSettingsForCompression()
    |    +-- 构建 systemPrompt        +-- initializeConversationContext()
    |    +-- 计算 effectiveCtxWindow   |    └-- systemPrompt 只取 character.description
    |    +-- 注入 toolPrompts         |
    |    +-- 检查 model.features      +-- getTokenStats()
    |                                +-- compressSession()
    +-- executeAgentLoop()
    +-- executeLLMStream()
```

### 1.2 三大核心问题

#### 问题一：数据准备不一致

Agent 对话和 Session 统计/压缩对 `ConversationContext` 的初始化参数不同：

| 准备步骤 | AgentService (`executeAgentLoop`) | SessionService (`getTokenStats` / `compressSession`) |
|---|---|---|
| `systemPrompt` | `sessionSettings.systemPrompt + '\n' + toolPrompts` | `session.character?.description` ❌ 缺失工具提示词 |
| `contextWindow` | `min(modelCtxWindow, maxTokensLimit)` | 原始 `modelCtxWindow` ❌ 忽略 maxTokensLimit |
| `thinkingEnabled` | 先检查 `model.features.includes("thinking")` | 直接用 `sessionSettings.thinkingEnabled` ❌ |
| `userMessageId` | ✅ 传入（加载到指定消息） | ❌ 不传 |
| `memory` 合并 | `mergeSessionSettings()` | `mergeSessionSettingsForCompression()` ❌ 逻辑复制 |

**后果**：用户看到的 Token 统计偏低（缺少工具提示词的 Token），上下文窗口判断有偏差，压缩阈值不精确。

#### 问题二：代码重复

`mergeSessionSettings`（agent.service.ts L570-620）和 `mergeSessionSettingsForCompression`（session.service.ts L660-682）是完全重复的逻辑。未来任何继承规则的修改都需同步两处，极易遗漏。

#### 问题三：职责模糊

`AgentService` 承担了部分会话配置合并的职责，但严格来说它只应负责推理循环。`SessionService` 的 `initializeConversationContext` 又是一个半成品复制，无法保证与 Agent 一致。

---

## 二、方案对比

### 方案 A：Agent 合并到 Session（不推荐）

```
SessionService (~1600 行)
├── CRUD (create / update / delete / list / getById)
├── generateTitle / getTokenStats / compressSession
├── completions (SSE)
├── executeAgentLoop (ReAct)
├── executeLLMStream (流式)
└── safeJsonParse / buildYieldEvent / accumulateToolCalls / ...
```

| 优点 | 缺点 |
|---|---|
| 单一入口，不会出现数据不一致 | **严重违反单一职责**：CRUD + 流式 + 统计 + 压缩混在一起 |
| | ChatController 和 SessionsController 耦合在同一服务上 |
| | 异步生成器与普通 async 混在一个类中，难以理解和维护 |
| | 单元测试需要 mock 大量依赖 |

### 方案 B：分离数据准备层 + Agent 改为 Engine（推荐）✅

```
ChatController              SessionsController
    |                              |
    v                              v
AgentEngine                 SessionService
(agent-engine.service.ts)   (session.service.ts)
    |    |                         |    |
    |    +-- executeAgentLoop()    |    +-- CRUD
    |    +-- executeLLMStream()    |    +-- generateTitle()
    |                              |
    +-------+----------------------+
            |
            v
   SessionContextService  [NEW]
   (session-context.service.ts)
   ├── mergeSettings()        ← 唯一来源
   ├── buildChatContext()     → 完整 context (含 toolPrompts)
   ├── buildStatsContext()    → 与 chat 一致的参数
   └── buildCompressContext() → 与 chat 一致的参数

所有链路共用同一个 ConversationContext 初始化参数，从根本上消除不一致。
```

| 优点 | 缺点 |
|---|---|
| 数据准备 **单一来源**，从根本上消除不一致 | 新增一个服务文件 |
| Agent / Session 职责清晰独立 | 需要一次重构（但范围可控,核心逻辑不动） |
| 未来新增统计场景只需调 `buildStatsContext` | |
| 三个服务可独立单元测试 | |
| `AgentEngine` 语义准确：它不管理会话，只做推理 | |

---

## 三、推荐方案详细设计

### 3.1 新文件：`session-context.service.ts`

```typescript
// src/modules/chat/session-context.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { SessionRepository } from "../../common/database/session.repository";
import { ModelRepository } from "../../common/database/model.repository";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { ConversationContextFactory } from "./conversation-context.factory";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { ToolContextFactory } from "../tools/tool-context";
import { IConversationContext } from "./interfaces";
import { SG_MODELS, SK_MOD_CHAT } from "../../constants/settings.constants";

export interface MergedSettings {
  systemPrompt: string;
  thinkingEnabled: boolean | undefined;
  memory: any;
  modelTemperature?: number;
  modelTopP?: number;
  modelFrequencyPenalty?: number;
  tools?: any;
  mcpServers?: any;
}

export interface BuildContextResult {
  context: IConversationContext;
  tools?: any[];
  toolContext?: any;
  effectiveContextWindow: number;
  thinkingEnabled: boolean | undefined;
}

@Injectable()
export class SessionContextService {
  private readonly logger = new Logger(SessionContextService.name);

  constructor(
    private sessionRepo: SessionRepository,
    private conversationContextFactory: ConversationContextFactory,
    private toolOrchestrator: ToolOrchestrator,
    private toolContextFactory: ToolContextFactory,
    private modelRepository: ModelRepository,
    private settingsStorage: SettingsStorage,
  ) {}

  /**
   * 合并会话设置与角色默认配置（唯一来源）
   * Agent 和 Session 均通过此方法获取合并后的设置
   */
  mergeSettings(session: any): MergedSettings {
    const sessionSettings = session.settings || {};
    const characterSettings = session.character?.settings || {};

    const merged: MergedSettings = {
      systemPrompt: sessionSettings.systemPrompt || characterSettings.systemPrompt || "",
      thinkingEnabled: undefined,
      memory: {},
      modelTemperature: characterSettings.modelTemperature,
      modelTopP: characterSettings.modelTopP,
      modelFrequencyPenalty: characterSettings.modelFrequencyPenalty,
      tools: sessionSettings.tools,
      mcpServers: sessionSettings.mcpServers,
    };

    // --- 记忆/压缩配置（独立继承） ---
    const memoryEnabled = sessionSettings.memoryEnabled;
    const sessionMemory = sessionSettings.memory || {};
    const characterMemory = characterSettings.memory || {};

    if (memoryEnabled !== false) {
      merged.memory = { ...sessionMemory };
    } else {
      merged.memory = { ...characterMemory };
    }

    // --- thinkingEnabled ---
    merged.thinkingEnabled = sessionSettings.thinkingEnabled;

    return merged;
  }

  /**
   * 计算实际生效的上下文窗口
   */
  private calcEffectiveContextWindow(model: any, memoryConfig: any): number {
    const modelContextWindow = model?.config?.contextWindow || 128000;
    const maxTokensLimit = memoryConfig?.maxTokensLimit;
    return maxTokensLimit
      ? Math.min(modelContextWindow, maxTokensLimit)
      : modelContextWindow;
  }

  /**
   * 解析会话模型（优先会话绑定模型，否则全局默认）
   */
  private async resolveModel(session: any) {
    let model = session.model;
    if (!model) {
      const modelId = this.settingsStorage.getSettingValue(SG_MODELS, SK_MOD_CHAT);
      if (modelId) {
        model = await this.modelRepository.findById(modelId);
      }
    }
    return model;
  }

  /**
   * 构建 Agent 对话用的完整上下文
   *
   * 包含：systemPrompt + toolPrompts、effectiveContextWindow、
   *       thinkingEnabled（已检查 model features）、工具上下文、可用工具列表
   */
  async buildChatContext(
    sessionId: string,
    userId: string,
    userMessageId: string,
  ): Promise<BuildContextResult> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error("Session not found");

    const model = await this.resolveModel(session);
    const merged = this.mergeSettings(session);

    // 模型特性
    const features = model?.config?.features || [];
    const supportsTools = features.includes("tools");
    const supportsThinking = features.includes("thinking");

    // 工具上下文 & 工具定义 & 工具提示词
    let tools: any[] | undefined;
    let toolContext: any;
    if (supportsTools) {
      toolContext = this.toolContextFactory.createContext(
        sessionId,
        userId,
        merged.tools,
        merged.mcpServers,
        [],
      );
      tools = await this.toolOrchestrator.getAllTools(toolContext);
    }

    const toolPrompts = supportsTools
      ? await this.toolOrchestrator.getAllToolPrompts(toolContext!)
      : "";

    // systemPrompt = 角色/会话的 systemPrompt + 工具注入提示词
    const fullSystemPrompt = [
      merged.systemPrompt,
      toolPrompts,
    ].filter(Boolean).join("\n");

    const thinkingEnabled = supportsThinking
      ? !!merged.thinkingEnabled
      : undefined;

    const effectiveContextWindow = this.calcEffectiveContextWindow(model, merged.memory);

    // 创建并初始化 ConversationContext
    const context = await this.conversationContextFactory.create(sessionId, userId);
    await context.initialize({
      memory: merged.memory,
      systemPrompt: fullSystemPrompt,
      thinkingEnabled,
      userMessageId,
      contextWindow: effectiveContextWindow,
      model: model || undefined,
    });

    return { context, tools, toolContext, effectiveContextWindow, thinkingEnabled };
  }

  /**
   * 构建 Token 统计用的上下文
   *
   * 与 buildChatContext 使用完全相同的：systemPrompt、contextWindow、thinkingEnabled
   * 唯一区别：不需要 userMessageId（统计全量）、不需要 tools
   */
  async buildStatsContext(
    sessionId: string,
    userId: string,
  ): Promise<{ context: IConversationContext; contextWindow: number }> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error("Session not found");

    const model = await this.resolveModel(session);
    const merged = this.mergeSettings(session);

    const features = model?.config?.features || [];
    const supportsTools = features.includes("tools");
    const supportsThinking = features.includes("thinking");

    // 同样注入工具提示词，确保 systemPrompt Token 计数一致
    let toolPrompts = "";
    if (supportsTools) {
      const toolContext = this.toolContextFactory.createContext(
        sessionId, userId, merged.tools, merged.mcpServers, [],
      );
      toolPrompts = await this.toolOrchestrator.getAllToolPrompts(toolContext);
    }

    const fullSystemPrompt = [
      merged.systemPrompt,
      toolPrompts,
    ].filter(Boolean).join("\n");

    const thinkingEnabled = supportsThinking
      ? !!merged.thinkingEnabled
      : undefined;

    const effectiveContextWindow = this.calcEffectiveContextWindow(model, merged.memory);

    const context = await this.conversationContextFactory.create(sessionId, userId);
    await context.initialize({
      memory: merged.memory,
      systemPrompt: fullSystemPrompt,
      thinkingEnabled,
      contextWindow: effectiveContextWindow,
      model: model || undefined,
    });

    return { context, contextWindow: effectiveContextWindow };
  }

  /**
   * 构建手动压缩用的上下文
   * 与 buildChatContext 参数完全一致
   */
  async buildCompressContext(
    sessionId: string,
    userId: string,
  ): Promise<IConversationContext> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error("Session not found");

    const model = await this.resolveModel(session);
    const merged = this.mergeSettings(session);

    const features = model?.config?.features || [];
    const supportsTools = features.includes("tools");
    const supportsThinking = features.includes("thinking");

    let toolPrompts = "";
    if (supportsTools) {
      const toolContext = this.toolContextFactory.createContext(
        sessionId, userId, merged.tools, merged.mcpServers, [],
      );
      toolPrompts = await this.toolOrchestrator.getAllToolPrompts(toolContext);
    }

    const fullSystemPrompt = [
      merged.systemPrompt,
      toolPrompts,
    ].filter(Boolean).join("\n");

    const thinkingEnabled = supportsThinking
      ? !!merged.thinkingEnabled
      : undefined;

    const effectiveContextWindow = this.calcEffectiveContextWindow(model, merged.memory);

    const context = await this.conversationContextFactory.create(sessionId, userId);
    await context.initialize({
      memory: merged.memory,
      systemPrompt: fullSystemPrompt,
      thinkingEnabled,
      contextWindow: effectiveContextWindow,
      model: model || undefined,
    });

    return context;
  }
}
```

### 3.2 修改文件：`agent.service.ts` → `agent-engine.service.ts`

**改动要点**：
- 删除 `mergeSessionSettings()` 方法
- 删除 `toolContextFactory`、`conversationContextFactory` 直接依赖 → 改为依赖 `SessionContextService`
- `executeAgentLoop` 的初始化阶段从 ~60 行缩减为 ~10 行
- 类名从 `AgentService` 改为 `AgentEngine`

```typescript
// src/modules/chat/agent-engine.service.ts

import { Injectable, Logger, ConflictException } from "@nestjs/common";
import { SessionRepository } from "../../common/database/session.repository";
import { LLMService } from "../llm-core/llm.service";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { SessionLockService } from "./session-lock.service";
import { SessionContextService } from "./session-context.service";
import { MessageRecord, LLMResponseChunk } from "../llm-core/types/llm.types";
import { IConversationContext } from "./interfaces";

/**
 * Agent 推理引擎
 *
 * 负责协调会话级别的 AI 代理执行流程，包括多轮工具调用循环、流式响应管理。
 * 不管理会话生命周期——配置合并、上下文构建等数据准备工作由 SessionContextService 统一提供。
 */
@Injectable()
export class AgentEngine {
  private readonly logger = new Logger(AgentEngine.name);

  constructor(
    private sessionRepo: SessionRepository,
    private toolOrchestrator: ToolOrchestrator,
    private llmService: LLMService,
    private sessionLockService: SessionLockService,
    private sessionContextService: SessionContextService,
  ) {}

  async *completions(
    sessionId: string,
    messageId: string,
    regenerationMode: string = "overwrite",
    assistantMessageId?: string,
    abortSignal?: AbortSignal,
  ) {
    if (!this.sessionLockService.tryLock(sessionId)) {
      throw new ConflictException("Session is busy");
    }

    try {
      const session = await this.sessionRepo.findById(sessionId);
      if (!session) throw new Error("Session not found");

      await this.sessionRepo.updateLastActiveAt(sessionId);

      // 委托 SessionContextService 完成所有数据准备
      const { context, tools, toolContext, effectiveContextWindow, thinkingEnabled } =
        await this.sessionContextService.buildChatContext(sessionId, session.userId, messageId);

      yield* this.executeAgentLoop(
        context,
        session,
        messageId,
        tools,
        toolContext,
        thinkingEnabled,
        regenerationMode,
        assistantMessageId,
        abortSignal,
      );
    } finally {
      this.sessionLockService.unlock(sessionId);
    }
  }

  private async *executeAgentLoop(
    conversationContext: IConversationContext,
    session: any,
    userMessageId: string,
    tools: any[] | undefined,
    toolContext: any,
    thinkingEnabled: boolean | undefined,
    regenerationMode: string,
    assistantMessageId?: string,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<any> {
    const sessionSettings = session.settings || {};

    const turnsId = conversationContext.generateId();
    const responseMessageId = await conversationContext.prepareAssistantResponse(
      userMessageId,
      regenerationMode,
      turnsId,
      assistantMessageId,
    );

    let needToContinue = false;
    let iterationCount = 0;
    const MAX_ITERATIONS = 40;

    do {
      iterationCount++;
      needToContinue = false;

      if (iterationCount > MAX_ITERATIONS) {
        this.logger.warn(`Agent loop exceeded ${MAX_ITERATIONS} iterations, stopping`);
        break;
      }

      const historyMessages = await conversationContext.getMessages();
      const contentId = conversationContext.generateId();

      yield {
        type: "create",
        messageId: responseMessageId,
        turnsId,
        contentId,
        modelName: session.model?.modelName,
      };

      const assistantResponse: MessageRecord = {
        role: "assistant",
        content: "",
        messageId: responseMessageId,
        turnsId,
        metadata: { modelName: session.model?.modelName },
      };

      yield* this.executeLLMStream(
        session,
        historyMessages,
        tools,
        assistantResponse,
        sessionSettings,
        thinkingEnabled,
        abortSignal,
      );

      const parts: MessageRecord[] = [assistantResponse];

      if (assistantResponse.toolCalls && toolContext) {
        const toolResponses = await this.toolOrchestrator.executeBatch(
          assistantResponse.toolCalls.map((tc: any) => ({
            id: tc.id,
            name: tc.name,
            arguments: this.safeJsonParse(tc.arguments),
          })),
          toolContext,
        );

        yield {
          type: "tool_calls_response",
          toolCallsResponse: toolResponses.map((tr) => ({
            name: tr.name,
            content: tr.content,
            toolCallId: tr.toolCallId,
          })),
        };

        needToContinue = true;
        for (const res of toolResponses) {
          parts.push({
            role: "tool",
            name: res.name,
            content: res.content,
            toolCallId: res.toolCallId,
            messageId: responseMessageId,
            turnsId,
          });
        }
      }

      await conversationContext.appendParts(parts);
    } while (needToContinue);
  }

  // ─── 以下方法保持不变（executeLLMStream / buildYieldEvent / handleStreamError
  //      / accumulateToolCalls / recordThinkingFinished / calculateThinkingDuration
  //      / safeJsonParse / ThinkingTimeInfo）───

  // ... （直接从原 agent.service.ts 复制，无需修改）
}
```

### 3.3 修改文件：`session.service.ts`

**改动要点**：
- 删除 `initializeConversationContext()` 方法
- 删除 `mergeSessionSettingsForCompression()` 方法
- 在 `getTokenStats()`、`compressSession()` 中改为调用 `sessionContextService`
- 删除 `conversationContextFactory` 直接依赖 → 改为依赖 `SessionContextService`

```typescript
// src/modules/chat/session.service.ts

// ... 其他 import 不变
import { SessionContextService } from "./session-context.service";

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private sessionRepo: SessionRepository,
    // ... 其他依赖不变
    private sessionContextService: SessionContextService,
  ) {}

  // ─── CRUD 方法保持不变 ───
  // getSessionsByUser / getSessionById / getSessionSummaries
  // updateSummary / deleteSummary / createSession
  // updateSession / deleteSession / generateTitle

  /**
   * 获取会话的 Token 使用统计
   * 使用 SessionContextService 确保与 Agent 对话使用完全一致的参数
   */
  async getTokenStats(sessionId: string, userId: string) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Session not found or unauthorized");
    }

    const { context, contextWindow } = await this.sessionContextService.buildStatsContext(
      sessionId,
      userId,
    );

    const messages = context.getHistory();
    const usedTokens = context.getTokenCount();
    const percentage = Math.min((usedTokens / contextWindow) * 100, 100);
    const remainingTokens = Math.max(contextWindow - usedTokens, 0);

    return {
      usedTokens,
      totalTokens: contextWindow,
      remainingTokens,
      percentage: parseFloat(percentage.toFixed(2)),
      modelName: session.model?.modelName || "gpt-4",
      messageCount: messages.filter(m => m.role === "user").length,
    };
  }

  /**
   * 手动触发会话压缩
   * 使用 SessionContextService 确保与 Agent 对话使用完全一致的参数
   */
  async compressSession(sessionId: string, userId: string) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Session not found or unauthorized");
    }

    const conversationContext = await this.sessionContextService.buildCompressContext(
      sessionId,
      userId,
    );

    const beforeTokenCount = conversationContext.getTokenCount();
    const beforeMessageCount = conversationContext.getHistory().length;

    this.logger.log(`Manually triggering compression for session ${sessionId}`);
    await conversationContext.forceCompress();

    const afterTokenCount = conversationContext.getTokenCount();
    const compressedMessages = conversationContext.getHistory();
    const afterMessageCount = compressedMessages.length;

    const checkpoint = await this.contextStateRepo.findBySessionId(sessionId);
    const compressionStrategy = checkpoint?.cleaningStrategy || "none";

    return {
      success: true,
      before: {
        tokenCount: beforeTokenCount,
        messageCount: beforeMessageCount,
        contextWindow: session.model?.config?.contextWindow || 128000,
      },
      after: {
        tokenCount: afterTokenCount,
        messageCount: afterMessageCount,
        compressionRatio: beforeTokenCount > 0
          ? ((1 - afterTokenCount / beforeTokenCount) * 100).toFixed(2) + "%"
          : "0%",
      },
      strategy: compressionStrategy,
      modelName: session.model?.modelName || "gpt-4",
    };
  }

  // ─── delete initializeConversationContext() ───
  // ─── delete mergeSessionSettingsForCompression() ───
}
```

### 3.4 修改文件：`chat.module.ts`

```typescript
// src/modules/chat/chat.module.ts

// 将 AgentService 改为 AgentEngine
import { AgentEngine } from "./agent-engine.service";
import { SessionContextService } from "./session-context.service";

@Module({
  imports: [AuthModule, ToolsModule, CharactersModule, FilesModule, LlmCoreModule, SkillsModule],
  controllers: [ChatController, MessagesController, SessionsController],
  providers: [
    AgentEngine, // 改名
    SessionContextService, // 新增
    MessageStoreService,
    CompressionEngine,
    ConversationContextFactory,
    { provide: MESSAGE_STORE_TOKEN, useExisting: MessageStoreService },
    { provide: COMPRESSION_STRATEGY_TOKEN, useExisting: CompressionEngine },
    MessageService,
    SessionService,
    // ... 其他 provider 不变
  ],
  exports: [AgentEngine], // 改名
})
export class ChatModule implements OnModuleInit {
  // ... 不变
}
```

### 3.5 修改文件：`chat.controller.ts`

```typescript
// src/modules/chat/chat.controller.ts

// 仅改名
import { AgentEngine } from "./agent-engine.service";

@Controller("chat")
export class ChatController {
  constructor(private agentEngine: AgentEngine) {}

  // ... 所有使用 this.agentService.xxx 的地方改为 this.agentEngine.xxx
}
```

---

## 四、重构步骤（按顺序执行）

| 步骤 | 操作 | 文件 | 风险 |
|---|---|---|---|
| 1 | **新建** `session-context.service.ts` | 新文件 | 无 |
| 2 | **新建** `agent-engine.service.ts`，从 `agent.service.ts` 复制核心方法，但不带 `mergeSessionSettings`、`conversationContextFactory` 等 | 新文件 | 无（保留原文件作对比） |
| 3 | **修改** `session.service.ts`，删除 `initializeConversationContext` 和 `mergeSessionSettingsForCompression`，改为调用 `SessionContextService` | 修改 | 低 |
| 4 | **修改** `chat.module.ts`，注册 `SessionContextService`，将 `AgentService` 改为 `AgentEngine` | 修改 | 低 |
| 5 | **修改** `chat.controller.ts`，将 `AgentService` 改为 `AgentEngine` | 修改 | 低 |
| 6 | **删除** `agent.service.ts` | 删除 | 低（前步骤已验证可运行） |
| 7 | 运行编译 + 测试 | — | — |
| 8 | 如有其他文件引用 `AgentService`，同步修改 | 搜索修改 | 低 |

---

## 五、测试验证清单

- [ ] `npm run build` 编译通过
- [ ] Agent SSE 对话流正常（普通对话 + 工具调用）
- [ ] Token 统计接口返回的百分比与 Agent 实际使用时一致
- [ ] 手动压缩功能正常触发并返回正确统计
- [ ] 会话设置继承逻辑（角色 → 会话覆盖）行为不变
- [ ] 思维链（thinking）开启/关闭/未支持三种状态均正常
- [ ] `userMessageId` 加载范围正确（再生 mode 不影响历史范围）

---

## 六、影响范围总结

| 维度 | 变化 |
|---|---|
| API 接口 | 无变化（Controller 接口不变） |
| 数据库 | 无变化 |
| 前端 | 无变化 |
| 新增文件 | 1 个（`session-context.service.ts`） |
| 删除文件 | 1 个（`agent.service.ts` → 重命名为 `agent-engine.service.ts`） |
| 修改文件 | 2 个（`session.service.ts` 精简，`chat.module.ts` 注册新服务） |
| 核心逻辑 | 不动（ReAct 循环、LLM 流式、压缩算法全部保持原样） |
