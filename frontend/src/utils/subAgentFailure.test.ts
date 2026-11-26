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

  // ── 成功文案绝不能被当成失败原因（本次 bug 的回归锚）──
  // 后台派发成功的结果正文与失败标签同样以方括号呈现；一旦裁决口径把正常
  // 结束原因误判成失败，「解析不出就原样返回」会把这段 ACK 用红块摊进对话流。

  it("后台派发成功的 ACK 文本不当作失败原因", () => {
    expect(
      resolveSubAgentFailure(
        res(
          "[Sub-agent running. Job ID: job-51c533f0-ca8a-4cc6-a74e-376327c0129c. Use job_read job-51c533f0-ca8a-4cc6-a74e-376327c0129c to read the result, job_send to continue its conversation, or job_stop to cancel.]",
        ),
      ),
    ).toBeUndefined();
  });

  it("正常完成标签不当作失败原因", () => {
    expect(resolveSubAgentFailure(res("[Sub-agent completed.]"))).toBeUndefined();
    expect(
      resolveSubAgentFailure(res("结论正文\n[Sub-agent completed.]")),
    ).toBeUndefined();
  });

  it("执行器包装但正文是成功 ACK：仍不返回（原因不该是「它成功了」）", () => {
    expect(
      resolveSubAgentFailure(
        res("Tool execution failed: [Sub-agent completed.]"),
      ),
    ).toBeUndefined();
  });

  it("认不出的自由文本返回 undefined（白名单制，不再原样透出）", () => {
    // 无包装的裸文本可能是工具正常输出，无法与失败区分 → 交给结构化字段承载
    expect(resolveSubAgentFailure(res("spawn 被中止"))).toBeUndefined();
    expect(resolveSubAgentFailure(res("some normal tool output"))).toBeUndefined();
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
