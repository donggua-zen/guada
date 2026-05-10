/**
 * 流式响应 Mock 服务（纯函数实现）
 * 用于前端开发和测试，模拟后端 LLM 的流式输出
 */

import type { StreamEvent } from '@/types/service'

/**
 * Mock 配置选项
 */
export interface MockConfig {
  /** 是否启用思考过程 */
  enableThinking?: boolean
  /** 是否启用工具调用 */
  enableToolCalls?: boolean
  /** 每个 chunk 之间的延迟（毫秒） */
  chunkDelay?: number
  /** 思考过程的延迟（毫秒） */
  thinkingDelay?: number
  /** 工具调用的延迟（毫秒） */
  toolCallDelay?: number
  /** 模拟错误类型：'none' | 'timeout' | 'network_error' | 'api_error' */
  errorType?: 'none' | 'timeout' | 'network_error' | 'api_error'
  /** 触发错误的时机（在第几个 chunk 后触发） */
  errorAtChunk?: number
  /** 自定义文本内容 */
  customText?: string
  /** 自定义思考内容 */
  customThinking?: string
  /** 自定义工具调用 */
  customToolCalls?: any[]
}

/**
 * 默认 Mock 配置
 */
const DEFAULT_CONFIG: MockConfig = {
  enableThinking: false,
  enableToolCalls: false,
  chunkDelay: 50,
  thinkingDelay: 800,
  toolCallDelay: 1500,
  errorType: 'none',
  errorAtChunk: -1,
  customText: undefined,
  customThinking: undefined,
  customToolCalls: undefined,
}

/**
 * 预设场景配置
 */
