/**
 * SSH 传输形态对比：端口转发 + WebSocket（现有生产链路） vs ssh exec + agent --stdio
 *
 * 目的：回答"两者性能是否有区别、stdio 能否提升环境兼容性"——
 * 两条路径建立在**同一条 SSH 连接语义**之上（同一台 sshd、同一个 agent 二进制、同一组 RPC），
 * 唯一变量是传输形态：
 *   A) 生产链路：SFTP 上传 → nohup 启动 `agent --port 0` → SSH 端口转发 → 本地 ws://127.0.0.1:<port>/ws
 *   B) stdio：ssh exec `agent --stdio` → NDJSON over SSH exec channel（无端口、无 token、无 nohup）
 *
 * 用法: npx ts-node --transpile-only src/scripts/ssh-stdio-vs-forward-bench.ts [port] [root]
 * 前置: 已有一个可从本机 ssh 登录的 sshd（bench 用的容器见 docs/docker容器工作区方案.md 同款做法）
 */
import { Client as SshClient } from "ssh2";
import WebSocket from "ws";
import { deployAgent } from "../modules/remote-workspace/agent-deploy";
import { RpcClient, WsRpcTransport, type RpcTransport } from "../modules/remote-workspace/rpc";

const PORT = parseInt(process.argv[2] || "2222", 10);
const ROOT = process.argv[3] || "/tmp/bench-ws";
const HOST = "127.0.0.1";
const USER = "root";
const PASSWORD = "benchpw";
/** agent 安装位置：SSH 链路装在 $HOME/.guada-agent（与容器链路的 /tmp/.guada-agent 不同），运行时探测 */
let AGENT_BIN = "/root/.guada-agent/guada-agent";

const SSH_CFG = { host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 15000 };

// ── 时延/吞吐采样 ──
class Stats {
  private samples: number[] = [];
  add(ms: number): void {
    this.samples.push(ms);
  }
  get n(): number {
    return this.samples.length;
  }
  quantile(q: number): number {
    if (!this.samples.length) return 0;
    const s = [...this.samples].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  }
  get mean(): number {
    return this.samples.length ? this.samples.reduce((a, b) => a + b, 0) / this.samples.length : 0;
  }
  fmt(): string {
    return `p50=${this.quantile(0.5).toFixed(2)}ms p95=${this.quantile(0.95).toFixed(2)}ms mean=${this.mean.toFixed(2)}ms`;
  }
}

function hr(): bigint {
  return process.hrtime.bigint();
}
function ms(a: bigint, b: bigint): number {
  return Number(b - a) / 1e6;
}

/** 经 SSH exec channel 的 NDJSON 传输（与 rpc-stream-transport.ts 同构；若未来 SSH 也改 stdio，即此实现） */
class SshStdioTransport implements RpcTransport {
  readonly label = "ssh stdio";
  private msgHandlers: Array<(raw: string) => void> = [];
  private closeHandlers: Array<() => void> = [];
  private buf = "";
  private stderrTail = "";
  private closed = false;

  constructor(
    private readonly channel: any,
    private readonly client: SshClient,
  ) {
    channel.on("data", (d: Buffer) => this.onData(d));
    // stderr 不属于协议通道：保留尾部供诊断（命令不存在、权限问题等都会在这里出现）
    channel.stderr.on("data", (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString("utf-8")).slice(-2000);
    });
    channel.on("close", () => this.notifyClose());
    client.on("close", () => this.notifyClose());
  }

  static async open(cmd: string): Promise<SshStdioTransport> {
    const client = new SshClient();
    await new Promise<void>((resolve, reject) => {
      client.once("ready", () => resolve());
      client.once("error", reject);
      client.connect(SSH_CFG);
    });
    const channel: any = await new Promise((resolve, reject) => {
      // 注意：不得请求 pty（会做 CRLF 转换并缓冲，破坏协议）
      client.exec(cmd, (err: any, ch: any) => (err ? reject(err) : resolve(ch)));
    });
    return new SshStdioTransport(channel, client);
  }

  getStderrTail(): string {
    return this.stderrTail.trim();
  }

  private notifyClose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.stderrTail.trim()) {
      console.error(`  [diagnostic] channel stderr: ${this.stderrTail.trim().slice(0, 500)}`);
    }
    for (const h of this.closeHandlers) h();
  }

  private onData(d: Buffer): void {
    this.buf += d.toString("utf-8");
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, "");
      this.buf = this.buf.slice(i + 1);
      if (line) for (const h of this.msgHandlers) h(line);
    }
  }

  send(data: string, cb?: (err?: Error) => void): void {
    if (!this.isOpen()) return cb?.(new Error("ssh stdio closed"));
    try {
      this.channel.write(data + "\n", (err?: Error) => cb?.(err ?? undefined));
    } catch (e: any) {
      cb?.(e);
    }
  }

  close(): void {
    try {
      this.channel.end();
    } catch {}
    try {
      this.client.end();
    } catch {}
    this.notifyClose();
  }

  onMessage(h: (raw: string) => void): void {
    this.msgHandlers.push(h);
  }
  onClose(h: () => void): void {
    this.closeHandlers.push(h);
  }
  isOpen(): boolean {
    return !this.closed;
  }
}

