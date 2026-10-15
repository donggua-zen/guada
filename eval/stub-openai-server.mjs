/**
 * 脚本化模型服务（OpenAI 兼容最小桩）
 *
 * 用途：零成本、确定性地驱动 GuaDa 的 agent 循环发出**指定的工具调用**，
 * 用来验证工具是否真的落在目标工作区（容器 / SSH），而不需要真实模型和 API 费用。
 * 这也是"harness 回归套件"的种子——真实模型的随机性会让回归信号淹没在噪声里。
 *
 * 用法：
 *   STUB_WORKSPACE=<连接名> node eval/stub-openai-server.mjs
 *   STUB_PORT=8899            # 默认 8899
 *   STUB_STEPS='[{"type":"tool","name":"run_command","args":{"command":"echo hi"}}, ...]'
 *                             # 可选，覆盖默认脚本；args 里会自动补 workspace
 *
 * 步进规则（无状态）：请求里 role=tool 的消息条数 = 已执行的工具数 = 下一个脚本步。
 * 这样重试/并发都不会错位。
 */
import http from "node:http";

const PORT = Number(process.env.STUB_PORT || 8899);
const WORKSPACE = process.env.STUB_WORKSPACE || "";
const MODEL = process.env.STUB_MODEL || "stub-model";

/** 默认脚本：一条 shell 命令 + 一次文件读取，都指向目标工作区
 *  注意：命令刻意不含引号与换行——远程执行链路对引号的二次包裹会让 sh 报
 *  "Unterminated quoted string"（见 docs/agent-benchmark-integration.md 的排查记录），
 *  这里先只验证「命令是否落在目标环境」，把引号问题作为独立议题单独验。 */
const DEFAULT_STEPS = [
  {
    type: "tool",
    name: "run_command",
    args: {
      command:
        "echo STUB_IN_WORKSPACE; pwd; hostname; uname -m; ls -a / | head -8",
    },
  },
  { type: "tool", name: "read", args: { file_path: "/etc/hostname" } },
  { type: "text", content: "STUB_DONE" },
];

let steps = DEFAULT_STEPS;
const stepsSource = process.env.STUB_STEPS_FILE
  ? (await import("node:fs")).readFileSync(process.env.STUB_STEPS_FILE, "utf8")
  : process.env.STUB_STEPS;
if (stepsSource) {
  try {
    steps = JSON.parse(stepsSource);
  } catch (err) {
    console.error(`[stub] 脚本解析失败，改用默认脚本: ${err.message}`);
  }
}

function withWorkspace(args) {
  if (!WORKSPACE) return args;
  return { ...args, workspace: WORKSPACE };
}

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function chunk(delta, finishReason = null) {
  return {
    id: "chatcmpl-stub",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

/** 把一次脚本步渲染成 OpenAI 流式分片（工具调用一次性给全，避免增量拼接歧义） */
function streamStep(res, step) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  sse(res, chunk({ role: "assistant", content: "" }));

  if (step.type === "tool") {
    sse(
      res,
      chunk({
        tool_calls: [
          {
            index: 0,
            id: `call_stub_${Date.now()}`,
            type: "function",
            function: {
              name: step.name,
              arguments: JSON.stringify(withWorkspace(step.args || {})),
            },
          },
        ],
      })
    );
    sse(res, chunk({}, "tool_calls"));
  } else {
    sse(res, chunk({ content: step.content ?? "" }));
    sse(res, chunk({}, "stop"));
  }

  // usage 分片（choices 为空），让 token 计量有数据
  res.write(
    `data: ${JSON.stringify({
      id: "chatcmpl-stub",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: MODEL,
      choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    })}\n\n`
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

function nonStreamStep(res, step) {
  const body =
    step.type === "tool"
      ? {
          id: "chatcmpl-stub",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: MODEL,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: `call_stub_${Date.now()}`,
                    type: "function",
                    function: {
                      name: step.name,
                      arguments: JSON.stringify(withWorkspace(step.args || {})),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }
      : {
          id: "chatcmpl-stub",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: MODEL,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: step.content ?? "" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url.includes("chat/completions")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
    return;
  }

  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      /* 忽略解析失败，走默认步 */
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const toolMsgs = messages.filter((m) => m.role === "tool");
    const namedTools = (body.tools || [])
      .map((t) => t?.function?.name)
      .filter(Boolean);

    const stepIndex = toolMsgs.length;
    const step = steps[stepIndex] || { type: "text", content: "STUB_DONE" };

    console.error(
      `[stub] 请求 #${stepIndex + 1} stream=${!!body.stream} messages=${messages.length} ` +
        `已执行工具=${toolMsgs.length} 广告工具=${namedTools.length} -> 执行步骤 ${step.type}${
          step.type === "tool" ? `:${step.name}` : ""
        }`
    );
    if (toolMsgs.length) {
      const last = toolMsgs[toolMsgs.length - 1];
      const text = typeof last.content === "string" ? last.content : JSON.stringify(last.content);
      console.error(`[stub] 上一个工具结果（前 600 字符）:\n${(text || "").slice(0, 600)}`);
    }

    if (body.stream) streamStep(res, step);
    else nonStreamStep(res, step);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(
    `[stub] OpenAI 兼容桩已启动 http://127.0.0.1:${PORT}/v1/  workspace=${WORKSPACE || "(未设置，工具将走本地)"}`
  );
  console.error(`[stub] 脚本步数=${steps.length}`);
});
