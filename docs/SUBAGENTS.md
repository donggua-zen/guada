现在我有足够的全景信息来写文档了。以下就是完整的技术方案文档：

---

# 子 Agent 功能开发技术方案

## 1. 概述

### 1.1 需求

父 Agent 在对话中可以创建子 Agent 完成特定子任务。每个子 Agent 拥有：
- **独立的会话上下文**（独立的 `ConversationContext`、Token 计数、压缩检查点）
- **独立的消息历史**（子 Agent 的对话不会混入父会话）
- **独立的流式输出**（通过独立 SSE 连接输出到独立 Tab）
- **隶属于父会话**（UI 上以 Tab 形式呈现，数据上通过 `parentId` 关联）

### 1.2 设计哲学

**子 Agent = 完整会话**。复用现有 `Session → Message → MessageContent` 体系，复用 `AgentEngine → SessionStreamManager → ConversationContext → CompressionEngine` 整条链路。

```
主会话 (Session A)         子会话 (Session A_sub_1)     子会话 (Session A_sub_2)
├── sessionId: "abc"       ├── sessionId: "abc_sub_1"   ├── sessionId: "abc_sub_2"
├── parentId: null         ├── parentId: "abc"          ├── parentId: "abc"
├── SessionStreamManager   ├── SessionStreamManager     ├── SessionStreamManager
├── ConversationContext    ├── ConversationContext      ├── ConversationContext
└── AgentEngine            └── SubAgentEngine           └── SubAgentEngine
```

**连接数**：每个子 Agent 独立 SSE 连接，前端**按 Tab 切换按需建立**。典型场景 1~2 个连接，最多 4 个。

---

## 2. 数据层

### 2.1 Session 表新增字段

```prisma
// prisma/schema.prisma

model Session {
  id            String    @id @default(cuid())
  // ... 现有字段保持不变 ...

  parentId      String?   @map("parent_id")     // ← 新增：父会话 ID
  parent        Session?  @relation("SessionHierarchy", fields: [parentId], references: [id])
  children      Session[] @relation("SessionHierarchy")

  @@index([parentId])
  @@index([userId])
  @@index([sessionType])
  // ... 其他索引保持不变 ...
}
```

### 2.2 Migration

```bash
cd backend-ts
npx prisma migrate dev --name add_sub_session_support
```

---

## 3. 后端

### 3.1 新增：SubSessionRepository

```typescript
// src/common/database/sub-session.repository.ts

@Injectable()
export class SubSessionRepository {
  constructor(private prisma: PrismaService) {}

  /**
   * 创建子会话记录
   */
  async create(data: {
    parentSessionId: string
    title?: string
    characterId?: string
    modelId?: string
    settings?: any
  }) {
    return this.prisma.session.create({
      data: {
        userId: '',  // 继承父会话，稍后填充
        parentId: data.parentSessionId,
        title: data.title || '子任务',
        characterId: data.characterId,
        modelId: data.modelId,
        settings: data.settings || {},
        sessionType: 'sub_agent',
      },
    })
  }

  /**
   * 查找指定父会话下的子会话
   */
  async findByParentId(parentSessionId: string) {
    return this.prisma.session.findMany({
      where: { parentId: parentSessionId },
      orderBy: { createdAt: 'asc' },
    })
  }

  /**
   * 更新子会话状态/结果
   */
  async update(id: string, data: { title?: string; settings?: any }) {
    return this.prisma.session.update({
      where: { id },
      data,
    })
  }
}
```

### 3.2 新增：SubAgentToolProvider

```typescript
// src/modules/tools/providers/sub-agent-tool.provider.ts

@Injectable()
export class SubAgentToolProvider implements IToolProvider {
  public readonly namespace = 'sub_agent'

  constructor(
    private subAgentManager: SubAgentManager,
  ) {}

  async getTools(enabled?: boolean | string[], context?: Record<string, any>): Promise<any[]> {
    if (enabled === false) return []

    return [{
      name: 'spawn_sub_agent',
      description: `创建一个子 Agent 独立执行指定任务。