/** 同一套电池（两条链路共用，保证可比） */
async function battery(label: string, rpc: RpcClient, bigPath: string, bigBytes: number): Promise<void> {
  // 预热
  for (let i = 0; i < 30; i++) await rpc.call("ping");

  // 1) 小 RPC 往返时延
  const lat = new Stats();
  for (let i = 0; i < 300; i++) {
    const t0 = hr();
    await rpc.call("stat", { path: `${ROOT}/small.txt` });
    lat.add(ms(t0, hr()));
  }
  console.log(`  [${label}] 小 RPC(stat) ×300: ${lat.fmt()}`);

  // 2) 读吞吐（readFile → base64）
  const readMbs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = hr();
    const r = await rpc.call<{ data: string }>("readFile", { path: bigPath }, undefined, 120000);
    const dt = ms(t0, hr()) / 1000;
    const bytes = Buffer.from(r.data, "base64").length;
    readMbs.push(bytes / dt / (1024 * 1024));
  }
  console.log(
    `  [${label}] 读 ${(bigBytes / 1048576).toFixed(0)}MB ×3: ${readMbs.map((v) => v.toFixed(1) + "MB/s").join(", ")}`,
  );

  // 3) 写吞吐（uploadStart + 1MB 分块 + uploadEnd）
  const CHUNK = 1024 * 1024;
  const payload = Buffer.alloc(CHUNK, 7);
  const writeMbs: number[] = [];
  for (let round = 0; round < 3; round++) {
    const t0 = hr();
    const up = await rpc.call<{ uploadId: string }>(
      "uploadStart",
      { remotePath: `${ROOT}/write-bench.bin`, totalBytes: bigBytes },
      undefined,
      60000,
    );
    const chunks = Math.ceil(bigBytes / CHUNK);
    for (let c = 0; c < chunks; c++) {
      await rpc.call("uploadChunk", { uploadId: up.uploadId, data: payload.toString("base64") }, undefined, 60000);
    }
    await rpc.call("uploadEnd", { uploadId: up.uploadId }, undefined, 60000);
    const dt = ms(t0, hr()) / 1000;
    writeMbs.push(bigBytes / dt / (1024 * 1024));
  }
  console.log(
    `  [${label}] 写 ${(bigBytes / 1048576).toFixed(0)}MB ×3: ${writeMbs.map((v) => v.toFixed(1) + "MB/s").join(", ")}`,
  );

  // 4) 分块读吞吐（readFileRange 1MB ×N）——工具层与 remote_transfer 的真实读法
  const chunkReadMbs: number[] = [];
  for (let round = 0; round < 3; round++) {
    const t0 = hr();
    let total = 0;
    for (let off = 0; off < bigBytes; off += 1024 * 1024) {
      const r = await rpc.call<{ data: string }>(
        "readFileRange",
        { path: bigPath, offset: off, length: 1024 * 1024 },
        undefined,
        60000,
      );
      total += Buffer.from(r.data, "base64").length;
    }
    chunkReadMbs.push(total / (ms(t0, hr()) / 1000) / 1048576);
  }
  console.log(
    `  [${label}] 分块读 1MB×${Math.ceil(bigBytes / 1048576)} ×3: ${chunkReadMbs.map((v) => v.toFixed(1) + "MB/s").join(", ")}`,
  );
}

async function execSsh(cmd: string): Promise<string> {
  const client = new SshClient();
  await new Promise<void>((resolve, reject) => {
    client.once("ready", () => resolve());
    client.once("error", reject);
    client.connect(SSH_CFG);
  });
  const out = await new Promise<string>((resolve) => {
    let acc = "";
    client.exec(cmd, (err: any, stream: any) => {
      if (err) return resolve("");
      stream.on("data", (d: Buffer) => (acc += d.toString()));
      stream.on("close", () => resolve(acc));
    });
  });
  client.end();
  return out;
}