export const MOCK_SCENARIOS = {
  /** 正常文本输出 */
  NORMAL_TEXT: {
    enableThinking: false,
    enableToolCalls: false,
    chunkDelay: 30,
    customText: '这是一个正常的文本回复示例。Mock 服务可以模拟各种流式输出场景，帮助您在前端开发过程中快速验证 UI 交互效果，而无需依赖后端服务。',
  } as MockConfig,

  /** 包含思考过程 */
  WITH_THINKING: {
    enableThinking: true,
    enableToolCalls: false,
    chunkDelay: 40,
    thinkingDelay: 1000,
    customThinking: '让我分析一下用户的问题...\n\n首先，我需要理解用户的需求。\n\n然后，我可以提供相应的解决方案。',
    customText: '根据我的分析，这个问题可以通过以下步骤解决：\n\n1. 第一步：明确问题\n2. 第二步：分析原因\n3. 第三步：提供方案\n\n希望这个回答对您有帮助！',
  } as MockConfig,

  /** 工具调用场景 */
  WITH_TOOL_CALLS: {
    enableThinking: false,
    enableToolCalls: true,
    chunkDelay: 50,
    toolCallDelay: 1200,
    customToolCalls: [
      {
        id: 'call_abc123',
        index: 0,
        type: 'function',
        name: 'get_current_time',
        arguments: '{}',
      },
    ],
    customText: '当前时间是 2026-04-16 10:30:00。请问还有什么可以帮助您的吗？',
  } as MockConfig,

  /** 思考 + 工具调用 */
  THINKING_AND_TOOLS: {
    enableThinking: true,
    enableToolCalls: true,
    chunkDelay: 40,
    thinkingDelay: 800,
    toolCallDelay: 1000,
    customThinking: '用户询问当前时间，我需要调用时间工具来获取准确信息。',
    customToolCalls: [
      {
        id: 'call_xyz789',
        index: 0,
        type: 'function',
        name: 'get_current_time',
        arguments: '{}',
      },
    ],
    customText: '根据系统时间，现在是 2026年4月16日 星期四 10:30:00。',
  } as MockConfig,

  /** 网络超时错误 */
  ERROR_TIMEOUT: {
    enableThinking: false,
    enableToolCalls: false,
    chunkDelay: 50,
    errorType: 'timeout',
    errorAtChunk: 5,
    customText: '这是一段很长的文本，会在中途被中断...',
  } as MockConfig,

  /** API 错误 */
  ERROR_API: {
    enableThinking: false,
    enableToolCalls: false,
    chunkDelay: 50,
    errorType: 'api_error',
    errorAtChunk: 3,
    customText: '处理中...',
  } as MockConfig,

  /** 长文本输出（测试滚动容器） */
  LONG_TEXT: {
    enableThinking: false,
    enableToolCalls: false,
    chunkDelay: 20,
    customText: `**满足智能问答所需的模型参数量级，主要取决于你的具体场景、复杂度和硬件环境。** 以下从不同需求维度进行分析：

---

## 智能问答的层次与对应模型规模

| 需求层次 | 典型场景 | 建议参数量级 | 代表模型 | 性能表现（参考基准） |
|----------|----------|--------------|----------|---------------------|
| **基础问答** | 简单事实查询、FAQ、客服基础回复、日常闲聊 | **1.5B‑3B** | DeepSeek‑R1‑Distill‑Qwen‑1.5B、Qwen3‑1.7B、ChatGLM3‑6B‑INT4 | MATH ≈ 80+、HumanEval ≈ 50%+，响应快（5‑15 token/s） |
| **中等推理** | 多轮对话、逻辑推理、数学计算、代码生成、中等复杂度专业问答 | **3B‑7B** | Qwen2.5‑3B、Llama‑3‑8B‑Instruct、DeepSeek‑R1‑7B | MMLU ≈ 70‑75%，HumanEval ≈ 65‑70%，具备较强的连贯性与逻辑性 |
| **深度专业** | 医疗/法律/金融领域深度解析、长文本创作、复杂问题拆解、研究级问答 | **7B‑13B+** | Qwen2.5‑7B、Baichuan2‑13B、Llama‑3.1‑8B | MMLU > 75%，HumanEval > 70%，在专业任务上接近商用水准 |
| **高精度/多模态** | 图文问答、跨文档分析、高难度科学问题、创造性生成 | **7B+（或专用多模态模型）** | Qwen‑VL‑8B、InternLM‑X‑Composer‑7B、Yi‑VL‑6B | 需结合视觉/文本双模态理解，参数量与算力要求更高 |

---

## ⚙️ 结合硬件平台的推荐（基于你之前的提问）

| 硬件平台 | 推荐模型参数量 | 量化要求 | 预期表现 |
|----------|----------------|----------|----------|
| **RK3568**（1 TOPS NPU，内存通常 2‑4 GB） | **≤1.5B**（必须量化） | INT8/INT4 深度量化 | Token 速度 1‑5 个/秒，适合**基础问答**，复杂场景会吃力 |
| **RK3588**（6 TOPS NPU，内存可配 4‑8 GB） | **≤3B**（推荐量化） | INT8/INT4 量化 | Token 速度 5‑15 个/秒，可流畅运行**中等推理**级问答 |
| **高性能 GPU 服务器**（如 RTX 4090 24 GB） | **≤7B**（FP16）或 **≤14B**（INT4） | FP16 / INT8 / INT4 | Token 速度 20‑50 个/秒，可覆盖**深度专业**问答需求 |

---

## 关键能力对比（基于实测数据）

| 模型参数量 | 逻辑推理（MATH） | 代码生成（HumanEval） | 知识问答（MMLU） | 长文本连贯性 |
|------------|-----------------|---------------------|-----------------|--------------|
| **1.5B** ≈ 80 分 ≈ 50% ≈ 60‑65% 较弱，适合短文 |
| **3B** ≈ 85‑88 分 ≈ 60‑65% ≈ 68‑72% 中等，可处理千字级 |
| **7B** ≈ 90+ 分 ≈ 70‑75% ≈ 74‑78% 强，可创作数千字长文 |

> **注意**：经过知识蒸馏的轻量模型（如 DeepSeek‑R1‑Distill‑Qwen‑1.5B）能在 1.5B 参数下实现接近 7B 模型的推理能力，是边缘设备的首选。

---

## 如何选择？按场景匹配

### 1. **边缘/嵌入式场景**（RK3568/RK3588）
- **基础客服、语音助手、简单问答** → **1.5B 量化模型**（如 DeepSeek‑R1‑Distill‑Qwen‑1.5B‑INT8）
- **多轮对话、轻度推理、代码提示** → **3B 量化模型**（如 Qwen2.5‑3B‑INT8，需 RK3588 以上）

### 2. **本地服务器场景**（RTX 4060 Ti 16GB 以上）
- **专业客服、教育辅导、文档分析** → **7B 模型**（如 Qwen2.5‑7B‑FP16）
- **复杂代码生成、学术问答、长文档总结** → **7B‑13B 模型**（需 24GB+ 显存）

### 3. **云端/高性能场景**（A100/H100）
- **研究级问答、高精度多模态、大规模知识库问答** → **13B+ 模型或专用大模型**

---

## 实践建议

1. **先量化，再部署**：无论模型大小，都建议使用 INT8/INT4 量化，可减少 50‑75% 的内存占用，对嵌入式设备尤其关键。
2. **测试验证**：用实际业务问题制作小样本集（100‑200 条），对比不同规模模型在 **正确率、响应速度、稳定性** 上的表现。
3. **硬件与模型的平衡**：不要盲目追求大模型，在 RK3588 上流畅运行的 3B 量化模型，体验往往优于勉强加载的 7B 模型。
4. **考虑 RAG 增强**：若模型知识不足，可通过检索增强生成（RAG）连接外部知识库，用小模型也能获得准确的专业答案。

---

## 总结
- **基础智能问答**：**1.5B‑3B** 参数模型已足够。
- **中等复杂度推理**：**3B‑7B** 参数模型效果显著提升。
- **专业深度问答**：建议 **7B+** 参数模型。
- **在 RK3568/RK3588 上**：优先选择 **≤1.5B**（RK3568）或 **≤3B**（RK3588）的量化模型，确保流畅运行。

如果你能分享具体的应用场景（如客服、教育、医疗等）和硬件配置，我可以给出更针对性的模型推荐。`,
  } as MockConfig,
}