子 Agent 拥有独立的对话上下文和工具能力，完成后返回结果摘要。
适用于：需要独立研究的复杂问题、多步骤分析、代码生成等。

使用示例：
- "分析这份财报的财务健康状况" → 子Agent专注于分析
- "写一个完整的用户登录模块" → 子Agent专注于编码
- "搜索并整理最近的AI新闻" → 子Agent专注于搜索`,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '子 Agent 的名称（用于 Tab 标题显示，简洁明了，如"财报分析"、"代码生成"）',
          },
          task: {
            type: 'string',
            description: '子 Agent 需要完成的具体任务描述（越详细越好，包含所有必要的背景信息）',
          },
          instructions: {
            type: 'string',
            description: '子 Agent 的系统指令，定义其行为模式、约束条件和输出格式要求',
          },
          model: {
            type: 'string',
            description: '可选：指定子 Agent 使用的模型名称，不填则继承父会话的模型',
          },
        },
        required: ['name', 'task', 'instructions'],
      },
    }]
  }

  async execute(
    request: ToolCallRequest,
    context?: Record<string, any>,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const params = request.arguments

    const result = await this.subAgentManager.spawnAndRun({
      parentSessionId: context?.sessionId,
      userId: context?.userId,
      name: params.name,
      task: params.task,
      instructions: params.instructions,
      modelName: params.model,
      parentToolContext: context,
      abortSignal,
    })

    return JSON.stringify({
      success: true,
      subSessionId: result.subSessionId,
      summary: result.summary,
    })
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    return `## 子 Agent 工具\n\n你可以通过 \`spawn_sub_agent\` 创建子 Agent 来独立执行复杂任务。\n子 Agent 完成后会返回结果摘要，你可以基于此继续对话。\n\n**执行流程**：\n1. 在 task 中提供完整的背景信息和任务描述\n2. 在 instructions 中给出明确的行为指南\n3. 子 Agent 独立运行，完成后返回结果\n4. 检查结果，如有需要可创建更多子 Agent`
  }

  getMetadata(context?: Record<string, any>): ToolProviderMetadata {
    return {
      namespace: 'sub_agent',
      displayName: '子 Agent',
      description: '创建子 Agent 独立执行特定任务',
      isMcp: false,
      loadMode: 'lazy',
      type: 'core',
    }
  }

  formatDisplayMessage?(toolName: string, args: Record<string, any>): ToolDisplayInfo {
    return {
      action: '创建子任务',
      args: args.name || args.task?.substring(0, 30),
      toolName: 'spawn_sub_agent',
      toolType: 'sub_agent',
    }
  }
}
```

### 3.3 新增：SubAgentManager

```typescript
// src/modules/chat/sub-agent.manager.ts

@Injectable()
export class SubAgentManager {
  private readonly logger = new Logger(SubAgentManager.name)

  constructor(
    private subSessionRepo: SubSessionRepository,
    private sessionContextService: SessionContextService,
    private conversationContextFactory: ConversationContextFactory,
    private toolOrchestrator: ToolOrchestrator,
    private toolContextFactory: ToolContextFactory,
    private llmService: LLMService,
    private modelRepository: ModelRepository,
    private sessionRepo: SessionRepository,
    private settingsStorage: SettingsStorage,
    private workspaceService: WorkspaceService,
  ) {}

