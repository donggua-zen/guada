/**
 * 容器工作区 RPC 探针：不经 GuaDa 后端，直接对着容器内的 guada-agent 发一条 RPC。
 *
 * 用途：分层定位问题——当 GuaDa 链路里某个工具行为异常时，用它判断问题在
 * 「agent / 传输」还是「后端封装」。
 *
 * 用法：
 *   node eval/probe/rpc-probe.mjs --container <容器名或ID> --command 'echo "hi"' [--method execute]
 *   node eval/probe/rpc-probe.mjs --container eval-target --json '{"id":"1","method":"ping","params":{}}'
 *
 * 注意：必须保持 stdin 打开（见 stream.go 的 EOF 语义），本工具已内置。
 */
import { spawn } from "node:child_process";
import process from "node:process";

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const CONTAINER = arg("container");
const AGENT_PATH = arg("agent", "/tmp/.guada-agent/guada-agent");
const ROOT = arg("root", "/tmp");
const PERM = arg("perm", "unrestricted");
const METHOD = arg("method", "execute");
const COMMAND = arg("command", "echo ok");
const RAW_JSON = arg("json");
const HOLD_MS = Number(arg("hold", "4000"));

if (!CONTAINER) {
  console.error("缺少 --container");
  process.exit(2);
}

const req = RAW_JSON
  ? RAW_JSON
  : JSON.stringify({ id: "probe-1", method: METHOD, params: { command: COMMAND, cwd: ROOT } });

console.log(`[probe] 容器=${CONTAINER} 请求=${req}`);

const child = spawn(
  "docker",
  ["exec", "-i", CONTAINER, AGENT_PATH, "--stdio", "--root", ROOT, "--perm", PERM],
  { stdio: ["pipe", "pipe", "pipe"] }
);

let stdout = "";
let stderr = "";
child.stdout.on("data", (c) => (stdout += c.toString()));
child.stderr.on("data", (c) => (stderr += c.toString()));

// 发一条请求，然后**保持管道打开**等响应（EOF 会让 agent 立即退出，丢掉在途响应）
child.stdin.write(req + "\n");

setTimeout(() => {
  child.stdin.end();
}, HOLD_MS);

child.on("close", (code) => {
  console.log("[probe] 响应：");
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      console.log(JSON.stringify(obj, null, 2));
    } catch {
      console.log(line);
    }
  }
  if (stderr.trim()) {
    console.log("[probe] agent stderr（诊断，非协议通道）：");
    console.log(stderr.trim().split("\n").slice(-6).join("\n"));
  }
  console.log(`[probe] 退出码=${code}`);
  process.exit(0);
});