/**
 * 生成唯一的 ID
 */
function generateId(): string {
  return `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 生成 turns ID
 */
function generateTurnsId(): string {
  return `turns_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 将文本分割成 chunks
 */
function splitTextIntoChunks(text: string, chunkSize: number = 3): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize))
  }
  return chunks
}

/**
 * 创建 Mock 错误对象
 */
function createMockError(errorType: string): Error {
  switch (errorType) {
    case 'timeout':
      const timeoutError = new Error('Request timed out')
      timeoutError.name = 'TimeoutError'
      return timeoutError

    case 'network_error':
      const networkError = new Error('Network error: Failed to fetch')
      networkError.name = 'NetworkError'
      return networkError

    case 'api_error':
      const apiError = new Error('API Error: Internal server error (500)')
      apiError.name = 'APIError'
      return apiError

    default:
      return new Error('Unknown error')
  }
}

/**
 * Mock 流式聊天生成器（纯函数）
 * 
 * @param sessionId 会话 ID
 * @param messageId 用户消息 ID
 * @param config Mock 配置
 * @param assistantMessageId 现有助手消息 ID（用于 multi_version 模式）
 * @param regenerationMode 再生模式：'overwrite' | 'multi_version' | 'append'
 * @returns 异步生成器，产生 StreamEvent
 */
