import * as path from "path";
import { McpClientService } from "../../src/common/mcp/mcp-client.service";
import { McpConnectionManager } from "../../src/common/mcp/mcp-connection-manager.service";
import { isProcessAlive } from "../../src/common/utils/process-tree.util";
import type { McpServerConfig } from "../../src/common/mcp/mcp.types";

/**
 * 连接复用的端到端验证（真实 stdio 子进程，不打桩）。
 *
 * 单元测试只能证明"管理器的意图"，这里证明"改造真的解决了原问题"：
 * 改造前每次 callTool 都新建 Client + spawn 子进程，服务器内存状态每次从零开始；
 * 下面用 fixture 服务器暴露的内存计数与 pid 直接观测这一点。
 */

const FIXTURE = path.join(__dirname, "fixtures", "stateful-mcp-server.js");

const CONFIG: McpServerConfig = {
  type: "stdio",
  command: process.execPath,
  args: [FIXTURE],
};

// 真实进程 spawn + initialize 握手，放宽到 30s
jest.setTimeout(30_000);

describe("MCP 连接复用（端到端）", () => {
  let manager: McpConnectionManager;
  let service: McpClientService;

  beforeEach(() => {
    manager = new McpConnectionManager();
    service = new McpClientService(manager);
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  async function call(tool: string, signal?: AbortSignal) {
    return await service.callTool(CONFIG, tool, {}, { serverId: "fixture", signal });
  }

  it("同一服务器的多次调用落在同一个服务器进程上", async () => {
    const first = await call("pid");
    const second = await call("pid");

    expect(first.success).toBe(true);
    expect(second.content).toBe(first.content);
    expect(first.content).toMatch(/^\d+$/);
  });

  it("服务器内存状态跨调用保持（改造前每次都从 1 重来）", async () => {
    expect((await call("count")).content).toBe("1");
    expect((await call("count")).content).toBe("2");
    expect((await call("count")).content).toBe("3");
  });

  it("并发调用共享同一条连接（5 个调用由一个进程串行计数）", async () => {
    const results = await Promise.all([
      call("count"),
      call("count"),
      call("count"),
      call("count"),
      call("count"),
    ]);

    const counts = results.map((r) => r.content).sort();
    // 5 个独立进程会各自返回 "1"；只有共享连接才会得到 1..5
    expect(counts).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("协议级 isError 一路透传为失败（不是把它当正常输出）", async () => {
    const result = await call("fail");

    expect(result.success).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.content).toBe("boom");
  });

  it("取消信号能中断在途请求（不再跑到超时）", async () => {
    const controller = new AbortController();
    // fixture 的 slow 工具睡 3s；这里 200ms 就取消
    setTimeout(() => controller.abort(), 200);

    const startedAt = Date.now();
    const result = await call("slow", controller.signal);
    const elapsed = Date.now() - startedAt;

    expect(result.success).toBe(false);
    // 关键：远早于 3s 返回，说明请求真的被中断了
    expect(elapsed).toBeLessThan(2_500);
  });

  it("shutdown 会连根回收 stdio 子进程（不留孤儿）", async () => {
    const pid = Number((await call("pid")).content);
    expect(isProcessAlive(pid)).toBe(true);

    await manager.shutdown();

    await waitUntil(() => !isProcessAlive(pid), 5_000);
    expect(isProcessAlive(pid)).toBe(false);
  });
});

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
