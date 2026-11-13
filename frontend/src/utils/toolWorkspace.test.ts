import { beforeEach, describe, it, expect, vi } from "vitest";
// toolWorkspace 依赖 toolDisplay，后者会间接加载 locales / 图标组件；node 测试环境按既有约定 mock。
vi.mock("@/locales", () => ({ t: vi.fn((k: string) => k) }));
vi.mock("@/components/icons/Terminal.vue", () => ({ default: {} }));
import {
  formatArgsTextWithRemote,
  getRemoteWorkspaceName,
  getToolFileOpenTarget,
} from "./toolWorkspace";
import { setPluginToolDisplays, type ToolCall } from "./toolDisplay";

describe("getRemoteWorkspaceName", () => {
  it("workspace 为连接名 → 返回连接名", () => {
    const tool: ToolCall = {
      name: "edit",
      arguments: { workspace: "dev-server", file_path: "src/a.ts" },
    };
    expect(getRemoteWorkspaceName(tool)).toBe("dev-server");
  });

  it.each(["", "main", "local"])(
    "workspace=%j 视为主工作目录 → undefined",
    (workspace) => {
      const tool: ToolCall = { name: "read", arguments: { workspace } };
      expect(getRemoteWorkspaceName(tool)).toBeUndefined();
    },
  );

  it("未声明 workspace → undefined", () => {
    const tool: ToolCall = {
      name: "read",
      arguments: { file_path: "src/a.ts" },
    };
    expect(getRemoteWorkspaceName(tool)).toBeUndefined();
  });

  it("流式半截 JSON 也能取出 workspace", () => {
    const tool: ToolCall = {
      name: "run_command",
      arguments: '{"workspace":"dev-server","command":"npm test"',
    };
    expect(getRemoteWorkspaceName(tool)).toBe("dev-server");
  });

  it("tool_use 嵌套参数 → 取出内层 workspace", () => {
    const tool: ToolCall = {
      name: "tool_use",
      arguments: {
        tool_name: "write",
        arguments: { workspace: "api-container", file_path: "main.ts" },
      },
    };
    expect(getRemoteWorkspaceName(tool)).toBe("api-container");
  });

  it("workspace 非字符串 → undefined", () => {
    const tool: ToolCall = {
      name: "read",
      arguments: { workspace: 123 },
    };
    expect(getRemoteWorkspaceName(tool)).toBeUndefined();
  });
});

describe("formatArgsTextWithRemote", () => {
  it("远程 + 参数摘要 → 远程·摘要", () => {
    expect(formatArgsTextWithRemote("src/a.ts", "dev-server", "远程")).toBe(
      "远程·src/a.ts",
    );
  });

  it("远程 + 无摘要 → 仅远程标识", () => {
    expect(formatArgsTextWithRemote(undefined, "dev-server", "远程")).toBe(
      "远程",
    );
  });

  it("本地 → 原样返回摘要", () => {
    expect(formatArgsTextWithRemote("src/a.ts", undefined, "远程")).toBe(
      "src/a.ts",
    );
  });

  it("本地 + 无摘要 → undefined", () => {
    expect(formatArgsTextWithRemote(undefined, undefined, "远程")).toBeUndefined();
  });
});

describe("getToolFileOpenTarget", () => {
  beforeEach(() => {
    setPluginToolDisplays({
      read: { text: { executing: "", completed: "" }, argsKey: "file_path" },
    });
  });

  it("本地 read 相对路径 → 返回可打开目标", () => {
    expect(
      getToolFileOpenTarget({
        name: "read",
        arguments: { file_path: "src/components/chat/TurnItem.vue" },
      }),
    ).toEqual({
      path: "src/components/chat/TurnItem.vue",
      fileName: "TurnItem.vue",
    });
  });

  it("Windows 反斜杠与 ./ 前缀归一化", () => {
    expect(
      getToolFileOpenTarget({
        name: "read",
        arguments: { file_path: ".\\src\\utils\\a.ts" },
      }),
    ).toEqual({ path: "src/utils/a.ts", fileName: "a.ts" });
  });

  it("远程 workspace 参数 → null", () => {
    expect(
      getToolFileOpenTarget({
        name: "read",
        arguments: { workspace: "dev-server", file_path: "src/a.ts" },
      }),
    ).toBeNull();
  });

  it("历史 remote_* 工具 → null", () => {
    expect(
      getToolFileOpenTarget({
        name: "remote_read",
        arguments: { file_path: "src/a.ts" },
      }),
    ).toBeNull();
  });

  it("执行中（流式半截路径）→ null", () => {
    expect(
      getToolFileOpenTarget(
        { name: "read", arguments: { file_path: "src/a.ts" } },
        { executing: true },
      ),
    ).toBeNull();
  });

  it("空 file_path / 非文件工具 → null", () => {
    expect(
      getToolFileOpenTarget({ name: "read", arguments: { file_path: "" } }),
    ).toBeNull();
    expect(
      getToolFileOpenTarget({
        name: "glob",
        arguments: { pattern: "src/**/*.ts" },
      }),
    ).toBeNull();
  });

  it("tool_use 嵌套内层 read 参数 → 可解析", () => {
    expect(
      getToolFileOpenTarget({
        name: "tool_use",
        arguments: { tool_name: "read", arguments: { file_path: "src/a.ts" } },
      })?.path,
    ).toBe("src/a.ts");
  });
});
