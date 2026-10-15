/**
 * Docker 容器工作区 — 后端集成冒烟（真实链路验收）
 *
 * 走后端真实模块：inspectContainer → ensureAgentInContainer（docker cp 注入）→
 * connectDockerAgent（docker exec -i stdio 长连接）→ RemoteAgent 原语电池 → 关闭。
 *
 * 前置：Docker 可用；本地 agent 缓存存在 linux/amd64 二进制
 * （无 latestVersionUrl 配置时 ensureLocalBinary 读 ~/.guada/agent/guada-agent-linux-amd64，
 * 开发时执行 `cd guada-agent && make linux-amd64 && cp dist/guada-agent-linux-amd64 ~/.guada/agent/`）。
 *
 * 用法: npx ts-node src/scripts/docker-workspace-smoke.ts [container] [rootPath]
 */
import { connectDockerAgent, listDockerContainers, runDocker } from "../modules/remote-workspace/docker-agent-connect";
import { RemoteAgent, RemoteAgentManager } from "../modules/remote-workspace/remote-workspace-agent-manager";
import { WorkspaceToolRouter } from "../modules/remote-workspace/workspace-router";
import type { RemoteConnection } from "../modules/remote-workspace/remote-workspace.service";

const CONTAINER = process.argv[2] || "guada-docker-smoke";
const ROOT = process.argv[3] || "/tmp/guada-backend-smoke";
const READONLY_CONTAINER = `${CONTAINER}-ro`;

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (cond) passed++;
  else failed++;
}