  /**
   * 创建并执行子 Agent，返回结果
   */
  async spawnAndRun(params: {
    parentSessionId: string
    userId: string
    name: string
    task: string
    instructions: string
    modelName?: string
    parentToolContext?: any
    abortSignal?: AbortSignal
  }): Promise<{ subSessionId: string; summary: string }> {
    // 1. 获取父会话信息（继承配置）
    const parentSession = await this.sessionRepo.findById(params.parentSessionId)
    if (!parentSession) throw new Error('父会话不存在')

    // 2. 创建子会话记录
    const subSession = await this.subSessionRepo.create({
      parentSessionId: params.parentSessionId,
      title: params.name,
      characterId: parentSession.characterId,
      modelId: null,  // 下面按优先级解析
      settings: {
        systemPrompt: params.instructions,
        thinkingEffort: 'off',
        memory: { maxMemoryLength: 50, summaryMode: 'fast' },
      },
    })

    // 3. 组装完整的子会话对象
    const subSessionObj = {
      ...subSession,
      userId: params.userId,
      character: parentSession.character,
      settings: {
        systemPrompt: params.instructions,
        thinkingEffort: 'off',
        memory: { maxMemoryLength: 50, summaryMode: 'fast' },
        modelTemperature: parentSession.settings?.modelTemperature,
        modelTopP: parentSession.settings?.modelTopP,
      },
    }

    // 4. 解析模型
    let model = null
    if (params.modelName) {
      // 按名称查找模型
      // ...
    }
    if (!model) {
      model = parentSession.model
    }
    subSessionObj.model = model

    // 5. 广播 sub_agent_start 事件到父会话流
    this.broadcastToParentStream(params.parentSessionId, {
      type: 'sub_agent_start',
      subSessionId: subSession.id,
      name: params.name,
    })

    // 6. 构建子 Agent 的上下文
    const workspacePath = this.workspaceService.resolveSessionWorkspaceDir(subSessionObj)
    const toolContext = await this.toolContextFactory.createContext(
      { sessionId: subSession.id, userId: params.userId, sessionType: 'sub_agent', workspacePath },
      null, null, [],
    )

    // 7. 构建并初始化 ConversationContext
    const context = await this.conversationContextFactory.create(subSession.id, params.userId)
    const merged = this.sessionContextService.mergeSettings(subSessionObj)
    const toolPrompts = await this.toolOrchestrator.getAllToolPrompts(toolContext)
    const fullSystemPrompt = [merged.systemPrompt, toolPrompts].filter(Boolean).join('\n')

    await context.initialize({
      memory: merged.memory,
      systemPrompt: `${fullSystemPrompt}\n\n## 当前任务\n${params.task}`,
      contextWindow: model?.config?.contextWindow || 128000,
      model: model || undefined,
    })

    // 8. 获取工具定义
    const tools = await this.toolOrchestrator.getAllTools(toolContext)

    // 9. 执行子 Agent ReAct 循环
    const session = subSessionObj
    const result = await this.executeSubAgentLoop(
      context, session, tools, toolContext, params.abortSignal,
      subSession.id, params.parentSessionId,
    )

    // 10. 广播 sub_agent_finish 事件
    this.broadcastToParentStream(params.parentSessionId, {
      type: 'sub_agent_finish',
      subSessionId: subSession.id,
      status: 'completed',
      result: result.summary,
    })

    return {
      subSessionId: subSession.id,
      summary: result.summary,
    }
  }

