/// <reference types="jest" />

import { LLMResponseChunk } from '../../../src/modules/llm-core/types/llm.types';

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
 * 支持模拟锁状态,用于测试并发控制
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
  chunksOrGenerator?: LLMResponseChunk[] | (() => AsyncGenerator<LLMResponseChunk>)
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
 * ToolOrchestrator Mock 工厂
 */
export function createMockToolOrchestrator(options?: {
  toolCallsResponse?: any[];
}) {
  return {
    getAllTools: jest.fn().mockResolvedValue([]),
    getAllToolPrompts: jest.fn().mockResolvedValue(''),
    generateDisplayMessage: jest.fn((req: any, isStreaming: boolean) => ({
      action: isStreaming ? `正在调用 ${req.name}` : `已调用 ${req.name}`,
      toolName: req.name,
      toolType: 'generic',
      arguments: req.arguments || {},
    })),
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
 * SessionContextService Mock 工厂
 */
export function createMockSessionContextService(options?: {
  contextWindow?: number;
  thinkingEffort?: string;
}) {
  const mockContext = {
    generateId: jest.fn(() => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`),
    prepareAssistantResponse: jest.fn().mockResolvedValue('assistant-msg-id'),
    getMessages: jest.fn().mockResolvedValue([]),
    appendParts: jest.fn().mockResolvedValue(undefined),
    initialize: jest.fn().mockResolvedValue(undefined),
  };

  return {
    buildContext: jest.fn().mockResolvedValue({
      context: mockContext,
      toolContext: { sessionId: 'test-session-001', userId: 'test-user' },
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
  llmChunks?: LLMResponseChunk[];
  llmGenerator?: () => AsyncGenerator<LLMResponseChunk>;
  toolCallsResponse?: any[];
  contextWindow?: number;
  thinkingEffort?: string;
}) {
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
    toolOrchestrator: createMockToolOrchestrator({
      toolCallsResponse: options?.toolCallsResponse,
    }),
    sessionContextService: createMockSessionContextService({
      contextWindow: options?.contextWindow,
      thinkingEffort: options?.thinkingEffort,
    }),
  };
}
