/**
 * agent 版本门禁 — 容器与 SSH(stdio) 两条链路共用的版本判定。
 *
 * 背景：0.6.0 起 agent 提供 `--stdio` 传输。传输选择与部署策略都依赖"远端版本是否
 * 满足下限"，且**绝不能把远端降级到低于下限的版本**（实测：旧版 agent 收到 --stdio
 * 会打印 flag usage 后静默退出，握手失败；线上 latest 未更新时按"跟随 latest"会把
 * 0.6+ 的远端降级回旧版）。因此下限判定集中在本模块。
 */

/** stdio 传输所需的最低 agent 版本（容器工作区与 SSH stdio 共用同一门槛） */
export const MIN_STDIO_AGENT_VERSION = "0.6.0";

/** 远程后台 Job（process_done / readProcess / killAllProcesses）所需的最低版本 */
export const MIN_REMOTE_JOB_AGENT_VERSION = "0.7.0";

/** 比较点分版本号：a >= b 返回 true（仅数字段，位数不同按 0 补齐；空/非法按 0） */
export function versionAtLeast(a: string, b: string): boolean {
  const pa = String(a || "").trim().split(".").map((s) => parseInt(s, 10) || 0);
  const pb = String(b || "").trim().split(".").map((s) => parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return true;
}

/** 远端 agent 支持的连接方式 */
export type SshAgentTransportKind = "stdio" | "ws-forward";

/**
 * 按远端 agent 版本选择 SSH 链路的传输方式：
 * - ≥ 0.6.0（或版本号未知但调用方已确认可用性）→ stdio（无需端口转发，兼容硬化 sshd）；
 * - 低于 0.6.0 → 端口转发 + WebSocket（旧版回退，保证老环境不被破坏）。
 *
 * 注意：`remoteVersion` 为空（未安装且未上传成功）应视为不可用，由调用方先报错。
 */
export function selectSshAgentTransport(remoteVersion: string): SshAgentTransportKind {
  return versionAtLeast(remoteVersion, MIN_STDIO_AGENT_VERSION) ? "stdio" : "ws-forward";
}
