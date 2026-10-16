/**
 * 用于端到端测试的最小 MCP 服务器（stdio）。
 *
 * 它存在的唯一目的：把「连接是否被复用」变成**可观测**的事实。
 * - `pid`   返回服务自身进程 pid → 复用则两次调用 pid 相同，重建则不同
 * - `count` 返回内存里的自增计数 → 复用则 1,2,3…；每次重连都会从 1 重新开始
 * - `fail`  返回协议级 isError → 验证失败标记有没有被透传
 * - `slow`  睡 3s 才返回 → 验证取消信号能否真正中断在途请求
 *
 * 注意：stdout 是 MCP 协议通道，任何调试输出都必须走 stderr。
 */
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

/** 内存态：只活在本进程里，正是「重连即丢失」的那类状态 */
let callCount = 0;

const server = new Server(
  { name: "stateful-fixture", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

const emptySchema = { type: "object", properties: {} };

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "pid", description: "服务器进程 pid", inputSchema: emptySchema },
    { name: "count", description: "内存自增计数", inputSchema: emptySchema },
    { name: "fail", description: "总是返回协议级错误", inputSchema: emptySchema },
    { name: "slow", description: "3 秒后返回", inputSchema: emptySchema },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "pid":
      return { content: [{ type: "text", text: String(process.pid) }] };
    case "count":
      callCount += 1;
      return { content: [{ type: "text", text: String(callCount) }] };
    case "fail":
      return { isError: true, content: [{ type: "text", text: "boom" }] };
    case "slow":
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return { content: [{ type: "text", text: "done" }] };
    default:
      return {
        isError: true,
        content: [{ type: "text", text: `unknown tool: ${request.params.name}` }],
      };
  }
});

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  process.stderr.write(`fixture server failed: ${error}\n`);
  process.exit(1);
});
