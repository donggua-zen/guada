/// <reference types="jest" />

import { StreamChunk } from '../../../src/common/types/stream-chunk.types';
import type { SessionStreamEvent } from '../../../src/modules/chat/types/event-chunk.types';
import { AskService } from '../../../src/common/services/ask.service';
import { InteractionWaitService } from '../../../src/common/services/interaction-wait.service';

/**
 * SessionRepository Mock 工厂
 */
export function createMockSessionRepo(sessionData?: any) {
  const defaultSession = require('../fixtures/session-mock.json');
  return {
    findById: jest.fn().mockResolvedValue(sessionData || defaultSession),
    updateLastActiveAt: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * SessionLockService Mock 工厂
 * 支持模拟锁状态，用于测试并发控制
 */
export function createMockSessionLockService(options?: { shouldFail?: boolean }) {
  const locks = new Map<string, boolean>();
  const lockTimestamps = new Map<string, Date>();
  
  return {
    tryLock: jest.fn((sessionId: string) => {
      if (options?.shouldFail) {
        return false;
      }
      if (locks.has(sessionId)) {
        return false;
      }
      locks.set(sessionId, true);
      lockTimestamps.set(sessionId, new Date());
      return true;
    }),
    unlock: jest.fn((sessionId: string) => {
      locks.delete(sessionId);
      lockTimestamps.delete(sessionId);
    }),
    getLockStatus: jest.fn((sessionId: string) => ({
      isLocked: locks.has(sessionId),
      lockedAt: lockTimestamps.get(sessionId),
    })),
  };
}

/**
 * LLMService Mock 工厂
 * 
 * @param chunksOrGenerator 可以是 chunk 数组、生成器函数,或返回生成器的函数
 *                          支持多轮调用时返回不同的流
 */
export function createMockLLMService(
  chunksOrGenerator?: StreamChunk[] | (() => AsyncGenerator<StreamChunk>)
) {
  let callCount = 0;
  
  return {
    completions: jest.fn(() => {
      callCount++;
      
      // 如果传入的是函数,每次调用时执行它(支持多轮不同流)
      if (typeof chunksOrGenerator === 'function') {
        return chunksOrGenerator();
      }
      
      // 否则返回固定的 chunk 流
      const chunks = chunksOrGenerator || [];
      return (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();
    }),
    getCallCount: () => callCount,
  };
}

/**
 * ToolExecutor Mock 工厂
 */
export function createMockToolExecutor(options?: {
  toolCallsResponse?: any[];
}) {
  return {
    executeBatch: jest.fn().mockResolvedValue(
      options?.toolCallsResponse || [
        { 
          toolCallId: 'call_1', 
          name: 'test_tool', 
          content: 'Mock tool execution result', 
          isError: false 
        },
      ]
    ),
  };
}

/**
 * 创建 ISessionContext Mock（合并后包含对话状态）
 */
export function createMockSessionContext(options?: {
  contextWindow?: number;
  thinkingEffort?: string;
}) {
  return {
    sessionId: 'test-session-001',
    sessionType: 'web' as const,
    parentSessionId: null,
    characterId: null,
    workspacePath: '',
    getSandboxMode: jest.fn(() => 'workspace-write' as const),
    setSandboxMode: jest.fn().mockResolvedValue(undefined),
    setToolScope: jest.fn(),
    getToolScope: jest.fn(() => null),
    getModelConfig: jest.fn((): any => ({
      id: 'model-1',
      modelName: 'gpt-4',
      name: 'GPT-4',
      provider: { id: 'p1', provider: 'openai', protocol: 'openai' },
      modelType: 'chat',
      config: { features: ['tools', 'thinking'], contextWindow: options?.contextWindow || 8000, temperature: 0.7, topP: 1.0, frequencyPenalty: 0 },
    })),
    getModelParams: jest.fn(() => ({ temperature: 0.7, topP: 1.0, frequencyPenalty: 0 })),
    supportsFeature: jest.fn((f: string) => ['tools', 'thinking'].includes(f)),
    getThinkingEffort: jest.fn(() => options?.thinkingEffort || 'medium'),
    getResolvedPlugins: jest.fn((): any[] => [
      {
        enabled: true,
        effective: 'global',
        plugin: { id: 'test_plugin', name: 'Test', version: '1.0', description: '' },
        enabledTools: [
          { name: 'tool_load', description: 'Load tool', parameters: { type: 'object' as const, properties: {} }, handler: async () => 'ok' },
        ],
        allTools: [],
        enabledToolKits: [],
        interceptors: [],
      },
    ]),
    getSettings: jest.fn(() => ({})),
    appendAskAsked: jest.fn(async () => {}),
    appendAskAnswered: jest.fn(async () => {}),
    publishStream: jest.fn().mockResolvedValue(undefined),
    getMemoryConfig: jest.fn(() => ({})),
    getEffectiveContextWindow: jest.fn(() => options?.contextWindow || 8000),
    getWorkspacePath: jest.fn(() => ''),
    setMessageCursor: jest.fn(),
    // 对话状态方法
    initialize: jest.fn().mockResolvedValue(undefined),
    loadHistory: jest.fn().mockResolvedValue(undefined),
    getMessages: jest.fn().mockResolvedValue([]),
    getHistory: jest.fn().mockResolvedValue([]),
    getSystemText: jest.fn(() => ''),
    injectUserPrompt: jest.fn().mockResolvedValue(undefined),
    appendMessages: jest.fn().mockResolvedValue(undefined),
    persist: jest.fn().mockResolvedValue(undefined),
    finalizeTurn: jest.fn().mockResolvedValue(undefined),
    beginTurn: jest.fn().mockResolvedValue('turn-test-001'),
    deleteTurn: jest.fn().mockResolvedValue(undefined),
    resumeTurn: jest.fn().mockResolvedValue(undefined),
    addUserMessage: jest.fn().mockResolvedValue({ id: 'user-msg-id', contents: [{ id: 'content-001' }] }),
    generateId: jest.fn(() => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`),
    generateMessageId: jest.fn(() => 'm_01ARZ3NDEKTSV4RRFFQ69G5FAV'),
    getTokenCount: jest.fn(async () => 0),
    getTokenBreakdown: jest.fn(async () => ({ systemPrompt: 0, history: 0, tools: 0 })),
    getContextStats: jest.fn(async () => ({
      usedTokens: 0,
      effectiveContextWindow: 128000,
      messageCount: 0,
      breakdown: { systemPrompt: 0, history: 0, tools: 0 },
    })),
    shouldCompress: jest.fn().mockResolvedValue(false),
    compress: jest.fn().mockResolvedValue([]),
  };
}

/**
 * SessionContextService Mock 工厂（已废弃，保留兼容）
 */
export function createMockSessionContextService(options?: {
  contextWindow?: number;
  thinkingEffort?: string;
}) {
  const mockCtx = createMockSessionContext(options);
  return {
    buildContext: jest.fn().mockResolvedValue({
      context: mockCtx,
      toolContext: { sessionId: 'test-session-001' },
      effectiveContextWindow: options?.contextWindow || 8000,
      thinkingEffort: options?.thinkingEffort || 'medium',
    }),
  };
}

/**
 * 创建完整的 AgentEngine 依赖 Mock 集合
 */
export function createAllMocks(options?: {
  sessionData?: any;
  lockShouldFail?: boolean;
  llmChunks?: StreamChunk[];
  llmGenerator?: () => AsyncGenerator<StreamChunk>;
  toolCallsResponse?: any[];
  contextWindow?: number;
  thinkingEffort?: string;
}) {
  // publishStream 直发模式下测试断言的唯一事件源（引擎不再 yield，事件经 mock 捕获）
  const publishedEvents: SessionStreamEvent[] = [];
  const sessionContext = createMockSessionContext({
    contextWindow: options?.contextWindow,
    thinkingEffort: options?.thinkingEffort,
  });
  sessionContext.publishStream.mockImplementation(async (chunk: SessionStreamEvent) => {
    publishedEvents.push(chunk);
    // 默认对迭代暂停（kind=continue）应答"停止"，防止循环触顶后 ask 永久悬挂；
    // 专项用例（继续/abort）会整体覆盖 publishStream 实现，不受此默认影响
    if (chunk.type === 'ask_requested' && chunk.kind === 'continue') {
      setImmediate(() => {
        askWait.resolveAnswers('test-session-001', chunk.requestId, [
          { id: 'continue', selected: ['停止'] },
        ]);
      });
    }
  });

  // 统一 Ask：真实等待表 + 服务共享同一张表
  // （publishStream 经 mock 捕获，等待由测试侧 askWait.resolveAnswers 唤醒）
  const askWait = new InteractionWaitService();
  const askService = new AskService(askWait);

  return {
    sessionRepo: createMockSessionRepo(options?.sessionData),
    sessionLockService: createMockSessionLockService({
      shouldFail: options?.lockShouldFail
    }),
    llmService: createMockLLMService(
      options?.llmGenerator || (options?.llmChunks ? () => {
        const chunks = options.llmChunks!;
        return (async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        })();
      } : undefined)
    ),
    toolExecutor: createMockToolExecutor({
      toolCallsResponse: options?.toolCallsResponse,
    }),
    sessionContext,
    publishedEvents,
    streamManager: {
      publish: jest.fn(),
      stopStream: jest.fn(),
    },
    askWait,
    askService,
  };
}
