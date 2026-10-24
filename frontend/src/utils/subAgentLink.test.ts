import { describe, it, expect, vi } from "vitest";
// subAgentLink → toolDisplay 的依赖链在 node 测试环境不可用，与 toolDisplay.test.ts 同样 mock
vi.mock("@/locales", () => ({ t: (k: string) => k }));
vi.mock("@/components/icons/Terminal.vue", () => ({ default: {} }));
import { resolveSubAgentLink, findToolResponse } from "./subAgentLink";
import type { ToolCall } from "./toolDisplay";

/**
 * 工具调用 → 子代理会话的关联解析测试
 *
 * 覆盖：
 * - resolveSubAgentLink：两段关联键（流事件 subAgentLink → 落库 meta.link）、
 *   非子代理工具/无目标返回 null、legacy tool_use 二跳
 * - findToolResponse：按 toolCallId 匹配（并行调用结果乱序）、id 缺失回退下标
 */
describe("resolveSubAgentLink", () => {
  it("流事件 subAgentLink 命中：工具结果未到达（前台 spawn 阻塞中）也能跳", () => {
    const tool: ToolCall = {
      id: "call_1",
      name: "subagent_spawn",
      subAgentLink: { subSessionId: "sub-live", name: "分析架构" },
    };
    expect(resolveSubAgentLink(tool)).toEqual({
      subSessionId: "sub-live",
      name: "分析架构",
    });
  });

  it("优先级：流事件 subAgentLink 先于 meta.link（正常两者同值）", () => {
    const tool: ToolCall = {
      id: "call_1",
      name: "subagent_spawn",
      subAgentLink: { subSessionId: "sub-live" },
    };
    const response = {
      meta: { link: { type: "sub_agent", subSessionId: "sub-meta", name: "n" } },
    };
    expect(resolveSubAgentLink(tool, response)?.subSessionId).toBe("sub-live");
  });

  it("流事件缺失时回落到 meta.link（回合结束、eventBuffer 已销毁）", () => {
    const tool: ToolCall = { id: "call_1", name: "subagent_spawn" };
    const response = { meta: { link: { type: "sub_agent", subSessionId: "sub-meta" } } };
    expect(resolveSubAgentLink(tool, response)?.subSessionId).toBe("sub-meta");
  });

  it("subAgentLink 里 subSessionId 为空时不算命中", () => {
    const tool: ToolCall = {
      id: "call_1",
      name: "subagent_spawn",
      subAgentLink: { subSessionId: "" },
    };
    expect(resolveSubAgentLink(tool)).toBeNull();
  });

  it("meta.link 命中：spawn 结果回传的跳转信息", () => {
    const tool: ToolCall = { id: "call_1", name: "subagent_spawn" };
    const response = {
      toolCallId: "call_1",
      meta: { link: { type: "sub_agent", subSessionId: "sub-abc", name: "分析架构" } },
    };
    expect(resolveSubAgentLink(tool, response)).toEqual({
      subSessionId: "sub-abc",
      name: "分析架构",
    });
  });

  it("meta.link 无 name 时也能跳（name 仅用于展示）", () => {
    const tool: ToolCall = { id: "call_1", name: "subagent_spawn" };
    const response = { meta: { link: { type: "sub_agent", subSessionId: "sub-1" } } };
    expect(resolveSubAgentLink(tool, response)).toEqual({ subSessionId: "sub-1" });
  });

  it("meta.link 的 type 不是 sub_agent 时忽略（不为别的跳转类型误开面板）", () => {
    const tool: ToolCall = { id: "call_1", name: "subagent_spawn" };
    const response = { meta: { link: { type: "workflow", subSessionId: "wf-1" } } };
    expect(resolveSubAgentLink(tool, response)).toBeNull();
  });

  it("spawn 参数里出现 sessionId 不当作目标（无 meta 时不猜）", () => {
    const tool: ToolCall = {
      id: "call_3",
      name: "subagent_spawn",
      arguments: { name: "x", task: "y", agentId: "generic", sessionId: "should-not-use" },
    };
    expect(resolveSubAgentLink(tool)).toBeNull();
  });

  it("manager 工具已删除：历史行不再产生专属跳转（走 meta.link 兜底）", () => {
    expect(
      resolveSubAgentLink({ name: "subagent_manager", arguments: { action: "list" } }),
    ).toBeNull();
    expect(
      resolveSubAgentLink({
        name: "subagent_manager",
        arguments: { action: "send_message", sessionId: "sub-9" },
      }),
    ).toBeNull();
  });

  it("非子代理工具不产生入口", () => {
    expect(resolveSubAgentLink({ name: "read", arguments: { file_path: "a.ts" } })).toBeNull();
    expect(resolveSubAgentLink({ name: "edit", arguments: {} })).toBeNull();
    expect(resolveSubAgentLink({})).toBeNull();
  });

  it("legacy tool_use 包装：二跳解析出真实工具名（非子代理工具 → null）", () => {
    const tool: ToolCall = {
      name: "tool_use",
      arguments: JSON.stringify({
        tool_name: "read",
        arguments: { file_path: "a.ts" },
      }),
    };
    expect(resolveSubAgentLink(tool)).toBeNull();
  });

  it("legacy tool_use + meta.link 同样命中（meta 优先于参数）", () => {
    const tool: ToolCall = {
      name: "tool_use",
      arguments: JSON.stringify({
        tool_name: "subagent_spawn",
        arguments: { name: "a", task: "b", agentId: "generic" },
      }),
    };
    const response = { meta: { link: { type: "sub_agent", subSessionId: "sub-m" } } };
    expect(resolveSubAgentLink(tool, response)).toEqual({ subSessionId: "sub-m" });
  });
});

describe("findToolResponse", () => {
  it("按 toolCallId 匹配，不依赖数组下标（并行调用结果乱序到达）", () => {
    const responses = [
      { toolCallId: "call_b", content: "B" },
      { toolCallId: "call_a", content: "A" },
    ];
    expect(findToolResponse({ id: "call_a" }, 0, responses)?.content).toBe("A");
    expect(findToolResponse({ id: "call_b" }, 1, responses)?.content).toBe("B");
  });

  it("toolCallId 未命中时回退下标（结果未到达/无 id 的旧数据）", () => {
    const responses = [{ toolCallId: "call_b", content: "B" }];
    expect(findToolResponse({ id: "call_a" }, 0, responses)?.content).toBe("B");
    expect(findToolResponse({}, 0, responses)?.content).toBe("B");
  });

  it("无结果或越界返回 undefined", () => {
    expect(findToolResponse({ id: "call_a" }, 0, undefined)).toBeUndefined();
    expect(findToolResponse({ id: "call_a" }, 0, [])).toBeUndefined();
    expect(findToolResponse({}, 5, [{ toolCallId: "call_b" }])).toBeUndefined();
  });
});
