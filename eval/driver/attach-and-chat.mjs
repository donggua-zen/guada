/**
 * GuaDa 评测驱动：把「目标运行环境」挂成会话的附加工作区，然后驱动一轮对话。
 *
 * 这是接 Harbor adapter 之前的**可独立运行版本**（也是 Harbor adapter 的核心）。
 * 它做的三件事：建连接 → 建会话（并把连接绑定到会话）→ 驱动一轮对话并断言结果。
 *
 * 用法：
 *   node eval/driver/attach-and-chat.mjs --container <容器名或ID> [选项]
 *
 * 选项：
 *   --base    <url>    后端地址，默认 http://127.0.0.1:3000/api/v1
 *   --name    <str>    连接名（= 工具 workspace 参数值），默认 eval-container
 *   --path    <str>    容器内工作目录，默认 /tmp
 *   --perm    <str>    readonly | workspace | unrestricted，默认 unrestricted
 *   --model   <str>    模型 id（providerId:modelName），默认 eval-stub:stub-model
 *   --agent   <str>    智能体 id（= ~/.guada-dev/agents 下的目录名），默认 code-analyst
 *                      ⚠️ 建会话必传：DTO 标了可选，但 service 会抛 "agentId is required"
 *   --task    <str>    用户指令文本
 *   --expect  <str>    期望出现在工具输出里的标记（可重复；直接传逗号分隔）
 *   --timeout <ms>     整轮超时，默认 180000
 *   --keep             保留连接与会话（默认跑完删除，避免污染）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── 参数解析 ──────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (key, def = undefined) => {
  const i = argv.indexOf(`--${key}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const flag = (key) => argv.includes(`--${key}`);

const BASE = arg("base", "http://127.0.0.1:3000/api/v1");
const CONTAINER = arg("container");
const CONN_NAME = arg("name", "eval-container");
const CONTAINER_PATH = arg("path", "/tmp");
const PERM = arg("perm", "unrestricted");
const MODEL = arg("model", "eval-stub:stub-model");
const AGENT = arg("agent", "code-analyst");
const TASK = arg("task", "在目标工作区里跑一条命令，然后读取 /etc/hostname 的内容。");
const EXPECT = (arg("expect", "") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TIMEOUT_MS = Number(arg("timeout", "180000"));
const KEEP = flag("keep");
const USERDATA_DIR =
  process.env.USERDATA_DIR || path.join(os.homedir(), ".guada-dev");

if (!CONTAINER) {
  console.error("缺少 --container <容器名或ID>");
  process.exit(2);
}

let token = null;
let connectionId = null;
let sessionId = null;

async function api(method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 原样返回 */
  }
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} -> ${res.status} ${text.slice(0, 500)}`);
  }
  return json ?? text;
}

// ── 1. 认证（免密模式下降级为无 token）────────────────────
async function login() {
  try {
    const r = await api("POST", "/auth/auto-login");
    token = r?.access_token || r?.token || r?.accessToken || null;
    console.log(`[driver] 已登录（token=${token ? "有" : "无"}）`);
  } catch (err) {
    console.log(`[driver] 自动登录不可用（继续免密尝试）：${err.message.slice(0, 160)}`);
  }
}

// ── 2. 建连接（附着既有容器）──────────────────────────────
async function createConnection() {
  // 同名连接先清掉：连接名唯一，残留会让创建报 500
  const existing = await api("GET", "/remote-workspace/connections");
  const list = Array.isArray(existing) ? existing : existing?.connections || [];
  for (const c of list) {
    if (c?.name === CONN_NAME) {
      await api("DELETE", `/remote-workspace/connections/${c.id}`).catch(() => {});
      console.log(`[driver] 清理同名残留连接 ${c.id}`);
    }
  }

  const config = {
    kind: "docker",
    container: CONTAINER,
    path: CONTAINER_PATH,
    perm: PERM,
  };
  const r = await api("POST", "/remote-workspace/connections", {
    name: CONN_NAME,
    config,
  });
  connectionId = r?.id || r?.connection?.id || r?.connectionId;
  if (!connectionId) throw new Error(`连接创建返回里找不到 id：${JSON.stringify(r)}`);
  console.log(`[driver] 连接已建：${CONN_NAME} (${connectionId}) → 容器 ${CONTAINER}:${CONTAINER_PATH}`);
  return connectionId;
}

// ── 3. 建会话并绑定连接 ────────────────────────────────────
async function createSession(hostWorkspacePath) {
  const body = {
    agentId: AGENT,
    title: `eval ${new Date().toISOString()}`,
    modelId: MODEL,
    workspacePath: hostWorkspacePath,
    settings: {
      sandboxMode: "danger-full-access",
      planEnabled: false,
      attachments: { "ssh-connection": [connectionId] },
    },
  };
  const r = await api("POST", "/sessions", body);
  sessionId = r?.id || r?.session?.id;
  if (!sessionId) throw new Error(`会话创建返回里找不到 id：${JSON.stringify(r)}`);
  console.log(`[driver] 会话已建：${sessionId}（已绑定连接，模型 ${MODEL}）`);
  return sessionId;
}

// ── 4. SSE 订阅 ────────────────────────────────────────────
function openEventStream() {
  const clientId = `eval-driver-${Date.now()}`;
  const events = [];
  const controller = new AbortController();
  const done = { resolve: null, promise: null };
  done.promise = new Promise((resolve) => (done.resolve = resolve));

  (async () => {
    try {
      const res = await fetch(`${BASE}/events/sessions`, {
        headers: {
          Accept: "text/event-stream",
          "x-client-id": clientId,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`SSE ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let evt;
            try {
              evt = JSON.parse(payload);
            } catch {
              continue;
            }
            events.push(evt);
            const method = evt?.method;
            if (method === "stream/tool_calls_response" || method === "tool/result") {
              const names = (evt.payload?.toolCalls || evt.payload?.results || [])
                .map?.((t) => t?.name || t?.toolName)
                .filter(Boolean);
              console.log(`[sse] ${method}${names.length ? ` → ${names.join(", ")}` : ""}`);
            } else if (method === "session/stream_status_changed") {
              const status = evt.payload?.status;
              console.log(`[sse] 会话状态 → ${status}`);
              if (status && status !== "running") done.resolve(status);
            } else if (method === "stream/error" || method === "session/error") {
              console.log(`[sse] 错误事件：${JSON.stringify(evt.payload).slice(0, 300)}`);
            }
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) console.log(`[sse] 流中断：${err.message}`);
      done.resolve("stream-closed");
    }
  })();

  return { events, close: () => controller.abort(), finished: done.promise };
}