  /**
   * 子 Agent 的 ReAct 循环（简化版，无审批流程）
   */
  private async executeSubAgentLoop(
    context: IConversationContext,
    session: any,
    tools: any[],
    toolContext: any,
    abortSignal: AbortSignal | undefined,
    subSessionId: string,
    parentSessionId: string,
  ): Promise<{ summary: string }> {
    const MAX_ITERATIONS = 20
    let iterationCount = 0
    let needToContinue = false

    do {
      iterationCount++
      needToContinue = false

      const messages = await context.getMessages()
      const stream = this.llmService.completions({
        model: session.model?.modelName,
        messages,
        tools,
        temperature: session.settings?.modelTemperature,
        topP: session.settings?.modelTopP,
        maxTokens: session.model?.config?.maxOutputTokens,
        providerConfig: session.model?.provider,
        stream: true,
        abortSignal,
      })

      // 累加响应
      let content = ''
      let toolCalls: any[] | undefined

      for await (const chunk of stream) {
        if (chunk.content) content += chunk.content
        if (chunk.toolCalls) toolCalls = chunk.toolCalls
      }

      // 构建助手回复
      const assistantMsg: MessageRecord = {
        role: 'assistant',
        content,
        toolCalls,
        messageId: context.generateId(),
        contentId: context.generateId(),
        turnsId: context.generateId(),
      }

      // 执行工具
      const parts: MessageRecord[] = [assistantMsg]

      if (toolCalls && toolCalls.length > 0) {
        if (iterationCount >= MAX_ITERATIONS) {
          assistantMsg.metadata = { finishReason: 'max_iterations' }
        } else {
          const toolResults = await this.toolOrchestrator.executeBatch(
            toolCalls.map(tc => ({
              id: tc.id, name: tc.name,
              arguments: this.safeJsonParse(tc.arguments),
            })),
            toolContext,
            abortSignal,
          )

          for (const res of toolResults) {
            parts.push({
              role: 'tool',
              name: res.name,
              content: res.content,
              toolCallId: res.toolCallId,
              messageId: assistantMsg.messageId,
              turnsId: assistantMsg.turnsId,
            })
          }
          needToContinue = true
        }
      }

      await context.appendParts(parts)
    } while (needToContinue)

    // 生成最终摘要
    const history = context.getHistory()
    const summary = this.generateSummary(history)

    return { summary }
  }

  private broadcastToParentStream(parentSessionId: string, event: any) {
    // 通过父会话的 SessionStreamManager 广播子 Agent 事件
  }
}
```

### 3.4 改造：AgentEngine — 工具路由

在 `executeAgentLoop` 的工具执行阶段，`spawn_sub_agent` 会被 `ToolOrchestrator` 自动路由到 `SubAgentToolProvider.execute()`，无需特殊处理。**但需要在流中额外广播子 Agent 事件**：

```typescript
// agent-engine.service.ts — executeAgentLoop 中新增
// 在 toolOrchestrator.executeBatch 返回后，检测结果中的 subSessionId
if (toolName === 'spawn_sub_agent') {
  const subResult = JSON.parse(content)
  
  // 广播到主流，前端收到后创建 Tab
  this.streamManager.broadcast(sessionId, {
    type: 'sub_agent_start',
    subSessionId: subResult.subSessionId,
    name: toolArgs.name,
  })
  
  // 当前工具响应内容 = 子 Agent 的结果摘要
  // 子 Agent 完成后，广播 finish 事件
  // ✅ 不需要额外逻辑，SubAgentManager 自己会广播 finish
}
```

### 3.5 注册：ToolsModule

```typescript
// tools.module.ts
@Module({
  providers: [
    // ... 现有 providers
    SubAgentToolProvider,
    SubAgentManager,    // ← 新增
    SubSessionRepository,  // ← 新增
  ],
})
export class ToolsModule implements OnModuleInit {
  constructor(
    private toolOrchestrator: ToolOrchestrator,
    private subAgentToolProvider: SubAgentToolProvider,  // ← 新增
  ) {}

  onModuleInit() {
    this.toolOrchestrator.addProvider(this.subAgentToolProvider)  // ← 新增
  }
}
```

---

## 4. 前端

### 4.1 类型扩展

```typescript
// frontend/src/types/service.ts — 新增

export interface StreamSubAgentStartEvent {
  type: 'sub_agent_start'
  subSessionId: string
  name: string
}

export interface StreamSubAgentFinishEvent {
  type: 'sub_agent_finish'
  subSessionId: string
  status: 'completed' | 'error'
  result?: string
  error?: string
}

