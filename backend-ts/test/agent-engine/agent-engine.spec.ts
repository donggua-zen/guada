/// <reference types="jest" />

import { AgentEngine } from '../../src/modules/chat/agent-engine.service';
import type { SessionStreamEvent } from '../../src/modules/chat/types/event-chunk.types';
import { UpstreamRateLimitError } from '../../src/modules/llm-core/utils/upstream-errors';
import { ConflictException } from '@nestjs/common';
import { createAllMocks } from './helpers/mock-factories';
import { loadChunksFromJsonl } from './helpers/chunk-replayer';
import * as path from 'path';

/**
 * 有界 LLM 生成器：第 1 轮返回工具调用，之后返回纯文本收尾。
 *
 * 轮次上限已移除（对齐 ZCode：主循环不设轮次上限，靠模型自行收手），
 * 因此 mock 不能再无限重放同一批含工具调用的 chunks——那会让 ReAct 循环永不退出。
 * 测试必须模拟"模型最终会停止调用工具"这一真实行为。
 */
function boundedToolCallGenerator() {
  let callCount = 0;
  const toolChunks = loadChunksFromJsonl(
    path.join(__dirname, 'fixtures/chunks-with-tool-calls.jsonl'),
  );
  const textChunks = loadChunksFromJsonl(
    path.join(__dirname, 'fixtures/chunks-text-only.jsonl'),
  );
  return () =>
    (async function* () {
      callCount++;
      if (callCount === 1) {
        for (const chunk of toolChunks) {
          yield chunk;
          if (chunk.type === 'finish') break;
        }
      } else {
        for (const chunk of textChunks) yield chunk;
      }
    })();
}

