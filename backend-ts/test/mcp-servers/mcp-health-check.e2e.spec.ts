import * as path from "path";
import { McpClientService } from "../../src/common/mcp/mcp-client.service";
import { McpConnectionManager } from "../../src/common/mcp/mcp-connection-manager.service";
import type { McpServerConfig } from "../../src/common/mcp/mcp.types";

/**
 * 设置页「测试连接」的端到端验证（真实 stdio 子进程）。
 *
 * 这一层专门盯住一个容易出错的结论一致性：**「能刷新出工具列表」与「测试连接通过」
 * 必须同真**。两者都会先建连握手成功，区别只在最后那一步请求——
 * 刷新工具走 `tools/list`（服务器必须支持），测试连接首选 `ping`。
 *
 * 而 `ping` 在规范里是**可选**的，且 MCP SDK 把它的结果校验为
 * `EmptyResultSchema = ResultSchema.strict()`（结果必须为空）。任何非空结果都会抛出
 * 没有错误码的 Zod 错误，无从与「服务器没应答」区分。曾经因此把健康的服务器判成不可达
 * （实测 metaso 返回 {"status":"ok"}：ping 失败、tools/list 正常返回 6 个工具）。
 * 下面三种 ping 形态都必须判为**通过**。
 */

const STATEFUL = path.join(__dirname, "fixtures", "stateful-mcp-server.js");
const MINIMAL = path.join(__dirname, "fixtures", "minimal-mcp-server.js");

function stdioConfig(
  script: string,
  env?: Record<string, string>,
): McpServerConfig {
  return { type: "stdio", command: process.execPath, args: [script], env };
}

jest.setTimeout(30_000);

describe("MCP 测试连接（端到端）", () => {
  let manager: McpConnectionManager;
  let service: McpClientService;

  beforeEach(() => {
    manager = new McpConnectionManager();
    service = new McpClientService(manager);
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  it("ping 正常返回空结果的服务器：通过", async () => {
    const config = stdioConfig(MINIMAL, { MCP_FIXTURE_PING_MODE: "ok" });

    await expect(
      service.healthCheck(config, { serverId: "ping-ok" }),
    ).resolves.toBe(true);
  });

  it("未实现 ping 的服务器：通过（规范里 ping 是可选的）", async () => {
    const config = stdioConfig(MINIMAL, { MCP_FIXTURE_PING_MODE: "unsupported" });

    await expect(
      service.healthCheck(config, { serverId: "ping-unsupported" }),
    ).resolves.toBe(true);
  });

  it("ping 结果多带字段的服务器：仍通过（复现 metaso 的 status 字段）", async () => {
    const config = stdioConfig(MINIMAL, { MCP_FIXTURE_PING_MODE: "sloppy" });

    await expect(
      service.healthCheck(config, { serverId: "ping-sloppy" }),
    ).resolves.toBe(true);
  });

  it("结论一致性：能列出工具 ⇒ 测试连接通过（三种 ping 形态全过）", async () => {
    const cases = [
      ["stateful（SDK 服务器）", stdioConfig(STATEFUL), undefined],
      ["ping-ok", stdioConfig(MINIMAL, { MCP_FIXTURE_PING_MODE: "ok" }), undefined],
      [
        "ping-unsupported",
        stdioConfig(MINIMAL, { MCP_FIXTURE_PING_MODE: "unsupported" }),
        undefined,
      ],
      [
        "ping-sloppy",
        stdioConfig(MINIMAL, { MCP_FIXTURE_PING_MODE: "sloppy" }),
        undefined,
      ],
    ] as const;

    for (const [label, config] of cases) {
      const tools = await service.listTools(config, { serverId: label });
      const healthy = await service.healthCheck(config, { serverId: label });

      expect({
        label,
        listable: Object.keys(tools).length > 0,
        healthy,
      }).toEqual({ label, listable: true, healthy: true });
    }
  });

  it("服务器连不上时判为失败，且不抛错", async () => {
    const config = stdioConfig(
      path.join(__dirname, "fixtures", "nonexistent-server.js"),
    );

    await expect(
      service.healthCheck(config, { serverId: "missing" }),
    ).resolves.toBe(false);
  });
});