async function main(): Promise<void> {
  console.log(`== Docker 工作区后端集成冒烟: container=${CONTAINER} root=${ROOT} ==\n`);

  // 0) 准备容器内项目目录（模拟用户已有的项目目录；连接配置要求目录已存在，与 SSH 一致）
  const prep = await runDocker({}, ["exec", CONTAINER, "sh", "-c", `mkdir -p '${ROOT}'`]);
  if (prep.code !== 0) {
    console.error(`准备容器目录失败: ${prep.stderr || prep.stdout}`);
    process.exit(2);
  }

  // 1) 容器列表（向导选择器用）
  const containers = await listDockerContainers({});
  check(
    "listDockerContainers: 命中目标容器",
    containers.some((c) => c.name === CONTAINER),
    containers.map((c) => c.name).join(", "),
  );

  // 2) 连接（含注入 + 握手）
  const t0 = Date.now();
  const conn = await connectDockerAgent(
    { kind: "docker", container: CONTAINER, path: ROOT, perm: "workspace" },
    {
      latestVersionUrl: "", // 空 = 不做升级检测，走本地缓存（与 SSH 未配置 latest 时一致）
      onLog: (l) => console.log(`   [log] ${l}`),
    },
  );
  check("connectDockerAgent: 建立 stdio 连接", !!conn.rpc, `${Date.now() - t0}ms, agent v${conn.version}`);
  check("inspect: 平台信息", conn.container.os === "linux", `${conn.container.os}/${conn.container.arch}`);
  check("root 生效值", conn.rootPath === ROOT, conn.rootPath);

  const agent = new RemoteAgent(conn.rpc, { path: conn.rootPath });

  try {
    // 3) 文件原语（RemoteAgent 包装层，工具实际调用面）
    await agent.writeFileRaw("sub/a.txt", "hello from backend\nsecond line\n", "utf-8");
    const read = await agent.readFileRaw("sub/a.txt", "utf-8");
    check("writeFileRaw → readFileRaw 往返", read === "hello from backend\nsecond line\n", JSON.stringify(read));

    const st = await agent.stat("sub/a.txt");
    check("stat", st.size === 31 && st.isFile === true, JSON.stringify({ size: st.size, isFile: st.isFile }));

    const entries = await agent.readdir("sub");
    check("readdir: 数组且含 a.txt", Array.isArray(entries) && entries.some((e) => e.name === "a.txt"));

    await agent.mkdir("deep/nested", { recursive: true });
    await agent.rename("sub/a.txt", "sub/b.txt");
    const entries2 = await agent.readdir("sub");
    check("rename 生效", entries2.some((e) => e.name === "b.txt"));

    // 4) 搜索原语（原生 RPC）
    const glob = await agent.globRaw("**/*.txt", ROOT, undefined, 50, undefined);
    check("globRaw: 命中 b.txt", glob.files.some((f) => f.path.includes("b.txt")), JSON.stringify(glob.files.map((f) => f.path)));

    const grep = await agent.grepRaw("hello", ROOT, 10);
    check("grepRaw: 命中内容", grep.some((l) => l.includes("b.txt")), JSON.stringify(grep));

    // 5) 命令执行（含输出 base64 编码链）
    const exec = await agent.executeRaw("echo container-exec-ok && id -u", { timeoutMs: 15000 });
    check("executeRaw: 输出 + 退出码", String(exec.output).includes("container-exec-ok") && exec.exitCode === 0, JSON.stringify({ exitCode: exec.exitCode }));

    const execB64 = await agent.executeRaw("printf '\\xe4\\xb8\\xad\\xe6\\x96\\x87 \\xff\\xfe'", { timeoutMs: 15000, encoding: "utf-8" });
    check(
      "executeRaw(outputB64): 非 UTF-8 字节经 base64 还原",
      typeof execB64.output === "string" && execB64.output.includes("中文"),
      JSON.stringify(execB64.output),
    );

    // 6) 后台进程（超时转后台 → poll → drain）
    const bg = await agent.executeRaw("sleep 3; echo bg-ok", { timeoutMs: 600 });
    check("executeRaw: 超时转后台", bg.kind === "backgrounded" && !!bg.processId, JSON.stringify({ kind: bg.kind, pid: bg.processId, log: bg.logFile }));
    const poll = await agent.pollRaw(bg.processId!, 8000);
    check("pollRaw: 后台完成", !!poll && poll.status === "completed", JSON.stringify(poll));

    // 7) 权限：workspace 模式拒绝容器内 root 之外的写入
    let denied = false;
    try {
      await agent.writeFileRaw("/etc/should-fail.txt", "x", "utf-8");
    } catch (e: any) {
      denied = /permission denied/i.test(String(e?.message || e));
    }
    check("perm=workspace: root 外写入被拒", denied);

    // 8) 断线自动恢复：手动关闭连接后重新连接（等价空闲回收/容器重启后的重建路径）
    conn.rpc.close();
    await new Promise((r) => setTimeout(r, 1200));
    const conn2 = await connectDockerAgent(
      { kind: "docker", container: CONTAINER, path: ROOT, perm: "workspace" },
      { latestVersionUrl: "" },
    );
    const agent2 = new RemoteAgent(conn2.rpc, { path: conn2.rootPath });
    const read2 = await agent2.readFileRaw("sub/b.txt", "utf-8");
    check("重连后文件仍可读（容器内 agent 目录复用）", read2.includes("hello from backend"));
    conn2.rpc.close();
  } finally {
    conn.rpc.close();
  }

  // ── 9) 工具层全链路：WorkspaceToolRouter → RemoteAgentManager（会话绑定校验）→ docker provider ──
  {
    const connection: RemoteConnection = {
      id: "conn-smoke-1",
      name: "container-ws",
      config: { kind: "docker", container: CONTAINER, path: ROOT, perm: "workspace" },
    };
    const serviceStub: any = {
      getConnections: async () => [connection],
      getAgentDownloadUrl: async () => "",
      getAgentLatestVersionUrl: async () => "",
    };
    const manager = new RemoteAgentManager(serviceStub);
    const router = new WorkspaceToolRouter(manager);

    // 未绑定会话 → 拒绝（与 SSH 链同语义）
    let unboundRejected = false;
    try {
      await router.resolveRemoteTarget("container-ws", "sess-smoke", { "ssh-connection": [] });
    } catch (e: any) {
      unboundRejected = /not bound to this session|No remote or container connections bound/.test(
        String(e?.message || e),
      );
    }
    check("路由：未绑定会话的连接被拒", unboundRejected);

    const attachments = { "ssh-connection": ["conn-smoke-1"] };
    const target = await router.resolveRemoteTarget("container-ws", "sess-smoke", attachments);
    check("路由：解析出 docker 目标", !!target && target.provider.scheme === "docker", `basePath=${target?.basePath}`);
    if (target) {
      await target.provider.writeFile("router.txt", "via-router\n");
      const back = String(await target.provider.readFile("router.txt", { encoding: "utf-8" }));
      check("provider：经路由器写入/读取容器", back === "via-router\n", JSON.stringify(back));
      const exec = await target.provider.execute!("echo router-exec-ok", target.basePath, { timeout: 15000 });
      check(
        "provider：经路由器执行命令",
        String((exec as any).output).includes("router-exec-ok"),
        JSON.stringify({ kind: (exec as any).kind, exitCode: (exec as any).exitCode }),
      );
      // 主工作目录取值不触发连接
      const main = await router.resolveRemoteTarget("main", "sess-smoke", attachments);
      check("路由：main 返回 null（主工作目录）", main === null);
    }
    manager.dispose();
  }

  // ── 10) 负例：只读 rootfs 容器 → 拒绝并给出可操作错误 ──
  {
    await runDocker({}, ["rm", "-f", READONLY_CONTAINER]);
    const start = await runDocker({}, [
      "run", "-d", "--name", READONLY_CONTAINER, "--read-only", "alpine:latest", "sleep", "infinity",
    ]);
    if (start.code !== 0) {
      check("负例：启动只读容器", false, start.stderr.trim());
    } else {
      let errText = "";
      try {
        await connectDockerAgent(
          { kind: "docker", container: READONLY_CONTAINER, path: "/tmp", perm: "workspace" },
          { latestVersionUrl: "" },
        );
      } catch (e: any) {
        errText = String(e?.message || e);
      }
      check(
        "负例：只读 rootfs 报明确错误",
        /无法在容器.*内安装 agent/.test(errText) && /只读|不可写|noexec/.test(errText),
        errText.split("\n").slice(0, 2).join(" | "),
      );
      await runDocker({}, ["rm", "-f", READONLY_CONTAINER]);
    }
  }

  console.log(`\n== 结果: ${passed} passed, ${failed} failed ==`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("冒烟脚本异常:", e?.stack || e);
  process.exit(2);
});