async function main(): Promise<void> {
  console.log(`== SSH 传输对比: ${USER}@${HOST}:${PORT} root=${ROOT} ==\n`);

  // 准备：工作目录 + 5MB 文件 + 小文件
  await execSsh(`mkdir -p ${ROOT}/.guada-agent && rm -f ${ROOT}/small.txt ${ROOT}/big.bin && echo bench > ${ROOT}/small.txt && dd if=/dev/zero of=${ROOT}/big.bin bs=1M count=5 2>/dev/null && ls -l ${ROOT}`);
  const BIG_BYTES = 5 * 1024 * 1024;

  // ── A) 现有生产链路：SFTP 上传 + nohup + 端口转发 + WS ──
  console.log("[A] 端口转发 + WebSocket（生产链路）");
  const uriA = {
    scheme: "ssh",
    host: HOST,
    port: PORT,
    username: USER,
    password: PASSWORD,
    path: ROOT,
    query: {} as Record<string, string>,
  };
  let t0 = hr();
  const connInfo = await deployAgent(uriA as any, "", "");
  const deployMs = ms(t0, hr());
  t0 = hr();
  const ws = new WebSocket(connInfo.wsUrl, {
    headers: connInfo.token ? { Authorization: `Bearer ${connInfo.token}` } : undefined,
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpcA = new RpcClient(new WsRpcTransport(ws));
  rpcA.setConnected();
  await rpcA.call("ping");
  const handshakeMs = ms(t0, hr());
  console.log(`  [A] 连接建立: deploy+forward=${deployMs.toFixed(0)}ms, ws+ping=${handshakeMs.toFixed(0)}ms`);
  await battery("A 端口转发", rpcA, `${ROOT}/big.bin`, BIG_BYTES);
  rpcA.close();

  // 探测 agent 实际安装位置（SSH 链路在 $HOME/.guada-agent；容器链路在 /tmp/.guada-agent）
  const detected = (
    await execSsh(
      `for p in "$HOME/.guada-agent/guada-agent" /tmp/.guada-agent/guada-agent /var/tmp/.guada-agent/guada-agent; do [ -x "$p" ] && echo "$p" && break; done`,
    )
  ).trim().split("\n")[0];
  if (detected) AGENT_BIN = detected;
  console.log(`  [A] 远端 agent 位置: ${AGENT_BIN}`);

  // ── B) ssh exec + agent --stdio ──
  console.log("\n[B] ssh exec + --stdio（NDJSON over SSH channel）");
  t0 = hr();
  const transportB = await SshStdioTransport.open(
    `${AGENT_BIN} --stdio --root ${ROOT} --perm workspace`,
  );
  const rpcB = new RpcClient(transportB);
  rpcB.setConnected();
  await rpcB.call("ping");
  console.log(`  [B] 连接建立: exec+ping=${ms(t0, hr()).toFixed(0)}ms（二进制已在上一步由 A 部署）`);
  await battery("B stdio", rpcB, `${ROOT}/big.bin`, BIG_BYTES);
  rpcB.close();

  // ── 二次连接（二进制已就位，衡量稳态连接成本） ──
  console.log("\n[稳态连接成本]");
  t0 = hr();
  const connInfo2 = await deployAgent(uriA as any, "", "");
  const deploy2 = ms(t0, hr());
  const ws2 = new WebSocket(connInfo2.wsUrl, {
    headers: connInfo2.token ? { Authorization: `Bearer ${connInfo2.token}` } : undefined,
  });
  await new Promise<void>((r) => ws2.once("open", () => r()));
  const rpcA2 = new RpcClient(new WsRpcTransport(ws2));
  rpcA2.setConnected();
  await rpcA2.call("ping");
  const totalA2 = ms(t0, hr());
  rpcA2.close();
  console.log(`  [A] 重连（二进制已在远端）: ${deploy2.toFixed(0)}ms 部署 + ${(totalA2 - deploy2).toFixed(0)}ms ws+握手 = ${totalA2.toFixed(0)}ms`);

  t0 = hr();
  const transportB2 = await SshStdioTransport.open(`${AGENT_BIN} --stdio --root ${ROOT} --perm workspace`);
  const rpcB2 = new RpcClient(transportB2);
  rpcB2.setConnected();
  await rpcB2.call("ping");
  console.log(`  [B] 重连: exec+握手 = ${ms(t0, hr()).toFixed(0)}ms`);
  rpcB2.close();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("bench 失败:", e?.stack || e);
    process.exit(1);
  });