// ── 5. 驱动一轮对话 ────────────────────────────────────────
async function sendTurn(instruction) {
  await api("POST", "/chat/stream", {
    sessionId,
    userMessage: { content: instruction },
  });
  console.log("[driver] 指令已提交，等待完成…");
}

async function stopRun() {
  try {
    await api("POST", `/chat/stream/${sessionId}/stop`, {});
    console.log("[driver] 已发送 stop");
  } catch (err) {
    console.log(`[driver] stop 失败：${err.message.slice(0, 160)}`);
  }
}

// ── 6. 读取轨迹并断言 ──────────────────────────────────────
function readTranscript() {
  const dir = path.join(USERDATA_DIR, "sessions", sessionId);
  if (!fs.existsSync(dir)) return { dir, blocks: [], files: [] };
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  const blocks = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        blocks.push(JSON.parse(line));
      } catch {
        /* 跳过坏行 */
      }
    }
  }
  return { dir, blocks, files };
}

function summarizeTranscript(blocks) {
  const toolCalls = [];
  const toolResults = [];
  let finish = null;
  for (const b of blocks) {
    if (b.type === "assistant/message") {
      for (const c of b.data?.content || []) {
        if (c.type === "tool-call") {
          toolCalls.push({ id: c.toolCallId, name: c.name, args: c.arguments });
        }
      }
    } else if (b.type === "tool/result") {
      toolResults.push({
        id: b.data?.toolCallId,
        content: String(b.data?.content ?? ""),
        isError: b.data?.isError ?? b.data?.metadata?.isError ?? false,
      });
    } else if (b.type === "turn/finish") {
      finish = b.data;
    }
  }
  return { toolCalls, toolResults, finish };
}

function cleanup() {
  const tasks = [];
  if (sessionId && !KEEP) tasks.push(api("DELETE", `/sessions/${sessionId}`).catch(() => {}));
  if (connectionId && !KEEP)
    tasks.push(api("DELETE", `/remote-workspace/connections/${connectionId}`).catch(() => {}));
  return Promise.all(tasks);
}

