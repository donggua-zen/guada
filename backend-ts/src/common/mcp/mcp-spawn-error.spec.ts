import { classifyMcpSpawnError, describeMcpSpawnError } from "./mcp-spawn-error";

/** 对齐 retry-on-error.util.spec 的 makeError 风格：造带附加字段的假错误 */
function makeError(message: string, extra: Record<string, unknown> = {}): Error {
  const error = new Error(message) as Error & Record<string, unknown>;
  Object.assign(error, extra);
  return error;
}

describe("classifyMcpSpawnError", () => {
  it("ENOENT 原始命令为 node 时归类为 node_missing", () => {
    const error = makeError("spawn node ENOENT", {
      originalError: makeError("spawn node ENOENT", { code: "ENOENT", errno: "ENOENT", path: "node" }),
    });
    expect(classifyMcpSpawnError(error)).toEqual({ reason: "node_missing", command: "node" });
  });

  it.each(["npx", "npm", "pnpx", "bunx"])(
    "ENOENT 原始命令为 %s 时归类为 npx_missing",
    (command) => {
      const error = makeError(`spawn ${command} ENOENT`, {
        originalError: makeError("x", { code: "ENOENT", path: command }),
      });
      expect(classifyMcpSpawnError(error)).toEqual({ reason: "npx_missing", command });
    },
  );

  it("ENOENT 原始命令带路径与可执行后缀时按 base 名分类", () => {
    const error = makeError("spawn C:\\tools\\node.exe ENOENT", {
      originalError: makeError("x", { code: "ENOENT", path: "C:\\tools\\node.exe" }),
    });
    expect(classifyMcpSpawnError(error)).toEqual({ reason: "node_missing", command: "node" });
  });

  it("ENOENT 原始命令为其它运行时归类为 command_missing", () => {
    const error = makeError("spawn uvx ENOENT", {
      originalError: makeError("x", { code: "ENOENT", path: "uvx" }),
    });
    expect(classifyMcpSpawnError(error)).toEqual({ reason: "command_missing", command: "uvx" });
  });

  it("无 originalError 包装时直接读错误本体", () => {
    const error = makeError("spawn node ENOENT", { code: "ENOENT", path: "node" });
    expect(classifyMcpSpawnError(error)).toEqual({ reason: "node_missing", command: "node" });
  });

  it("非 ENOENT 错误返回 null", () => {
    const error = makeError("MCP connection failed: timeout", {
      originalError: makeError("timeout", { code: "ETIMEDOUT", path: "node" }),
    });
    expect(classifyMcpSpawnError(error)).toBeNull();
  });

  it("普通 Error（无 code 字段）返回 null", () => {
    expect(classifyMcpSpawnError(new Error("MCP connection failed: handshake"))).toBeNull();
  });

  it("ENOENT 但拿不到命令名返回 null", () => {
    const error = makeError("spawn ENOENT", {
      originalError: makeError("x", { code: "ENOENT", path: "" }),
    });
    expect(classifyMcpSpawnError(error)).toBeNull();
  });

  it("非对象输入返回 null", () => {
    expect(classifyMcpSpawnError(null)).toBeNull();
    expect(classifyMcpSpawnError("spawn node ENOENT")).toBeNull();
  });
});

describe("describeMcpSpawnError", () => {
  it("三种 reason 都产出含安装指引的可读文本", () => {
    expect(describeMcpSpawnError({ reason: "node_missing", command: "node" })).toContain(
      "https://nodejs.org",
    );
    expect(describeMcpSpawnError({ reason: "npx_missing", command: "npx" })).toContain(
      "npm",
    );
    expect(describeMcpSpawnError({ reason: "command_missing", command: "uvx" })).toContain(
      "uvx",
    );
  });
});
