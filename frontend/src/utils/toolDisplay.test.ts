import { describe, it, expect, beforeEach, vi } from "vitest";
// toolDisplay 依赖链中的 locales / 图标组件在 node 测试环境不可用，mock 掉
vi.mock("@/locales", () => ({ t: (k: string) => k }));
vi.mock("@/components/icons/Terminal.vue", () => ({ default: {} }));
import {
  setPluginToolDisplays,
  getToolRenderer,
  getRendererArgs,
  type ToolCall,
} from "./toolDisplay";

/**
 * 工具定制渲染器配置测试
 *
 * 覆盖：
 * - getToolRenderer：内置映射兜底（edit/write/run_command + legacy remote_*）、
 *   后端声明优先、非法声明回退、未知工具返回 null
 * - getRendererArgs：语义字段提取、tool_use 懒加载二跳、流式 partial-json、
 *   无有效字段返回 null
 */
describe("getToolRenderer", () => {
  beforeEach(() => {
    setPluginToolDisplays({});
  });

  it("内置映射：edit → diff（默认字段映射）", () => {
    const cfg = getToolRenderer({ name: "edit" });
    expect(cfg?.kind).toBe("diff");
    expect(cfg?.fields).toEqual({
      file: "file_path",
      oldValue: "old_text",
      newValue: "new_text",
    });
  });

  it("内置映射：write → content、run_command → terminal", () => {
    expect(getToolRenderer({ name: "write" })?.kind).toBe("content");
    expect(getToolRenderer({ name: "run_command" })?.kind).toBe("terminal");
  });

  it("内置映射覆盖 legacy remote_* 历史工具", () => {
    expect(getToolRenderer({ name: "remote_edit" })?.kind).toBe("diff");
    expect(getToolRenderer({ name: "remote_write" })?.kind).toBe("content");
    expect(getToolRenderer({ name: "remote_bash" })?.kind).toBe("terminal");
  });

  it("未知工具返回 null", () => {
    expect(getToolRenderer({ name: "web_search" })).toBeNull();
  });

  it("后端声明优先于内置映射", () => {
    setPluginToolDisplays({
      edit: {
        text: { executing: "", completed: "" },
        renderer: { kind: "terminal", fields: { command: "cmd" } },
      },
    });
    const cfg = getToolRenderer({ name: "edit" });
    expect(cfg?.kind).toBe("terminal");
    expect(cfg?.fields.command).toBe("cmd");
  });

  it("后端声明的 fields 与默认映射合并（未声明的字段用默认值）", () => {
    setPluginToolDisplays({
      custom_diff: {
        text: { executing: "", completed: "" },
        renderer: { kind: "diff", fields: { oldValue: "before" } },
      },
    });
    const cfg = getToolRenderer({ name: "custom_diff" });
    expect(cfg?.fields.oldValue).toBe("before");
    expect(cfg?.fields.newValue).toBe("new_text");
  });

  it("后端非法 kind 回退内置映射", () => {
    setPluginToolDisplays({
      edit: {
        text: { executing: "", completed: "" },
        renderer: { kind: "bogus" } as any,
      },
    });
    expect(getToolRenderer({ name: "edit" })?.kind).toBe("diff");
  });

  it("tool_use 懒加载二跳：按真实工具名解析", () => {
    const tool: ToolCall = {
      name: "tool_use",
      arguments: JSON.stringify({ tool_name: "edit" }),
    };
    expect(getToolRenderer(tool)?.kind).toBe("diff");
  });
});

describe("getRendererArgs", () => {
  it("从 arguments JSON 字符串提取语义字段", () => {
    const tool: ToolCall = {
      name: "edit",
      arguments: JSON.stringify({
        file_path: "/a/b.ts",
        old_text: "foo",
        new_text: "bar",
      }),
    };
    const cfg = getToolRenderer(tool)!;
    expect(getRendererArgs(tool, cfg)).toEqual({
      file: "/a/b.ts",
      oldValue: "foo",
      newValue: "bar",
    });
  });

  it("arguments 为对象时直接提取", () => {
    const tool: ToolCall = {
      name: "run_command",
      arguments: { command: "pnpm test" },
    };
    const cfg = getToolRenderer(tool)!;
    expect(getRendererArgs(tool, cfg)).toEqual({ command: "pnpm test" });
  });

  it("流式 partial-json：解析已到达的部分字段", () => {
    const tool: ToolCall = {
      name: "edit",
      arguments: '{"file_path": "/a.ts", "old_text": "foo", "new_te',
    };
    const cfg = getToolRenderer(tool)!;
    const args = getRendererArgs(tool, cfg);
    expect(args?.oldValue).toBe("foo");
  });

  it("diff 缺少 old/new 两侧字段返回 null（回退通用渲染）", () => {
    const tool: ToolCall = { name: "edit", arguments: { file_path: "/a.ts" } };
    const cfg = getToolRenderer(tool)!;
    expect(getRendererArgs(tool, cfg)).toBeNull();
  });

  it("arguments 不可解析返回 null", () => {
    const tool: ToolCall = { name: "write", arguments: "{invalid json" };
    const cfg = getToolRenderer(tool)!;
    expect(getRendererArgs(tool, cfg)).toBeNull();
  });
});