// StreamEvent 联合类型追加
export type StreamEvent =
    | StreamCreateEvent
    | StreamThinkEvent
    | StreamToolCallEvent
    | StreamToolCallsResponseEvent
    | StreamTextEvent
    | StreamFinishEvent
    | StreamCompressionStartEvent
    | StreamCompressionErrorEvent
    | StreamSubAgentStartEvent       // ← 新增
    | StreamSubAgentFinishEvent      // ← 新增
```

### 4.2 改造：ChatPage.vue — Tab 容器

```vue
<!-- ChatPage.vue -->
<template>
  <div class="flex flex-col h-full w-full">
    <template v-if="sessionStore.activeSessionId !== 'new-session'">
      <!-- 子 Agent Tab 栏 -->
      <AgentTabBar
        v-if="agentTabs.length > 1"
        :tabs="agentTabs"
        :active-tab="activeTabId"
        @switch="switchTab"
        @close="closeSubAgentTab"
      />

      <div class="flex-1 overflow-hidden">
        <!-- 主会话面板 -->
        <ChatPanel
          v-show="activeTabId === 'main'"
          ref="mainPanelRef"
          :session="currentSession"
          :key="'main'"
          @sub-agent-event="onSubAgentEvent"
          @save-settings="handleSaveSessionSettings"
          @toggle-workspace-pane="layoutStore.toggleWorkspace"
        />

        <!-- 子 Agent 面板（懒加载） -->
        <ChatPanel
          v-for="tab in visibleSubPanels"
          :key="tab.id"
          v-show="activeTabId === tab.id"
          :session="tab.session"
          :readonly="true"
          :hide-header="true"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
interface AgentTab {
  id: string
  name: string
  status: 'running' | 'completed' | 'error'
  session?: Session | null   // 懒加载
  loaded: boolean
}

const agentTabs = ref<AgentTab[]>([
  { id: 'main', name: computed(() => currentSession.value?.title || '主代理'), status: 'completed', loaded: true }
])
const activeTabId = ref('main')

// 只在激活 Tab 时才创建 ChatPanel，未激活的销毁
const visibleSubPanels = computed(() => {
  return agentTabs.value.filter(t => t.id === activeTabId.value && t.id !== 'main')
})

/**
 * 从主 SSE 事件中桥接子 Agent 事件
 */
function onSubAgentEvent(event: StreamSubAgentStartEvent | StreamSubAgentFinishEvent) {
  if (event.type === 'sub_agent_start') {
    // Tab 栏出现，但不建连
    agentTabs.value.push({
      id: event.subSessionId,
      name: event.name,
      status: 'running',
      session: null,
      loaded: false,
    })
  } else if (event.type === 'sub_agent_finish') {
    const tab = agentTabs.value.find(t => t.id === event.subSessionId)
    if (tab) tab.status = event.status === 'completed' ? 'completed' : 'error'
  }
}

/**
 * 切换 Tab → 按需加载子会话
 */
