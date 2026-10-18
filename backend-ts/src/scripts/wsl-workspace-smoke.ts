/**
 * WSL 发行版工作区 — 后端集成冒烟（真实链路验收）
 *
 * 走后端真实模块：inspectWslTarget（探测 + 自动拉起）→ ensureAgentInWsl（stdin 注入）→
 * connectWslAgent（wsl.exe --exec stdio 长连接）→ RemoteAgent 原语电池 → 工具路由器全链路 → 关闭。
 *
 * 前置：Windows + WSL 已安装；本地 agent 缓存存在 linux/<arch> 二进制
 * （无 latestVersionUrl 配置时 ensureLocalBinary 读 ~/.guada/agent/guada-agent-linux-amd64，
 * 开发时执行 `cd guada-agent && make linux-amd64 && cp dist/guada-agent-linux-amd64 ~/.guada/agent/`）。
 *
 * 用法: npx ts-node src/scripts/wsl-workspace-smoke.ts [--distro=<name>] [--root=<path>]
 *   缺省发行版 = WSL 默认发行版；缺省 root = /tmp/guada-wsl-smoke
 */
import { listWslDistros, runWsl, connectWslAgent } from "../modules/remote-workspace/wsl-agent-connect";
import {
  RemoteAgent,
  RemoteAgentManager,
} from "../modules/remote-workspace/remote-workspace-agent-manager";
import { WorkspaceToolRouter } from "../modules/remote-workspace/workspace-router";
import type { RemoteConnection } from "../modules/remote-workspace/remote-workspace.service";

function arg(name: string, def: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}

const DISTRO = arg("distro", process.env.GUADA_WSL_DISTRO || "");
const ROOT = arg("root", "/tmp/guada-wsl-smoke");
const MISSING_ROOT = `${ROOT}-missing`;

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (cond) passed++;
  else failed++;
}

