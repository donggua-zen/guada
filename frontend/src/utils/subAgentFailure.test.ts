/**
 * 子代理失败原因解析测试
 *
 * 断言用的都是后端真实文案（executor 兜底包装 / 插件状态标签），
 * 改后端文案时这里应当先红——提示同步更新解析规则。
 */
import { describe, it, expect } from "vitest";
import { resolveSubAgentFailure } from "./subAgentFailure";
import type { ToolCallResponseEntry } from "@/types/message";

const res = (content: string): Partial<ToolCallResponseEntry> => ({
  name: "subagent_spawn",
  toolCallId: "tc1",
  content,
});

describe("resolveSubAgentFailure", () => {
  it("剥掉执行器兜底前缀：agentId 未启用", () => {
    expect(
      resolveSubAgentFailure(
        res(
          'Tool execution failed: Agent "reviewer" is not allowed. Please enable it in the agent settings and try again.',
        ),
      ),
    ).toBe(
      'Agent "reviewer" is not allowed. Please enable it in the agent settings and try again.',
    );
  });

  it("剥掉执行器兜底前缀：每会话子代理名额上限", () => {
    expect(
      resolveSubAgentFailure(
        res(
          "Tool execution failed: The maximum number of sub-agents (10) for this session has been reached. Please close some sub-agents before creating new ones.",
        ),
      ),
    ).toBe(
      "The maximum number of sub-agents (10) for this session has been reached. Please close some sub-agents before creating new ones.",
    );
  });

  it("插件状态标签：取 Reason 段并剥掉 one_shot 尾缀", () => {
    expect(
      resolveSubAgentFailure(
        res(
          "[Sub-agent ended with error. Reason: LLM API error (stream): 500. One-shot sub-agent auto-closed.]",
        ),
      ),
    ).toBe("LLM API error (stream): 500");
  });

  it("插件状态标签：persist 生命周期的 Session ID 尾缀同样剥掉", () => {
    expect(
      resolveSubAgentFailure(
        res("[Sub-agent ended with error. Reason: boom. Session ID: sub-9]"),
      ),
    ).toBe("boom");
  });

  it("任务正文与标签同行时取标签里的原因", () => {
    expect(
      resolveSubAgentFailure(
        res(
          "部分产出\n[Sub-agent ended with error. Reason: boom. One-shot sub-agent auto-closed.]",
        ),
      ),
    ).toBe("boom");
  });

  it("标签无 Reason：原样返回，不丢信息", () => {
    const raw = "[Sub-agent ended with error. Session ID: sub-9]";
    expect(resolveSubAgentFailure(res(raw))).toBe(raw);
  });

  it("无包装的纯文本原因原样返回", () => {
    expect(resolveSubAgentFailure(res("spawn 被中止"))).toBe("spawn 被中止");
  });

  it("结果缺失或为空 → undefined（调用方只渲染标题）", () => {
    expect(resolveSubAgentFailure(undefined)).toBeUndefined();
    expect(resolveSubAgentFailure(null)).toBeUndefined();
    expect(resolveSubAgentFailure(res(""))).toBeUndefined();
    expect(resolveSubAgentFailure(res("   \n "))).toBeUndefined();
    expect(
      resolveSubAgentFailure({ name: "subagent_spawn", toolCallId: "tc1" }),
    ).toBeUndefined();
  });
});