async function switchTab(tabId: string) {
  activeTabId.value = tabId
  if (tabId === 'main' || !tabId.startsWith('sub_')) return

  const tab = agentTabs.value.find(t => t.id === tabId)
  if (tab && !tab.session) {
    try {
      tab.session = await apiService.fetchSession(tabId)
      tab.loaded = true
    } catch (e) {
      console.error('加载子会话失败:', e)
    }
  }
}
</script>
```

### 4.3 新增：AgentTabBar 组件

```vue
<!-- components/chat/AgentTabBar.vue -->
<template>
  <div class="agent-tab-bar flex items-center gap-1 px-4 py-1 bg-gray-50 dark:bg-[#1c1d20] border-b border-gray-200 dark:border-[#2a2c30] overflow-x-auto">
    <div
      v-for="tab in tabs" :key="tab.id"
      class="agent-tab flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer text-sm whitespace-nowrap select-none transition-all"
      :class="{
        'bg-white dark:bg-[#2a2c30] text-gray-900 dark:text-[#e8e9ed] shadow-sm': tab.id === activeTab,
        'text-gray-500 dark:text-[#8b8d95] hover:bg-gray-100 dark:hover:bg-[#25262a]': tab.id !== activeTab,
      }"
      @click="$emit('switch', tab.id)"
    >
      <!-- 运行状态指示器 -->
      <el-icon v-if="tab.status === 'running'" class="is-loading text-blue-500" size="12">
        <Loading />
      </el-icon>
      <span v-else-if="tab.status === 'completed'" class="w-3 h-3 rounded-full bg-green-500" />
      <span v-else class="w-3 h-3 rounded-full bg-red-500" />

      <span>{{ tab.name }}</span>

      <!-- 关闭按钮（仅子 Agent） -->
      <el-icon
        v-if="tab.id !== 'main'" size="14"
        class="ml-1 rounded hover:bg-gray-200 dark:hover:bg-[#3a3c40] p-0.5"
        @click.stop="$emit('close', tab.id)"
      >
        <Close />
      </el-icon>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  tabs: AgentTab[]
  activeTab: string
}>()
defineEmits<{
  switch: [tabId: string]
  close: [tabId: string]
}>()
</script>
```

### 4.4 改造：ChatPanel.vue — 新增 3 个 prop + 条件分支

**Props 扩展**：
```typescript
const props = defineProps<{
  session: Session | null
  readonly?: boolean           // 子 Agent 只读模式（新增，默认 false）
  hideHeader?: boolean         // 子 Agent 隐藏标题栏（新增，默认 false）
}>()
```

**子 Agent 事件桥接（在 useStreamResponse 的 processStreamLoop 中）**：

```typescript
// useStreamResponse.ts

// 新增回调注册
type SubAgentEventCallback = (event: StreamSubAgentStartEvent | StreamSubAgentFinishEvent) => void
let onSubAgentEvent: SubAgentEventCallback | null = null

export function setSubAgentEventCallback(cb: SubAgentEventCallback | null) {
  onSubAgentEvent = cb
}

// processStreamLoop 中增加
for await (const response of apiService.chat(chatParams)) {
  // 子 Agent 事件桥接（不处理，透传）
  if (response.type === 'sub_agent_start' || response.type === 'sub_agent_finish') {
    onSubAgentEvent?.(response)
    continue
  }

  // ... 原有事件处理不变 ...
}
```

**Template 条件分支**：

```vue
<!-- ChatPanel.vue 模板 —— 只读分支 -->
<!-- 标题区域 -->
<template v-if="!hideHeader">
  <PageHeader :title="currentSession?.title || ''">
    <!-- 头部操作按钮（只读模式下隐藏） -->
  </PageHeader>
</template>

<!-- 消息区域（不变） -->
<MessageItem v-for="message in activeMessages" ... />

<!-- 输入区域 —— 只读模式不显示 -->
<template v-if="!readonly">
  <ChatInput ... />
</template>
```

### 4.5 sessionStore — 无需改动

因为 `sessionStore` 以 `sessionId` 为 key 存储消息，子会话 ID 不同，自动隔离：

```
sessionStore.getMessages("main_001")        → 主会话消息
sessionStore.getMessages("main_001_sub_a")  → 子 Agent A 消息（懒加载后自动填充）
```

---

## 5. SSE 事件流

### 5.1 完整事件时序

```
时间 →
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