async function main(): Promise<void> {
  console.log(`== WSL 工作区后端集成冒烟: distro=${DISTRO || "(默认)"} root=${ROOT} ==\n`);

  // 0) 发行版列表（向导选择器用）
  const listed = await listWslDistros();
  check(
    "listWslDistros: 平台可用且列表非空",
    listed.available && listed.distros.length > 0,
    listed.available
      ? listed.distros.map((d) => `${d.name}(${d.state},v${d.version}${d.isDefault ? ",default" : ""})`).join(", ")
      : listed.reason || "",
  );

  // 1) 准备发行版内项目目录（模拟用户已有项目目录；连接配置要求目录已存在，与 SSH/Docker 一致）
  const prep = await runWsl({ distro: DISTRO }, ["--exec", "sh", "-c", `mkdir -p '${ROOT}'`], {
    timeoutMs: 60_000,
  });
  if (prep.code !== 0) {
    console.error(`准备发行版目录失败: ${prep.stderr || prep.stdout}`);
    process.exit(2);
  }

  // 2) 连接（探测 + 注入 + 握手）
  const t0 = Date.now();
  const conn = await connectWslAgent(
    { kind: "wsl", distro: DISTRO, path: ROOT, perm: "workspace" },
    {
      latestVersionUrl: "", // 空 = 不做升级检测，走本地缓存（与其他链路未配置 latest 时一致）
      onLog: (l) => console.log(`   [log] ${l}`),
    },
  );
  check("connectWslAgent: 建立 stdio 连接", !!conn.rpc, `${Date.now() - t0}ms, agent v${conn.version}`);
  check("inspect: 平台信息", conn.target.os.toLowerCase() === "linux", `${conn.target.os}/${conn.target.arch} → ${conn.target.goArch}`);
  check("inspect: 默认用户与 $HOME", !!conn.target.user && conn.target.home.startsWith("/"), `${conn.target.user}@${conn.target.home}`);
  check("root 生效值", conn.rootPath === ROOT, conn.rootPath);

  const agent = new RemoteAgent(conn.rpc, { path: conn.rootPath, kind: "wsl" });

  try {
    // 3) 文件原语（RemoteAgent 包装层，工具实际调用面）
    await agent.writeFileRaw("sub/a.txt", "hello from wsl\nsecond line\n", "utf-8");
    const read = await agent.readFileRaw("sub/a.txt", "utf-8");
    check("writeFileRaw → readFileRaw 往返", read === "hello from wsl\nsecond line\n", JSON.stringify(read));

    const st = await agent.stat("sub/a.txt");
    check("stat", st.size === 27 && st.isFile === true, JSON.stringify({ size: st.size, isFile: st.isFile }));

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
    const exec = await agent.executeRaw("echo wsl-exec-ok && id -u", { timeoutMs: 15000 });
    check("executeRaw: 输出 + 退出码", String(exec.output).includes("wsl-exec-ok") && exec.exitCode === 0, JSON.stringify({ exitCode: exec.exitCode }));

    const execB64 = await agent.executeRaw("printf '\\xe4\\xb8\\xad\\xe6\\x96\\x87 \\xff\\xfe'", { timeoutMs: 15000, encoding: "utf-8" });
    check(
      "executeRaw(outputB64): 非 UTF-8 字节经 base64 还原",
      typeof execB64.output === "string" && execB64.output.includes("中文"),
      JSON.stringify(execB64.output),
    );

    // 6) 后台进程（超时转后台 → poll）
    const bg = await agent.executeRaw("sleep 3; echo bg-ok", { timeoutMs: 600 });
    check("executeRaw: 超时转后台", bg.kind === "backgrounded" && !!bg.processId, JSON.stringify({ kind: bg.kind, pid: bg.processId, log: bg.logFile }));
    const poll = await agent.pollRaw(bg.processId!, 8000);
    check("pollRaw: 后台完成", !!poll && poll.status === "completed", JSON.stringify(poll));

    // 7) 权限：workspace 模式拒绝 root 之外的写入（策略为路径判定，发行版默认用户为 root 时同样生效）
    let denied = false;
    try {
      await agent.writeFileRaw("/etc/should-fail.txt", "x", "utf-8");
    } catch (e: any) {
      denied = /permission denied/i.test(String(e?.message || e));
    }
    check("perm=workspace: root 外写入被拒", denied);

    // 8) 断线自动恢复：手动关闭连接后重新连接（等价空闲回收 / 发行版重启后的重建路径）
    conn.rpc.close();
    await new Promise((r) => setTimeout(r, 1200));
    const logs2: string[] = [];
    const conn2 = await connectWslAgent(
      { kind: "wsl", distro: DISTRO, path: ROOT, perm: "workspace" },
      { latestVersionUrl: "", onLog: (l) => logs2.push(l) },
    );
    const agent2 = new RemoteAgent(conn2.rpc, { path: conn2.rootPath, kind: "wsl" });
    const read2 = await agent2.readFileRaw("sub/b.txt", "utf-8");
    check("重连后文件仍可读（发行版内 agent 目录复用）", read2.includes("hello from wsl"));
    check(
      "重连复用已注入二进制（未重复注入）",
      logs2.some((l) => /already present/.test(l)),
      logs2.join(" | ").slice(0, 200),
    );
    conn2.rpc.close();
  } finally {
    conn.rpc.close();
  }

  // ── 9) 工具层全链路：WorkspaceToolRouter → RemoteAgentManager（会话绑定校验）→ wsl provider ──
  {
    const connection: RemoteConnection = {
      id: "conn-wsl-1",
      name: "wsl-ws",
      config: { kind: "wsl", distro: DISTRO, path: ROOT, perm: "workspace" },
    };
    const serviceStub: any = {
      getConnections: async () => [connection],
      getAgentDownloadUrl: async () => "",
      getAgentLatestVersionUrl: async () => "",
    };
    const manager = new RemoteAgentManager(serviceStub);
    const router = new WorkspaceToolRouter(manager);

    // 未绑定会话 → 拒绝（与其他链路同语义）
    let unboundRejected = false;
    try {
      await router.resolveRemoteTarget("wsl-ws", "sess-smoke", { "ssh-connection": [] });
    } catch (e: any) {
      unboundRejected = /not bound to this session|No remote or container connections bound/.test(
        String(e?.message || e),
      );
    }
    check("路由：未绑定会话的连接被拒", unboundRejected);

    const attachments = { "ssh-connection": ["conn-wsl-1"] };
    const target = await router.resolveRemoteTarget("wsl-ws", "sess-smoke", attachments);
    check("路由：解析出 wsl 目标", !!target && target.provider.scheme === "wsl", `scheme=${target?.provider.scheme} basePath=${target?.basePath}`);
    if (target) {
      await target.provider.writeFile("router.txt", "via-router\n");
      const back = String(await target.provider.readFile("router.txt", { encoding: "utf-8" }));
      check("provider：经路由器写入/读取发行版", back === "via-router\n", JSON.stringify(back));
      const exec = await target.provider.execute!("echo router-exec-ok", target.basePath, { timeout: 15000 });
      check(
        "provider：经路由器执行命令",
        String((exec as any).output).includes("router-exec-ok"),
        JSON.stringify({ kind: (exec as any).kind, exitCode: (exec as any).exitCode }),
      );
      const main = await router.resolveRemoteTarget("main", "sess-smoke", attachments);
      check("路由：main 返回 null（主工作目录）", main === null);
    }
    manager.dispose();
  }

  // ── 10) 无孤儿进程：全部连接关闭后，发行版内不应残留本次目标的 agent 进程 ──
  {
    await new Promise((r) => setTimeout(r, 1500));
    const scan = await runWsl(
      { distro: DISTRO },
      [
        "--exec",
        "sh",
        "-c",
        "for d in /proc/[0-9]*; do c=$(tr '\\0' ' ' < \"$d/cmdline\" 2>/dev/null); case \"$c\" in *guada-ag\"\"ent*--root*" +
          ROOT.replace(/'/g, "") +
          "*) echo \"${d#/proc/}: $c\";; esac; done",
      ],
      { timeoutMs: 30_000 },
    );
    const orphans = scan.stdout.trim().split("\n").filter(Boolean);
    check("连接关闭后无残留 agent 进程", orphans.length === 0, orphans.join(" | ").slice(0, 300) || "(none)");
  }

  // ── 11) 负例：不存在的发行版 / 不存在的工作目录 ──
  {
    let errText = "";
    try {
      await connectWslAgent(
        { kind: "wsl", distro: "guada-nonexistent-distro", path: "/tmp", perm: "workspace" },
        { latestVersionUrl: "" },
      );
    } catch (e: any) {
      errText = String(e?.message || e);
    }
    check(
      "负例：不存在的发行版 → 明确错误 + 安装指引",
      /无法连接 WSL 发行版/.test(errText) && /wsl -l -v|wsl --install/.test(errText),
      errText.split("\n")[0].slice(0, 160),
    );

    let errText2 = "";
    try {
      await connectWslAgent(
        { kind: "wsl", distro: DISTRO, path: MISSING_ROOT, perm: "workspace" },
        { latestVersionUrl: "" },
      );
    } catch (e: any) {
      errText2 = String(e?.message || e);
    }
    check(
      "负例：不存在的工作目录 → 明确错误 + 改选提示",
      /内工作目录不存在/.test(errText2) && /must pick|改选|连接配置/.test(errText2),
      errText2.split("\n")[0].slice(0, 200),
    );
  }

  // 清理：移除测试工作目录（注入的 agent 目录保留在发行版内，与 Docker 链路一致，下次连接直接复用）
  await runWsl({ distro: DISTRO }, ["--exec", "rm", "-rf", ROOT], { timeoutMs: 30_000 });

  console.log(`\n== 结果: ${passed} passed, ${failed} failed ==`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("冒烟脚本异常:", e?.stack || e);
  process.exit(2);
});
