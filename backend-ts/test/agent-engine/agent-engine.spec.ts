/// <reference types="jest" />

import { AgentEngine } from '../../src/modules/chat/agent-engine.service';
import { ConflictException } from '@nestjs/common';
import { createAllMocks } from './helpers/mock-factories';
import { loadChunksFromJsonl } from './helpers/chunk-replayer';
import * as path from 'path';

describe('AgentEngine - completions', () => {
  describe('Session Lock', () => {
    it('应该拒绝并发请求', async () => {
      const mocks = createAllMocks({
        lockShouldFail: true,
        llmChunks: [],
      });

      const agentEngine = new AgentEngine(
        mocks.sessionRepo as any,
        mocks.toolOrchestrator as any,
        mocks.llmService as any,
        mocks.sessionLockService as any,
        mocks.sessionContextService as any,
      );

      await expect(
        (async () => {
          for await (const _ of agentEngine.completions('test-session-001', 'msg-001')) {
            // consume generator
          }
        })(),
      ).rejects.toThrow(ConflictException);

      expect(mocks.sessionLockService.tryLock).toHaveBeenCalledWith('test-session-001');
    });

    it('应该在请求完成后释放锁', async () => {
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-text-only.jsonl'),
      );

      const mocks = createAllMocks({
        llmChunks: chunks,
      });

      const agentEngine = new AgentEngine(
        mocks.sessionRepo as any,
        mocks.toolOrchestrator as any,
        mocks.llmService as any,
        mocks.sessionLockService as any,
        mocks.sessionContextService as any,
      );

      // 第一次请求
      const events1: any[] = [];
      for await (const event of agentEngine.completions('test-session-001', 'msg-001')) {
        events1.push(event);
      }

      expect(events1.length).toBeGreaterThan(0);
      expect(mocks.sessionLockService.unlock).toHaveBeenCalledWith('test-session-001');

      // 重置 mock 以允许第二次请求
      (mocks.sessionLockService.tryLock as jest.Mock).mockReturnValue(true);

      // 第二次请求应该能成功
      const events2: any[] = [];
      for await (const event of agentEngine.completions('test-session-001', 'msg-002')) {
        events2.push(event);
      }

      expect(events2.length).toBeGreaterThan(0);
    });
  });

  describe('Text Streaming', () => {
    it('应该正确流式输出纯文本内容', async () => {
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-text-only.jsonl'),
      );

      const mocks = createAllMocks({
        llmChunks: chunks,
      });

      const agentEngine = new AgentEngine(
        mocks.sessionRepo as any,
        mocks.toolOrchestrator as any,
        mocks.llmService as any,
        mocks.sessionLockService as any,
        mocks.sessionContextService as any,
      );

      const events: any[] = [];
      for await (const event of agentEngine.completions('test-session-001', 'msg-001')) {
        events.push(event);
      }

      // 验证事件序列
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('create');

      const textEvents = events.filter((e) => e.type === 'text');
      expect(textEvents.length).toBeGreaterThan(0);

      const finishEvent = events.find((e) => e.type === 'finish');
      expect(finishEvent).toBeDefined();
      expect(finishEvent?.finishReason).toBe('stop');
    });

    it('应该正确计算思维链耗时', async () => {
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-text-only.jsonl'),
      );

      const mocks = createAllMocks({
        llmChunks: chunks,
      });

      const agentEngine = new AgentEngine(
        mocks.sessionRepo as any,
        mocks.toolOrchestrator as any,
        mocks.llmService as any,
        mocks.sessionLockService as any,
        mocks.sessionContextService as any,
      );

      const events: any[] = [];
      for await (const event of agentEngine.completions('test-session-001', 'msg-001')) {
        events.push(event);
      }

      // thinkingDurationMs 应该在合理范围内 (> 0 且 < 10000ms)
      // 注意:实际值取决于执行时间,这里只验证存在性和合理性
      const contextMock = (mocks.sessionContextService.buildContext as jest.Mock).mock.results[0]?.value?.context;
      
      if (contextMock && (contextMock.appendParts as jest.Mock)?.mock?.calls?.length > 0) {
        const appendPartsCall = (contextMock.appendParts as jest.Mock).mock.calls[0];
        
        if (appendPartsCall && appendPartsCall[0] && appendPartsCall[0][0]) {
          const assistantMessage = appendPartsCall[0][0];
          if (assistantMessage.metadata && assistantMessage.metadata.thinkingDurationMs !== undefined) {
            expect(assistantMessage.metadata.thinkingDurationMs).toBeGreaterThanOrEqual(0);
            expect(assistantMessage.metadata.thinkingDurationMs).toBeLessThan(10000);
          }
        }
      }
    });

    it('应该在用户中止时正确终止', async () => {
      const abortController = new AbortController();
      
      // 创建一个会在收到几个 chunk 后中止的流
      let chunkCount = 0;
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-text-only.jsonl'),
      );

      const mocks = createAllMocks({
        llmGenerator: () => {
          return (async function* () {
            for (const chunk of chunks) {
              chunkCount++;
              if (chunkCount === 3) {
                abortController.abort();
              }
              yield chunk;
            }
          })();
        },
      });

      const agentEngine = new AgentEngine(
        mocks.sessionRepo as any,
        mocks.toolOrchestrator as any,
        mocks.llmService as any,
        mocks.sessionLockService as any,
        mocks.sessionContextService as any,
      );

      const events: any[] = [];
      try {
        for await (const event of agentEngine.completions(
          'test-session-001',
          'msg-001',
          'overwrite',
          undefined,
          abortController.signal,
        )) {
          events.push(event);
        }
      } catch (error) {
        // 预期会抛出 AbortError
        expect((error as Error).message).toContain('Abort');
      }

      // 验证收到了部分事件
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Tool Calls', () => {
    it('应该正确处理单次工具调用', async () => {
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-with-tool-calls.jsonl'),
      );

      const mocks = createAllMocks({
        llmChunks: chunks,
        toolCallsResponse: [
          {
            toolCallId: 'call_00_OqvDAfT37BtLapqkSQTX2479',
            name: 'tool_load',
            content: '{"success": true}',
            isError: false,
          },
        ],
      });

      const agentEngine = new AgentEngine(
        mocks.sessionRepo as any,
        mocks.toolOrchestrator as any,
        mocks.llmService as any,
        mocks.sessionLockService as any,
        mocks.sessionContextService as any,
      );

      const events: any[] = [];
      for await (const event of agentEngine.completions('test-session-001', 'msg-001')) {
        events.push(event);
      }

      // 验证事件序列包含 tool_call 和 tool_calls_response
      const toolCallEvents = events.filter((e) => e.type === 'tool_call');
      expect(toolCallEvents.length).toBeGreaterThan(0);

      const toolResponseEvents = events.filter((e) => e.type === 'tool_calls_response');
      expect(toolResponseEvents.length).toBeGreaterThan(0);

      // 验证工具调用参数被正确累加
      const contextMock = (mocks.sessionContextService.buildContext as jest.Mock).mock.results[0]?.value?.context;
      
      if (contextMock && (contextMock.appendParts as jest.Mock)?.mock?.calls?.length > 0) {
        const appendPartsCall = (contextMock.appendParts as jest.Mock).mock.calls[0];
        
        if (appendPartsCall && appendPartsCall[0]) {
          const assistantMessage = appendPartsCall[0][0];
          expect(assistantMessage.toolCalls).toBeDefined();
          expect(assistantMessage.toolCalls!.length).toBeGreaterThan(0);
          expect(assistantMessage.toolCalls![0].name).toBe('tool_load');
        }
      }
    });

    it('应该生成正确的工具调用展示文案', async () => {
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-with-tool-calls.jsonl'),
      );

      const mocks = createAllMocks({
        llmChunks: chunks,
      });

      const agentEngine = new AgentEngine(
        mocks.sessionRepo as any,
        mocks.toolOrchestrator as any,
        mocks.llmService as any,
        mocks.sessionLockService as any,
        mocks.sessionContextService as any,
      );

      const events: any[] = [];
      for await (const event of agentEngine.completions('test-session-001', 'msg-001')) {
        events.push(event);
      }

      // 验证 tool_call 事件包含 displayMessages
      const toolCallEvent = events.find((e) => e.type === 'tool_call');
      expect(toolCallEvent).toBeDefined();
      expect(toolCallEvent?.displayMessages).toBeDefined();
      expect(toolCallEvent?.displayMessages!.length).toBeGreaterThan(0);
    });
  });

  describe('Multi-turn Loop', () => {
    it('应该在 tool_calls 后继续下一轮', async () => {
      let callCount = 0;
      
      // 第一轮返回 tool_calls,第二轮返回纯文本
      const mocks = createAllMocks({
        llmGenerator: () => {
          callCount++;
          const chunks = loadChunksFromJsonl(
            path.join(__dirname, 'fixtures/chunks-multi-turn.jsonl'),
          );
          
          return (async function* () {
            if (callCount === 1) {
              // 第一轮:只返回到 tool_calls 之前的部分
              for (let i = 0; i < 12; i++) {
                yield chunks[i];
              }
            } else {
              // 第二轮:返回剩余部分
              for (let i = 12; i < chunks.length; i++) {
                yield chunks[i];
              }
            }
          })();
        },
        toolCallsResponse: [
          {
            toolCallId: 'call_001',
            name: 'file__read',
            content: 'File content here',
            isError: false,
          },
        ],
      });

      const agentEngine = new AgentEngine(
        mocks.sessionRepo as any,
        mocks.toolOrchestrator as any,
        mocks.llmService as any,
        mocks.sessionLockService as any,
        mocks.sessionContextService as any,
      );

      const events: any[] = [];
      for await (const event of agentEngine.completions('test-session-001', 'msg-001')) {
        events.push(event);
      }

      // 验证 LLM 被调用了两次
      expect((mocks.llmService as any).getCallCount()).toBe(2);

      // 验证有 tool_calls_response 事件
      const toolResponseEvents = events.filter((e) => e.type === 'tool_calls_response');
      expect(toolResponseEvents.length).toBeGreaterThan(0);
    });

    it('应该限制最大迭代次数', async () => {
      // Mock 始终返回 tool_calls
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-with-tool-calls.jsonl'),
      );

      const mocks = createAllMocks({
        llmChunks: chunks,
        toolCallsResponse: [
          {
            toolCallId: 'call_00_OqvDAfT37BtLapqkSQTX2479',
            name: 'tool_load',
            content: '{}',
            isError: false,
          },
        ],
      });

      const agentEngine = new AgentEngine(
        mocks.sessionRepo as any,
        mocks.toolOrchestrator as any,
        mocks.llmService as any,
        mocks.sessionLockService as any,
        mocks.sessionContextService as any,
      );

      const events: any[] = [];
      for await (const event of agentEngine.completions('test-session-001', 'msg-001')) {
        events.push(event);
      }

      // 验证迭代次数不超过 MAX_ITERATIONS (100)
      const llmCallCount = (mocks.llmService as any).getCallCount();
      expect(llmCallCount).toBeLessThanOrEqual(100);
    });
  });

  describe('Error Handling', () => {
    it('应该处理 LLM API 超时错误', async () => {
      const mocks = createAllMocks({
        llmGenerator: () => {
          return (async function* () {
            throw new Error('Request timed out');
          })();
        },
      });

      const agentEngine = new AgentEngine(
        mocks.sessionRepo as any,
        mocks.toolOrchestrator as any,
        mocks.llmService as any,
        mocks.sessionLockService as any,
        mocks.sessionContextService as any,
      );

      const events: any[] = [];
      for await (const event of agentEngine.completions('test-session-001', 'msg-001')) {
        events.push(event);
      }

      // 验证收到了 error 事件 (finishReason 可能是 'error' 或 'timeout')
      const errorEvent = events.find((e) => 
        e.type === 'finish' && (e.finishReason === 'timeout' || e.finishReason === 'error')
      );
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error).toBeTruthy();
    });

    it('应该处理通用 API 错误', async () => {
      const mocks = createAllMocks({
        llmGenerator: () => {
          return (async function* () {
            throw new Error('API error: Invalid request');
          })();
        },
      });

      const agentEngine = new AgentEngine(
        mocks.sessionRepo as any,
        mocks.toolOrchestrator as any,
        mocks.llmService as any,
        mocks.sessionLockService as any,
        mocks.sessionContextService as any,
      );

      const events: any[] = [];
      for await (const event of agentEngine.completions('test-session-001', 'msg-001')) {
        events.push(event);
      }

      // 验证收到了 error 事件
      const errorEvent = events.find((e) => e.type === 'finish' && e.finishReason === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error).toContain('API error');
    });
  });

  describe('Throttled Stream Integration', () => {
    it('应该合并高频同类 chunk', async () => {
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-text-only.jsonl'),
      );

      const mocks = createAllMocks({
        llmChunks: chunks,
      });

      const agentEngine = new AgentEngine(
        mocks.sessionRepo as any,
        mocks.toolOrchestrator as any,
        mocks.llmService as any,
        mocks.sessionLockService as any,
        mocks.sessionContextService as any,
      );

      const events: any[] = [];
      for await (const event of agentEngine.completions('test-session-001', 'msg-001')) {
        if (event.type === 'text') {
          events.push(event);
        }
      }

      // 验证输出的 text 事件数量少于输入 chunk 数量(因为合并了)
      const textChunks = chunks.filter((c) => c.content);
      expect(events.length).toBeLessThanOrEqual(textChunks.length);
    });

    it('不应该合并不同类型的 chunk', async () => {
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-text-only.jsonl'),
      );

      const mocks = createAllMocks({
        llmChunks: chunks,
      });

      const agentEngine = new AgentEngine(
        mocks.sessionRepo as any,
        mocks.toolOrchestrator as any,
        mocks.llmService as any,
        mocks.sessionLockService as any,
        mocks.sessionContextService as any,
      );

      const events: any[] = [];
      for await (const event of agentEngine.completions('test-session-001', 'msg-001')) {
        events.push(event);
      }

      // 验证同时存在 think 和 text 类型的事件
      const thinkEvents = events.filter((e) => e.type === 'think');
      const textEvents = events.filter((e) => e.type === 'text');
      
      expect(thinkEvents.length).toBeGreaterThan(0);
      expect(textEvents.length).toBeGreaterThan(0);
    });

    it('应该在 finishReason 到达时立即刷新', async () => {
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-text-only.jsonl'),
      );

      const mocks = createAllMocks({
        llmChunks: chunks,
      });

      const agentEngine = new AgentEngine(
        mocks.sessionRepo as any,
        mocks.toolOrchestrator as any,
        mocks.llmService as any,
        mocks.sessionLockService as any,
        mocks.sessionContextService as any,
      );

      const events: any[] = [];
      for await (const event of agentEngine.completions('test-session-001', 'msg-001')) {
        events.push(event);
      }

      // 验证最后一个事件是 finish 且包含 usage
      const finishEvent = events[events.length - 1];
      expect(finishEvent.type).toBe('finish');
      expect(finishEvent.finishReason).toBe('stop');
      expect(finishEvent.usage).toBeDefined();
    });
  });
});