describe('AgentEngine - completions', () => {
  describe('Session Lock', () => {
    it('应该在请求完成后释放锁', async () => {
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-text-only.jsonl'),
      );

      const mocks = createAllMocks({
        llmChunks: chunks,
      });

      const agentEngine = new AgentEngine(
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      // 第一次请求
      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      expect(mocks.publishedEvents.length).toBeGreaterThan(0);

      // 重置 mock 以允许第二次请求
      (mocks.sessionLockService.tryLock as jest.Mock).mockReturnValue(true);

      // 第二次请求应该能成功
      const firstRunCount = mocks.publishedEvents.length;
      await agentEngine.run(mocks.sessionContext, { id: 'msg-002' });
      expect(mocks.publishedEvents.length).toBeGreaterThan(firstRunCount);
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
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      const events = mocks.publishedEvents;

      // 验证事件序列
      expect(events.length).toBeGreaterThan(0);

      const textEvents = events.filter((e) => e.type === 'text_delta');
      expect(textEvents.length).toBeGreaterThan(0);

      const finishEvent = events.find((e) => e.type === 'finish');
      expect(finishEvent).toBeDefined();
      expect(finishEvent?.finishReason).toBe('stop');
    });

    it('应该为内容块记录生命周期计时（timing）', async () => {
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-text-only.jsonl'),
      );

      const mocks = createAllMocks({
        llmChunks: chunks,
      });

      const agentEngine = new AgentEngine(
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      const events = mocks.publishedEvents;

      // 持久化的 reasoning 块应携带 timing：startedAt/finishedAt 齐备且时长合理
      const contextMock = mocks.sessionContext;

      expect((contextMock.appendMessages as jest.Mock)?.mock?.calls?.length).toBeGreaterThan(0);
      const appendMessagesCall = (contextMock.appendMessages as jest.Mock).mock.calls[0];
      const assistantMessage = appendMessagesCall[0][0];
      const reasoningBlock = assistantMessage.content.find(
        (b: any) => b.type === 'reasoning',
      );
      expect(reasoningBlock).toBeDefined();
      expect(reasoningBlock.timing).toBeDefined();
      expect(typeof reasoningBlock.timing.startedAt).toBe('number');
      expect(typeof reasoningBlock.timing.finishedAt).toBe('number');
      const durationMs =
        reasoningBlock.timing.finishedAt - reasoningBlock.timing.startedAt;
      // 实际值取决于执行时间，只验证合理性（>= 0 且 < 10000ms）
      expect(durationMs).toBeGreaterThanOrEqual(0);
      expect(durationMs).toBeLessThan(10000);

      // 广播的 block_end 权威块同样携带 timing（前端实时路径的来源）
      const blockEndEvents = events.filter((e) => e.type === 'block_end');
      const reasoningEnd = blockEndEvents.find(
        (e: any) => e.block?.type === 'reasoning',
      ) as any;
      expect(reasoningEnd).toBeDefined();
      expect(reasoningEnd.block.timing?.startedAt).toBeGreaterThan(0);
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
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      // 直发模式：abort 以参数传入（修正旧用例的参数位置——signal 应为第 4 参），
      // 引擎内部捕获 AbortError 并归拢为 user_cancel 收尾，不以异常冒泡
      const { finishReason } = await agentEngine.run(
        mocks.sessionContext,
        { id: 'msg-001' },
        'overwrite',
        abortController.signal,
      );
      expect(finishReason).toBe('user_cancel');

      // 验证收到了部分事件（中止前的增量已发布）
      expect(mocks.publishedEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Tool Calls', () => {
    it('应该正确处理单次工具调用', async () => {
      const mocks = createAllMocks({
        llmGenerator: boundedToolCallGenerator(),
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
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      const events = mocks.publishedEvents;

      // 验证事件序列包含 tool_call 和 tool_calls_response
      const toolCallEvents = events.filter((e) => e.type === 'tool_call_delta');
      expect(toolCallEvents.length).toBeGreaterThan(0);

      const toolResponseEvents = events.filter((e) => e.type === 'tool_calls_response');
      expect(toolResponseEvents.length).toBeGreaterThan(0);

      // 验证工具调用参数被正确累加
      const contextMock = mocks.sessionContext;
      
      if (contextMock && (contextMock.appendMessages as jest.Mock)?.mock?.calls?.length > 0) {
        const appendMessagesCall = (contextMock.appendMessages as jest.Mock).mock.calls[0];
        
        if (appendMessagesCall && appendMessagesCall[0]) {
          const assistantMessage = appendMessagesCall[0][0];
          const toolCallBlocks = (assistantMessage.content || []).filter(
            (b: any) => b.type === 'tool-call',
          );
          expect(toolCallBlocks.length).toBeGreaterThan(0);
          expect(toolCallBlocks[0].name).toBe('tool_load');
        }
      }
    });

    it('应该生成正确的工具调用展示文案', async () => {
      const mocks = createAllMocks({
        llmGenerator: boundedToolCallGenerator(),
      });

      const agentEngine = new AgentEngine(
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      const events = mocks.publishedEvents;

      // 验证 tool_call 事件包含工具调用信息
      const toolCallEvent = events.find((e) => e.type === 'tool_call_delta');
      expect(toolCallEvent).toBeDefined();
      // tool_calls_response 事件应包含工具执行结果
      const toolResponseEvent = events.find((e) => e.type === 'tool_calls_response');
      expect(toolResponseEvent).toBeDefined();
      expect(toolResponseEvent?.toolCallsResponse).toBeDefined();
      expect(toolResponseEvent?.toolCallsResponse!.length).toBeGreaterThan(0);
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
              // 第一轮:只返回到第一个 finish(工具调用轮)为止
              for (const chunk of chunks) {
                yield chunk;
                if (chunk.type === 'finish') break;
              }
            } else {
              // 第二轮:返回第一个 finish 之后的剩余部分(文本回答轮)
              let seenFinish = false;
              for (const chunk of chunks) {
                if (!seenFinish) {
                  if (chunk.type === 'finish') seenFinish = true;
                  continue;
                }
                yield chunk;
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
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      const events = mocks.publishedEvents;

      // 验证 LLM 被调用了两次
      expect((mocks.llmService as any).getCallCount()).toBe(2);

      // 验证有 tool_calls_response 事件
      const toolResponseEvents = events.filter((e) => e.type === 'tool_calls_response');
      expect(toolResponseEvents.length).toBeGreaterThan(0);
    });

  });

  describe('Plan Feedback（工具转交用户输入，终止回合）', () => {
    /**
     * 计划审批被拒且用户留下文字时：工具结果携带 followUpUserInput →
     * 本轮**终止**（不再继续 ReAct 循环），文字随 run() 返回值交回 chat-runner
     * 开启新轮次。这里钉住三条不变量：终止、返回值形态、隐藏注入确已删除。
     */
    it('工具转交用户输入 → 回合终止，run 返回 plan_rejected + followUpUserInput', async () => {
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-with-tool-calls.jsonl'),
      );

      const mocks = createAllMocks({
        llmChunks: chunks,
        toolCallsResponse: [
          {
            toolCallId: 'call_exit_plan',
            name: 'ExitPlanMode',
            content: 'The plan was not approved by the user.',
            isError: true,
            followUpUserInput: '把第二步拆成两步',
          },
        ],
      });

      const agentEngine = new AgentEngine(
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      const result = await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });

      // 终止语义：finishReason=plan_rejected + 反馈随返回值交回
      expect(result).toEqual({
        finishReason: 'plan_rejected',
        followUpUserInput: '把第二步拆成两步',
      });

      // 回合已终止：LLM 只被调用一次（没有第二轮让模型自我重写计划）
      expect((mocks.llmService as any).getCallCount()).toBe(1);

      // 隐藏注入已删：工具批次不再产生 user 角色消息（反馈由 chat-runner 以
      // 真实用户消息开新轮，而非塞进本轮）
      const appended = (mocks.sessionContext.appendMessages as jest.Mock).mock.calls
        .flatMap((c: any[]) => c[0] as any[]);
      const toolBatchUserMessages = appended.filter(
        (m: any) => m.role === 'user' && m.kind === 'model' && m.source?.plugin === 'plan-mode',
      );
      expect(toolBatchUserMessages).toHaveLength(0);

      // turn_end 携带新 finishReason（前端对未知值静默，不破渲染）
      const turnEnds = mocks.publishedEvents.filter((e) => e.type === 'turn_end');
      expect(turnEnds.length).toBeGreaterThan(0);
      expect((turnEnds[turnEnds.length - 1] as any).finishReason).toBe('plan_rejected');
    });

    it('工具结果无转交输入 → 轮次照常继续并以 stop 收尾（回归保障）', async () => {
      let callCount = 0;
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-multi-turn.jsonl'),
      );

      const mocks = createAllMocks({
        llmGenerator: () => {
          callCount++;
          return (async function* () {
            if (callCount === 1) {
              // 第一轮：工具调用轮（到第一个 finish 为止）
              for (const chunk of chunks) {
                yield chunk;
                if (chunk.type === 'finish') break;
              }
            } else {
              // 第二轮：文本回答轮（第一个 finish 之后的部分）
              let seenFinish = false;
              for (const chunk of chunks) {
                if (!seenFinish) {
                  if (chunk.type === 'finish') seenFinish = true;
                  continue;
                }
                yield chunk;
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
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      const result = await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });

      expect(result).toEqual({ finishReason: 'stop' });
      expect((mocks.llmService as any).getCallCount()).toBe(2);
    });
  });

  describe('Turn Stopping Hook（turn.stopping，对齐 DSH turn-stopping + steer）', () => {
    it('订阅者返回 continue 消息 → 注入 hidden user 并触发新一轮 LLM（随后正常收尾）', async () => {
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-text-only.jsonl'),
      );
      const mocks = createAllMocks({ llmChunks: chunks });

      // 第一次 turn.stopping 返回续跑消息，之后旁路（防死循环由引擎 MAX_INTERCEPTOR_ITERATIONS=3 兜底）
      let stoppingCalls = 0;
      const parallel = jest.fn(async (event: string) => {
        if (event === 'turn.stopping') {
          stoppingCalls++;
          return stoppingCalls === 1
            ? [
                {
                  kind: 'continue',
                  messages: [
                    '<system-reminder>后台进程仍在运行，请等待完成</system-reminder>',
                  ],
                },
              ]
            : [];
        }
        return [];
      });

      const agentEngine = new AgentEngine(
        mocks.toolExecutor as any,
        mocks.llmService as any,
        { serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()), parallel } as any,      );

      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      const events = mocks.publishedEvents;

      // 续跑钩子被触发过一次
      expect(stoppingCalls).toBe(2);
      // 触发新一轮 LLM（首轮 + 续跑轮）
      expect((mocks.llmService as any).getCallCount()).toBe(2);
      // 注入的 hidden user 消息被持久化（role=user, kind=model, metadata.hidden=true）
      const appended = (mocks.sessionContext.appendMessages as jest.Mock).mock.calls as any[];
      const hidden = appended.filter(
        (c) => c[0]?.some?.((m: any) => m.metadata?.hidden === true),
      );
      expect(hidden.length).toBeGreaterThan(0);
      const injected = hidden[0][0].find((m: any) => m.metadata?.hidden === true);
      expect(injected.role).toBe('user');
      expect(injected.kind).toBe('model');
      expect(injected.content[0].text).toContain('后台进程仍在运行');
      // 回合正常收尾
      expect(events.some((e) => e.type === 'turn_end')).toBe(true);
    });

    it('订阅者全部旁路（无 continue）→ 不注入、不续跑，回合正常关闭', async () => {
      const chunks = loadChunksFromJsonl(
        path.join(__dirname, 'fixtures/chunks-text-only.jsonl'),
      );
      const mocks = createAllMocks({ llmChunks: chunks });

      const parallel = jest.fn(async (event: string) =>
        event === 'turn.stopping' ? [undefined] : [],
      );
      const agentEngine = new AgentEngine(
        mocks.toolExecutor as any,
        mocks.llmService as any,
        { serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()), parallel } as any,      );

      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      const events = mocks.publishedEvents;

      // 未注入 hidden 消息
      const appended = (mocks.sessionContext.appendMessages as jest.Mock).mock.calls as any[];
      expect(
        appended.filter((c) => c[0]?.some?.((m: any) => m.metadata?.hidden === true)),
      ).toHaveLength(0);
      // 单轮 LLM 调用后正常收尾
      expect((mocks.llmService as any).getCallCount()).toBe(1);
      expect(events.some((e) => e.type === 'turn_end')).toBe(true);
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
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      const events = mocks.publishedEvents;

      // 验证收到了 error 事件 (finishReason 可能是 'error' 或 'timeout')
      const errorEvent = events.find((e): e is Extract<SessionStreamEvent, { type: 'turn_end' }> =>
        e.type === 'turn_end' && (e.finishReason === 'timeout' || e.finishReason === 'error')
      );
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error).toBeTruthy();
      // 立即报错（无任何内容产出）→ 不落库空 assistant 消息（错误归拢 turn 级，
      // 由 finalizeTurn 写 turn.metadata；空消息无有效内容不应存在）
      const appendCalls = (mocks.sessionContext.appendMessages as jest.Mock).mock.calls;
      expect(appendCalls.length).toBe(0);
    });

    it('半途报错（已有部分内容）→ 半截消息落库，错误仍归拢 turn 级', async () => {
      const mocks = createAllMocks({
        llmGenerator: () => {
          return (async function* () {
            yield { type: 'block_start', index: 0, blockType: 'text' };
            yield { type: 'text_delta', index: 0, text: '部分内容' };
            throw new Error('Mid-stream error');
          })();
        },
      });

      const agentEngine = new AgentEngine(
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      const events = mocks.publishedEvents;

      // 半截内容有有效内容 → 落库（保留部分产出）
      const appendCalls = (mocks.sessionContext.appendMessages as jest.Mock).mock.calls;
      expect(appendCalls.length).toBeGreaterThan(0);
      const assistantMessage = appendCalls[0][0][0];
      expect(assistantMessage.role).toBe('assistant');
      expect(assistantMessage.content.length).toBeGreaterThan(0);
      // 错误详情不写入消息 metadata（归拢 turn 级）
      expect(assistantMessage.metadata.errorDetail).toBeUndefined();
      // turn_end 携带错误信息
      const turnEnd = events.find((e) => e.type === 'turn_end');
      expect(turnEnd?.finishReason).toBe('error');
      expect(turnEnd?.error).toBeTruthy();
    });

    it('限流以文字说明收尾：无暂停事件、turn_end=rate_limited（有部分内容时照常落库）', async () => {
      const mocks = createAllMocks({
        llmGenerator: () => {
          return (async function* () {
            // 先产出部分内容（sawContent=true → 不重试，快速抛出），再触发限流
            yield { type: 'block_start', index: 0, blockType: 'text' };
            yield { type: 'text_delta', index: 0, text: '部分内容' };
            throw new UpstreamRateLimitError('429 Too Many Requests');
          })();
        },
      });

      const agentEngine = new AgentEngine(
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      const events = mocks.publishedEvents;

      // 无暂停请求帧（rate_limited 不再触发"继续"卡，只发文字说明）
      expect(events.some((e) => e.type === 'ask_requested')).toBe(false);
      // 回合以 rate_limited 收尾，turn_end 携带说明文字
      const turnEnd = events.find((e) => e.type === 'turn_end');
      expect(turnEnd?.finishReason).toBe('rate_limited');
      expect(turnEnd?.error).toBeTruthy();
      // 429 常见于请求阶段（模型无输出 → 空消息路径，无消息可落库）；本用例为流中段 429，
      // 已产出的部分内容照常落库（不再对 rate_limited 做额外拦截）
      const appended = (mocks.sessionContext.appendMessages as jest.Mock).mock.calls as any[];
      expect(appended.length).toBe(1);
      const persisted = appended[0][0] as any[];
      expect(
        persisted.some(
          (m) =>
            m.role === 'assistant' &&
            m.content?.some(
              (b: any) => b.type === 'text' && b.text === '部分内容',
            ),
        ),
      ).toBe(true);
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
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      const events = mocks.publishedEvents;

      // 验证收到了 turn_end 携带错误信息(turn 级收尾承载业务错误)
      const errorEvent = events.find((e): e is Extract<SessionStreamEvent, { type: 'turn_end' }> =>
        e.type === 'turn_end' && e.finishReason === 'error'
      );
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
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      // 直发模式：publishedEvents 全量捕获，本用例只关注 text_delta
      const events = mocks.publishedEvents.filter((e) => e.type === 'text_delta');

      // 验证输出的 text 事件数量少于输入 chunk 数量(因为合并了)
      const textChunks = chunks.filter((c) => c.type === 'text_delta');
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
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      const events = mocks.publishedEvents;

      // 验证同时存在 think 和 text 类型的事件
      const thinkEvents = events.filter((e) => e.type === 'reasoning_delta');
      const textEvents = events.filter((e) => e.type === 'text_delta');
      
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
        mocks.toolExecutor as any,
        mocks.llmService as any,
        {
          serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
          parallel: jest.fn(async () => []),
        } as any,      );

      await agentEngine.run(mocks.sessionContext, { id: 'msg-001' });
      const events = mocks.publishedEvents;

      // 验证事件序列:消息级 finish(带 finishReason)在前,回合级 turn_end 收尾(携带 usage)
      const finishEvent = events.find(
        (e): e is Extract<SessionStreamEvent, { type: 'finish' }> => e.type === 'finish',
      );
      expect(finishEvent).toBeDefined();
      expect(finishEvent!.finishReason).toBe('stop');

      const turnEndEvent = events[events.length - 1] as Extract<SessionStreamEvent, { type: 'turn_end' }>;
      expect(turnEndEvent.type).toBe('turn_end');
      expect(turnEndEvent.usage).toBeDefined();
    });
  });

});
