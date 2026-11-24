import { EventEmitter } from "events";
import { createNdjsonSplitter, StderrTail, StreamRpcTransport } from "./rpc-stream-transport";

/**
 * stdio 类传输的共用件（容器 docker exec 子进程 与 SSH exec channel 共用）：
 * - createNdjsonSplitter：NDJSON 行分帧（跨 chunk 拼接、\r 容错、空行跳过、无行长上限）
 * - StderrTail：诊断用 stderr 尾部窗口
 */
describe("stdio 传输共用件", () => {
  describe("createNdjsonSplitter", () => {
    it("按 \\n 分帧；空行跳过", () => {
      const lines: string[] = [];
      const feed = createNdjsonSplitter((l) => lines.push(l));
      feed("a\nb\n\nc\n");
      expect(lines).toEqual(["a", "b", "c"]);
    });

    it("跨 chunk 的半行会缓冲拼接（含逐字节喂入）", () => {
      const lines: string[] = [];
      const feed = createNdjsonSplitter((l) => lines.push(l));
      feed('{"id":"r1","res');
      feed('ult":');
      feed("1}\n");
      feed('{"id":"r2"}\n');
      expect(lines).toEqual(['{"id":"r1","result":1}', '{"id":"r2"}']);
    });

    it("行尾 \\r 容错（防御性：两侧正常都是纯 \\n）", () => {
      const lines: string[] = [];
      const feed = createNdjsonSplitter((l) => lines.push(l));
      feed("x\r\ny\r\n");
      expect(lines).toEqual(["x", "y"]);
    });

    it("不设行长上限：单条 2MB 消息完整成帧", () => {
      const lines: string[] = [];
      const feed = createNdjsonSplitter((l) => lines.push(l));
      const big = `{"data":"${"a".repeat(2 * 1024 * 1024)}"}`;
      // 分多块喂入，模拟 TCP/管道分片
      for (let i = 0; i < big.length; i += 64 * 1024) {
        feed(big.slice(i, i + 64 * 1024));
      }
      feed("\n");
      expect(lines).toHaveLength(1);
      expect(lines[0].length).toBe(big.length);
    });

    it("末尾未闭合的半行不产出（等后续数据或连接关闭）", () => {
      const lines: string[] = [];
      const feed = createNdjsonSplitter((l) => lines.push(l));
      feed('{"id":"partial"');
      expect(lines).toEqual([]);
    });
  });

  describe("StderrTail", () => {
    it("累积输出并在超限时只保留尾部", () => {
      const tail = new StderrTail();
      tail.append("start-");
      tail.append("end");
      expect(tail.get()).toBe("start-end");

      tail.append("x".repeat(20 * 1024));
      const kept = tail.get();
      expect(kept.length).toBeLessThanOrEqual(8 * 1024);
      expect(kept.endsWith("x")).toBe(true);
    });

    it("无输出时为空串（错误文案拼接时不应出现空白提示）", () => {
      expect(new StderrTail().get()).toBe("");
    });
  });
});

/**
 * 传输流 'error' 监听（回归：大文件传输中途 agent 被 kill / 管道断开时，
 * child.stdin 的 EPIPE 无人监听 → uncaughtException → 整个后端进程退出）。
 */
describe("StreamRpcTransport 错误处理", () => {
  function fakeChild() {
    const child: any = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), {
      writable: true,
      destroyed: false,
      write: (_data: string, cb?: (err?: Error) => void) => {
        cb?.();
        return true;
      },
      end: () => {},
    });
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.exitCode = null;
    child.killed = false;
    child.kill = () => {};
    return child;
  }

  it("stdin 的 'error'（EPIPE）不抛出，转成传输关闭通知", () => {
    const child = fakeChild();
    const transport = new StreamRpcTransport(child, "fake-agent");
    const onClose = jest.fn();
    transport.onClose(onClose);

    expect(() => child.stdin.emit("error", new Error("EPIPE"))).not.toThrow();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(transport.isOpen()).toBe(false);
  });

  it("关闭后 send 以回调错误返回（调用方拿到可处理的失败）", () => {
    const child = fakeChild();
    const transport = new StreamRpcTransport(child, "fake-agent");
    child.stdin.emit("error", new Error("EPIPE"));

    const cb = jest.fn();
    transport.send("{}", cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(String(cb.mock.calls[0][0]?.message)).toContain("closed");
  });

  it("重复 'error'/'close' 只通知一次", () => {
    const child = fakeChild();
    const transport = new StreamRpcTransport(child, "fake-agent");
    const onClose = jest.fn();
    transport.onClose(onClose);

    child.stdin.emit("error", new Error("EPIPE"));
    child.emit("close", 1, null);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
