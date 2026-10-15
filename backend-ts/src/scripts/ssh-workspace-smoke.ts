/**
 * SSH 工作区冒烟（生产链路验收）
 *
 * 走生产编排 `connectSshAgent`：供给（按需上传 agent）→ **按远端版本选择传输**
 * （≥ 0.6.0 → ssh exec stdio；< 0.6.0 → 端口转发 + WebSocket 回退）→ RemoteAgent 原语电池。
 *
 * 参数（缺省对齐 bench 容器）:
 *   --host=127.0.0.1 --port=2222 --user=root --password=benchpw --root=/tmp/guada-ws-test
 *   --expect=stdio|ws-forward   断言期望的传输方式（缺省 stdio）
 *   --latest=<url>              配置 latest 接口（模拟线上发布，用于验证"旧版自动升级并切换 stdio"）
 *
 * 环境准备：需要一台可从本机 ssh 登录的 sshd（容器做法见 docs/docker容器工作区方案.md：
 * alpine + `apk add openssh` + 开启 PermitRootLogin/PasswordAuthentication，注意 Alpine 的
 * openssh 默认关闭端口转发——这正好也是本迁移要解决的兼容性问题，回退链路测试时需显式开启）。
 *
 * 前置：本地 agent 缓存存在当前构建的 linux 二进制
 * （cd guada-agent && make linux-amd64 && cp dist/guada-agent-linux-amd64 ~/.guada/agent/）
 */
import type { ParsedWorkspaceUri } from "../common/workspace/workspace-provider.interface";
import { connectSshAgent, type SshAgentConnection } from "../modules/remote-workspace/ssh-agent-connect";
import { RemoteAgent } from "../modules/remote-workspace/remote-workspace-agent-manager";

function arg(name: string, def: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}

const HOST = arg("host", "127.0.0.1");
const PORT = parseInt(arg("port", "2222"), 10);
const USER = arg("user", "root");
const PASSWORD = arg("password", "benchpw");
const ROOT = arg("root", "/tmp/guada-ws-test");
const EXPECT = arg("expect", "stdio") as "stdio" | "ws-forward";
const LATEST_URL = arg("latest", "");

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (cond) passed++;
  else failed++;
}

const URI: ParsedWorkspaceUri = {
  scheme: "ssh",
  host: HOST,
  port: PORT,
  username: USER,
  password: PASSWORD,
  path: ROOT,
};

async function battery(label: string, conn: SshAgentConnection): Promise<void> {
  const agent = new RemoteAgent(conn.rpc, { path: ROOT });
  await agent.writeFileRaw("sub/a.txt", "hello from ssh smoke\nsecond line\n", "utf-8");
  const read = await agent.readFileRaw("sub/a.txt", "utf-8");
  check(`[${label}] writeFileRaw → readFileRaw`, read === "hello from ssh smoke\nsecond line\n", JSON.stringify(read));

  const st = await agent.stat("sub/a.txt");
  check(`[${label}] stat`, st.size === 33 && st.isFile === true, JSON.stringify({ size: st.size }));

  const entries = await agent.readdir("sub");
  check(`[${label}] readdir`, Array.isArray(entries) && entries.some((e) => e.name === "a.txt"));

  await agent.mkdir("deep/nested", { recursive: true });
  await agent.rename("sub/a.txt", "sub/b.txt");
  const entries2 = await agent.readdir("sub");
  check(`[${label}] rename`, entries2.some((e) => e.name === "b.txt"));

  const glob = await agent.globRaw("**/*.txt", ROOT, undefined, 50, undefined);
  check(`[${label}] globRaw`, glob.files.some((f) => f.path.includes("b.txt")), JSON.stringify(glob.files.map((f) => f.path)));

  const grep = await agent.grepRaw("hello from ssh smoke", ROOT, 10);
  check(`[${label}] grepRaw`, grep.some((l) => l.includes("b.txt")), JSON.stringify(grep));

  const exec = await agent.executeRaw("echo ssh-exec-ok && uname -s", { timeoutMs: 15000 });
  check(
    `[${label}] executeRaw`,
    String(exec.output).includes("ssh-exec-ok") && exec.exitCode === 0,
    JSON.stringify({ exitCode: exec.exitCode, kind: exec.kind }),
  );

  const bad = await agent.executeRaw("echo to-stderr >&2; exit 7", { timeoutMs: 15000 });
  check(`[${label}] execute: 非零退出码透传`, bad.exitCode === 7, `exitCode=${bad.exitCode}`);

  const bg = await agent.executeRaw("sleep 3; echo bg-ok", { timeoutMs: 600 });
  check(`[${label}] execute: 超时转后台`, bg.kind === "backgrounded" && !!bg.processId, JSON.stringify({ kind: bg.kind, pid: bg.processId }));
  if (bg.processId) {
    const poll = await agent.pollRaw(bg.processId, 8000);
    check(`[${label}] poll: 后台完成`, !!poll && poll.status === "completed", JSON.stringify(poll));
  }

  let denied = false;
  try {
    await agent.writeFileRaw("/etc/should-fail.txt", "x", "utf-8");
  } catch (e: any) {
    denied = /permission denied/i.test(String(e?.message || e));
  }
  check(`[${label}] perm=workspace: root 外写入被拒`, denied);
}

async function main(): Promise<void> {
  console.log(`== SSH 工作区冒烟: ${USER}@${HOST}:${PORT} root=${ROOT} expect=${EXPECT} ==\n`);

  // 连接（含供给：容器/远端无 agent 时自动上传本地缓存二进制）
  const t0 = Date.now();
  const conn = await connectSshAgent(URI, {
    downloadUrl: "",
    latestVersionUrl: LATEST_URL, // 空 = 不做升级检测，走本地缓存（与未配置 latest 时一致）
    onLog: (l) => console.log(`   [log] ${l}`),
  });
  check("connectSshAgent: 建立连接", !!conn.rpc, `${Date.now() - t0}ms, agent v${conn.version}`);
  check(`传输方式 = ${EXPECT}（实际 ${conn.kind}）`, conn.kind === EXPECT, `version=${conn.version}`);

  try {
    await battery(conn.kind, conn);
  } finally {
    conn.dispose();
  }

  // 重连（二进制已在远端：验证快路径与传输选择稳定）
  await new Promise((r) => setTimeout(r, 800));
  const conn2 = await connectSshAgent(URI, { downloadUrl: "", latestVersionUrl: LATEST_URL });
  check("重连：传输方式一致", conn2.kind === EXPECT, `kind=${conn2.kind}, v${conn2.version}`);
  const agent2 = new RemoteAgent(conn2.rpc, { path: ROOT });
  const read2 = await agent2.readFileRaw("sub/b.txt", "utf-8");
  check("重连后文件仍可读", read2.includes("hello from ssh smoke"));
  conn2.dispose();

  console.log(`\n== 结果: ${passed} passed, ${failed} failed ==`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("冒烟脚本异常:", e?.stack || e);
  process.exit(2);
});