主流 (SSE #1)      子流 A (SSE #2)       前端 Tab
│                    │                    │
├─ user_message ─────┼───────────────────→│ 主面板显示用户消息
├─ create ───────────┼───────────────────→│ 主面板创建助手消息
├─ text "我来分析..." ┼───────────────────→│ 主面板显示文本
├─ sub_agent_start ──┼───────────────────→│ Tab 栏出现"财报分析"Tab
│  (subSessionId,    │                    │ 但未切Tab，不建连
│   name="财报分析")  │                    │
├─ text "创建子任务..." ┼──────────────────→│ 主面板继续回复
├─ finish ───────────┼───────────────────→│ 主流完成
│                    │                    │
│   用户点击"财报分析"Tab                   │
│                    │                    │
├─ ← 用户切Tab ──────┼───────────────────→│ 建连 SSE #2
│                    ├─ subscribe ───────→│ 传入 lastContentId
│                    ├─ (buffer 事件) ────→│ 追赶上当前进度
│                    ├─ text "正在读取..." ─→│ 子 Tab 显示实时流
│                    ├─ tool_call ────────→│ 子 Tab 显示工具调用
│                    ├─ text "分析结果..." ─→│ 子 Tab 继续输出
│                    ├─ finish ──────────→│ 子 Tab 完成
│                    │                    │
├─ sub_agent_finish ─┼───────────────────→│ Tab 状态变"completed"
│  (status=completed) │                    │
```

### 5.2 关键设计细节

**「主流」何时完成？**

主 Agent 调用 `spawn_sub_agent` 后，进入 `await subAgentManager.spawnAndRun()`。子 Agent 在 SubAgentManager 内部**同步阻塞执行**，主 Agent 等待子 Agent 全部完成后才能继续。

这是合理的——子 Agent 的结果需要作为工具响应注入父 Agent 的下一轮 LLM。

**「子流」在前端的生命周期：**

1. 子 Agent 被创建 → 主流 `sub_agent_start` → Tab 出现（不建连）
2. 用户切 Tab → 发起 SSE（带 `sessionId=subSessionId`，`regenerationMode='subscribe'`）
3. 子 Agent 还在运行 → 追 buffer → 实时流式输出
4. 子 Agent 已完成 → 从 API 加载消息历史（`fetchSessionMessages`），渲染完整对话
5. 用户切回主 Tab → 不销毁子 SSE，保持连接后台继续接收

**「子流取消」如何处理：**

```typescript
// ChatStreamService — 复用现有 cancelResponse
apiService.cancelResponse(subSessionId)
// 后端 POST /chat/stream/:subSessionId/stop → 停止子 Agent 循环
```

---

## 6. 实施路线图

| 阶段 | 内容 | 文件 | 估时 |
|------|------|------|------|
| **P1 数据层** | Prisma 加 parentId + Migration | `schema.prisma` | 0.5h |
| **P2 后端工具** | SubAgentToolProvider + SubAgentManager + SubSessionRepository | 3 个新文件 | 4h |
| **P3 后端注册** | ToolsModule 注册 + AgentEngine 工具路由 | `tools.module.ts` | 0.5h |
| **P4 前端类型** | StreamSubAgentStart/FinishEvent 类型 | `types/service.ts` | 0.5h |
| **P5 前端 Tab** | AgentTabBar 组件 + ChatPage Tab 容器 | 2 个文件 | 3h |
| **P6 前端适配** | ChatPanel readonly 模式 + 事件桥接 | `ChatPanel.vue` + `useStreamResponse.ts` | 2h |
| **测试** | 全链路联调 | - | 2h |

**总计约 12.5h（2~3 个工作日）**

---

## 7. 边界情况与风险

| 场景 | 处理方式 |
|------|---------|
| 用户切 Tab 但子 Agent 已完成 | 从 `fetchSessionMessages` 加载历史，不走 SSE |
| 用户切 Tab 但子 Agent 还在跑 | 发起 SSE subscribe，追 buffer 后实时流式 |
| 主 Agent 调用多个子 Agent | 各自独立 Tab，各自独立 SSE |
| 子 Agent 耗时过长 | 走主 Agent 的 Tool Iteration 限制（40轮），超限后主 Agent 收到部分结果 |
| 刷新页面 | 主面板检查活跃流；子面板不自动重连，切 Tab 时重新建连 |
| 删除主会话 | 级联删除子会话（Prisma onDelete: Cascade） |
| 子 Agent 报错 | 错误结果作为工具响应返回，主 Agent 自行处理 |