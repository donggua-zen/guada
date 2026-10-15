/**
 * SSH 工作区连接编排：供给（部署/版本确认）→ 按远端 agent 版本选择传输 → 建立 RpcClient。
 *
 * 传输选择（agent-version.selectSshAgentTransport）：
 * - **stdio**（agent ≥ 0.6.0，默认）：`client.exec('<bin> --stdio --root …')` 长驻通道 + NDJSON。
 *   不需要 sshd 允许端口转发，远端不监听任何端口（实测 Alpine 的 openssh 默认
 *   `AllowTcpForwarding no`，旧链路会直接失败）；
 * - **ws-forward**（agent < 0.6.0 回退）：nohup 启动 `--port 0` + SSH 端口转发 + WebSocket，
 *   保持老环境可用，不做强制升级。
 *
 * 两条分支对上层完全一致：返回同一个 `RpcClient` 语义（请求匹配/心跳/超时/断连恢复）。
 * 本连接专用的 ssh2 Client 由 disposer 统一回收。
 */
import WebSocket from "ws";
import { Client } from "ssh2";
import type { ParsedWorkspaceUri } from "../../common/workspace/workspace-provider.interface";
import { RpcClient, WsRpcTransport } from "./rpc";
import { SshStdioTransport } from "./ssh-stdio-transport";
import { provisionRemoteAgent, startLegacyWsAgent } from "./agent-deploy";
import { selectSshAgentTransport, type SshAgentTransportKind } from "./agent-version";

/** 握手超时（部署已完成，仅确认通道可用；超时视为链路异常） */
const HANDSHAKE_TIMEOUT_MS = 20_000;

export interface SshAgentConnection {
  rpc: RpcClient;
  /** 实际选用的传输方式（日志与诊断用） */
  kind: SshAgentTransportKind;
  /** 远端 agent 版本 */
  version: string;
  /** 传输是否仍可用（上层缓存判定/reap 用） */
  isOpen: () => boolean;
  /** 释放资源：关闭传输 + 本条连接专用的 SSH client（不触碰远端安装目录） */
  dispose: () => void;
  sshClient: Client;
  log: string[];
}

export async function connectSshAgent(
  uri: ParsedWorkspaceUri,
  opts: {
    downloadUrl?: string;
    latestVersionUrl?: string;
    onLog?: (line: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<SshAgentConnection> {
  const provision = await provisionRemoteAgent(uri, opts.downloadUrl, opts.latestVersionUrl, {
    onLog: opts.onLog,
    signal: opts.signal,
  });
  const kind = selectSshAgentTransport(provision.version);
  opts.onLog?.(
    kind === "stdio"
      ? `Agent v${provision.version} supports stdio; connecting without port forwarding`
      : `Agent v${provision.version} predates stdio support; falling back to port forwarding + WebSocket`,
  );

  if (kind === "stdio") {
    const transport = await SshStdioTransport.openAgent(provision.sshClient, {
      binaryPath: provision.remoteBinary,
      rootPath: uri.path,
      perm: uri.query?.perm,
    });
    const rpc = new RpcClient(transport);
    rpc.setConnected();
    try {
      const ping = await rpc.call<{ pong: string; version?: string }>(
        "ping",
        undefined,
        opts.signal,
        HANDSHAKE_TIMEOUT_MS,
      );
      if (!ping?.pong) throw new Error("agent ping 未返回预期响应");
      opts.onLog?.(`Agent connected over SSH stdio (v${ping.version || provision.version})`);
    } catch (err: any) {
      transport.close();
      const tail = transport.getStderrTail();
      throw new Error(
        `agent 握手失败(ssh stdio)：${err?.message || err}` +
          (tail ? `\nAgent output:\n${tail.slice(-600)}` : ""),
      );
    }
    return {
      rpc,
      kind,
      version: provision.version,
      sshClient: provision.sshClient,
      isOpen: () => transport.isOpen(),
      dispose: () => {
        try {
          rpc.close();
        } catch {}
      },
      log: provision.log,
    };
  }

  // ── 旧版回退：端口转发 + WebSocket（要求 sshd 允许 AllowTcpForwarding）──
  const connInfo = await startLegacyWsAgent(provision, uri);
  const ws = new WebSocket(connInfo.wsUrl, {
    headers: connInfo.token ? { Authorization: `Bearer ${connInfo.token}` } : undefined,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (err) => reject(err));
    });
    const rpc = new RpcClient(new WsRpcTransport(ws));
    rpc.setConnected();
    const ping = await rpc.call<{ pong: string }>("ping", undefined, opts.signal, HANDSHAKE_TIMEOUT_MS);
    if (!ping?.pong) throw new Error("agent ping 未返回预期响应");
    opts.onLog?.(`Agent connected over WebSocket forward (v${provision.version})`);
    return {
      rpc,
      kind,
      version: provision.version,
      sshClient: provision.sshClient,
      isOpen: () => ws.readyState === WebSocket.OPEN,
      dispose: () => {
        try {
          ws.close();
        } catch {}
        try {
          provision.sshClient.end();
        } catch {}
      },
      log: provision.log,
    };
  } catch (err: any) {
    try {
      ws.close();
    } catch {}
    try {
      provision.sshClient.end();
    } catch {}
    throw new Error(`agent 握手失败(ws forward)：${err?.message || err}`);
  }
}