export async function* mockChatStream(
  sessionId: string,
  messageId: string,
  config: MockConfig = {},
  assistantMessageId?: string | null,
  regenerationMode?: string | null
): AsyncGenerator<StreamEvent, void, unknown> {
  // 合并配置
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }
  const {
    enableThinking,
    enableToolCalls,
    chunkDelay,
    thinkingDelay,
    toolCallDelay,
    errorType,
    errorAtChunk,
    customText,
    customThinking,
    customToolCalls,
  } = mergedConfig

  // 生成 IDs
  // multi_version 模式下使用传入的 assistantMessageId，否则生成新的
  const finalAssistantMessageId = (regenerationMode === 'multi_version' && assistantMessageId) 
    ? assistantMessageId 
    : generateId()
  const turnsId = generateTurnsId()
  const contentId = generateId()

  console.log(`[Mock] 开始模拟流式响应`, {
    regenerationMode,
    assistantMessageId: finalAssistantMessageId,
    isNewMessage: regenerationMode !== 'multi_version'
  })

  // 发送 create 事件
  yield {
    type: 'create',
    messageId: finalAssistantMessageId,
    turnsId,
    contentId,
    modelName: 'mock-model-v1',
  }

  let chunkCount = 0

  // 检查是否应该在开始时触发错误
  if (errorType !== 'none' && errorAtChunk === 0) {
    await delay(chunkDelay || 50)
    throw createMockError(errorType || 'api_error')
  }

  // 阶段 1: 思考过程
  if (enableThinking && customThinking) {
    await delay(thinkingDelay || 800)

    const thinkingChunks = splitTextIntoChunks(customThinking, 5)
    for (const chunk of thinkingChunks) {
      chunkCount++

      // 检查是否应该在此处触发错误
      if (errorType !== 'none' && errorAtChunk && errorAtChunk > 0 && chunkCount >= errorAtChunk) {
        throw createMockError(errorType || 'api_error')
      }

      yield {
        type: 'think',
        msg: chunk,
      }

      await delay(chunkDelay || 50)
    }
  }

  // 阶段 2: 工具调用
  if (enableToolCalls && customToolCalls && customToolCalls.length > 0) {
    await delay(toolCallDelay || 1500)

    // 发送工具调用事件
    yield {
      type: 'tool_call',
      toolCalls: customToolCalls.map((tc, index) => ({
        ...tc,
        index,
      })),
    }

    // 模拟工具执行延迟
    await delay(toolCallDelay || 1500)

    // 发送工具调用响应
    yield {
      type: 'tool_calls_response',
      toolCallsResponse: customToolCalls.map((tc) => ({
        role: 'tool',
        name: tc.name,
        content: `Mock result for ${tc.name}`,
        toolCallId: tc.id,
      })),
      usage: {
        promptTokens: 150,
        completionTokens: 50,
        totalTokens: 200,
      },
    }
  }

  // 阶段 3: 文本内容
  const textToStream = customText || '这是一个默认的 Mock 回复。您可以配置不同的场景来测试各种交互效果。'
  const textChunks = splitTextIntoChunks(textToStream, 2)

  for (const chunk of textChunks) {
    chunkCount++

    // 检查是否应该在此处触发错误
    if (errorType !== 'none' && errorAtChunk && errorAtChunk > 0 && chunkCount >= errorAtChunk) {
      throw createMockError(errorType || 'api_error')
    }

    yield {
      type: 'text',
      msg: chunk,
    }

    await delay(chunkDelay || 50)
  }

  // 阶段 4: 完成事件
  await delay(100)

  yield {
    type: 'finish',
    finishReason: 'stop',
    usage: {
      promptTokens: 120,
      completionTokens: textToStream.length,
      totalTokens: 120 + textToStream.length,
    },
  }

  console.log(`[Mock] 流式响应完成`)
}

/**
 * 获取所有可用的 Mock 场景
 */
export function getAvailableScenarios(): Record<string, MockConfig> {
  return MOCK_SCENARIOS
}

/**
 * 根据场景名称获取配置
 */
export function getScenarioConfig(scenarioName: keyof typeof MOCK_SCENARIOS): MockConfig {
  return MOCK_SCENARIOS[scenarioName]
}
