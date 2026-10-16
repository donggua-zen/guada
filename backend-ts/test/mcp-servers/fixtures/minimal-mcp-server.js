/**
 * 最小 MCP 服务器（裸 JSON-RPC over stdio），用于复现真实世界里 `ping` 的三种形态。
 *
 * 为什么需要它：`ping` 在规范里是**可选**方法，而 MCP SDK 把它的结果校验为
 * `EmptyResultSchema = ResultSchema.strict()`——结果**必须为空**。任何非空结果都会被
 * 判为 `unrecognized_keys`，且这个错误没有 JSON-RPC 错误码，无从与「服务器没应答」区分。
 * 这正是「刷新工具能列出工具、测试连接却失败」的成因（实测 metaso 返回 `{"status":"ok"}`）。
 *
 * 用环境变量 `MCP_FIXTURE_PING_MODE` 选择行为：
 * - `ok`          （默认）正常返回空结果 → ping 通过
 * - `unsupported` 返回 -32601 Method not found → 规范允许的"未实现 ping"
 * - `sloppy`      返回 {status:"ok"} → 复现 metaso：多一个字段就被严格 schema 拒
 *
 * stdio 传输的帧格式是**按行分隔的 JSON**（无 Content-Length 头）。
 */
const PING_MODE = process.env.MCP_FIXTURE_PING_MODE || "ok";

let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  // 最后一段可能是不完整行
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    handle(message);
  }
});

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function handle(message) {
  const { id, method } = message;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        // 回显客户端请求的版本，避免协商失败
        protocolVersion: message.params?.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "minimal-fixture", version: "1.0.0" },
      },
    });
    return;
  }

  if (method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "echo",
            description: "回显",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    });
    return;
  }

  if (method === "tools/call") {
    send({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: "ok" }] },
    });
    return;
  }

  if (method === "ping") {
    if (PING_MODE === "unsupported") {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Method not found" },
      });
      return;
    }
    if (PING_MODE === "sloppy") {
      // 多带一个字段——完全无害的写法，却会被 SDK 的严格 schema 拒绝
      send({ jsonrpc: "2.0", id, result: { status: "ok" } });
      return;
    }
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  // 通知（无 id）不应答
  if (id === undefined) return;

  send({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: "Method not found" },
  });
}