// ── 主流程 ─────────────────────────────────────────────────
const hostWorkspace = path.join(os.tmpdir(), `guada-eval-${Date.now()}`);
fs.mkdirSync(hostWorkspace, { recursive: true });

let exitCode = 1;
try {
  await login();
  await createConnection();
  await createSession(hostWorkspace);

  const stream = openEventStream();
  await new Promise((r) => setTimeout(r, 800)); // 等 SSE 建立（审批面 fail-closed，先连再发）

  await sendTurn(TASK);

  // 完成判定以**轨迹落盘**为准（turn/finish 是真相），SSE 只作辅助信号。
  // 实测：turn 完成时 SSE 未必给到本订阅 session/stream_status_changed。
  const deadline = Date.now() + TIMEOUT_MS;
  let status = null;
  let sseStatus = null;
  void stream.finished.then((s) => (sseStatus = s));
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const { blocks } = readTranscript();
    if (blocks.some((b) => b.type === "turn/finish")) {
      status = "completed";
      break;
    }
    if (sseStatus && sseStatus !== "running") {
      status = sseStatus;
      break;
    }
  }
  if (!status) {
    console.log(`[driver] 超时（${TIMEOUT_MS}ms），主动停止`);
    await stopRun();
    await new Promise((r) => setTimeout(r, 2000));
    status = "timeout";
  } else {
    console.log(`[driver] 轮次结束：${status}`);
  }
  stream.close();

  // SSE 实际收到过哪些事件（用于判断完成信号的可靠性）
  const methodCounts = {};
  for (const e of stream.events)
    methodCounts[e?.method || "(无 method)"] = (methodCounts[e?.method || "(无 method)"] || 0) + 1;
  console.log("\n──── SSE 事件统计 ────");
  for (const [m, c] of Object.entries(methodCounts).sort((a, b) => b[1] - a[1]))
    console.log(`  ${c}× ${m}`);

  const { blocks, dir } = readTranscript();
  const { toolCalls, toolResults, finish } = summarizeTranscript(blocks);

  console.log("\n──── 轨迹摘要 ────");
  console.log(`会话目录：${dir}`);
  console.log(`工具调用 ${toolCalls.length} 次：`);
  for (const c of toolCalls) console.log(`  · ${c.name}  args=${c.args}`);
  console.log(`工具结果 ${toolResults.length} 条：`);
  for (const r of toolResults) {
    console.log(`  · [${r.isError ? "错误" : "ok"}] ${r.content.replace(/\n/g, " ⏎ ").slice(0, 220)}`);
  }
  if (finish) {
    console.log(
      `turn/finish: finishReason=${finish.finishReason} tokens=${finish.totalTokens} (prompt ${finish.promptTokens} / completion ${finish.completionTokens}) model=${finish.modelName}`
    );
  }

  const allOutput = toolResults.map((r) => r.content).join("\n");
  const misses = EXPECT.filter((m) => !allOutput.includes(m));
  const workspaceArgs = toolCalls.filter((c) => (c.args || "").includes(`"workspace"`));

  console.log("\n──── 断言 ────");
  console.log(
    `${workspaceArgs.length}/${toolCalls.length} 次工具调用带 workspace 参数 ${
      workspaceArgs.length === toolCalls.length && toolCalls.length > 0 ? "✅" : "❌"
    }`
  );
  console.log(
    `期望标记命中 ${EXPECT.length - misses.length}/${EXPECT.length} ${
      misses.length === 0 && EXPECT.length > 0 ? "✅" : EXPECT.length ? "❌" : "(未指定)"
    }${misses.length ? `  未命中: ${misses.join(", ")}` : ""}`
  );
  const ok =
    toolCalls.length > 0 && misses.length === 0 && toolResults.some((r) => !r.isError);
  console.log(ok ? "\n结果：PASS ✅" : "\n结果：FAIL ❌");
  exitCode = ok ? 0 : 1;
} catch (err) {
  console.error(`\n[driver] 失败：${err.message}`);
} finally {
  if (!KEEP) await cleanup();
  else console.log(`[driver] --keep：保留连接 ${connectionId} 与会话 ${sessionId}`);
  process.exit(exitCode);
}
