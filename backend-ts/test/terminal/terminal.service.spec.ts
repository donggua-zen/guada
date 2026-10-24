/**
 * TerminalService —— 此前零测试。
 *
 * 这是「绕过策略层直接 spawn 进程」的执行层入口，注册表生命周期（orphan 回收、
 * 上限、归属校验）值得盯住。
 *
 * 手法：用测试子类替换 loadNodePty()，用 FakePty 替身，从而完全不触发 node-pty
 * 原生模块；pty-helper 被 mock 掉，使 ensureSpawnHelperExecutable 可编程（也让
 * 用例在 Windows/Linux/macOS 上行为一致）。
 */
import { Logger } from "@nestjs/common";
import { TerminalService } from "../../src/modules/terminal/terminal.service";
import { PtyHelperError, ensureSpawnHelperExecutable } from "../../src/modules/terminal/pty-helper";

jest.mock("../../src/modules/terminal/pty-helper", () => {
  const actual = jest.requireActual("../../src/modules/terminal/pty-helper");
  return { ...actual, ensureSpawnHelperExecutable: jest.fn() };
});

const mockedEnsureSpawnHelper = ensureSpawnHelperExecutable as jest.MockedFunction<
  typeof ensureSpawnHelperExecutable
>;

/** 最小 IPty 替身，记录写入/缩放/kill，并允许主动触发 data/exit */
class FakePty {
  readonly written: string[] = [];
  readonly resized: Array<{ cols: number; rows: number }> = [];
  killed = false;
  private dataHandlers: Array<(d: string) => void> = [];
  private exitHandlers: Array<(e: { exitCode: number }) => void> = [];

  onData(cb: (d: string) => void): void {
    this.dataHandlers.push(cb);
  }
  onExit(cb: (e: { exitCode: number }) => void): void {
    this.exitHandlers.push(cb);
  }
  write(data: string): void {
    this.written.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resized.push({ cols, rows });
  }
  kill(): void {
    this.killed = true;
  }
  emitData(data: string): void {
    for (const h of this.dataHandlers) h(data);
  }
  emitExit(exitCode: number): void {
    for (const h of this.exitHandlers) h({ exitCode });
  }
}

interface SpawnRecord {
  file: string;
  args: string[];
  opts: any;
  pty: FakePty;
}

class TestTerminalService extends TerminalService {
  readonly spawns: SpawnRecord[] = [];
  /** 设为非 undefined 时，loadNodePty 将抛出该错误 */
  loadError?: Error;

  protected loadNodePty(): any {
    if (this.loadError) throw this.loadError;
    return {
      spawn: (file: string, args: string[], opts: any) => {
        const pty = new FakePty();
        this.spawns.push({ file, args, opts, pty });
        return pty;
      },
    };
  }
}

function makeConfig(terminalShell?: string): any {
  return {
    get: (key: string) => (key === "TERMINAL_SHELL" ? terminalShell : undefined),
  };
}

function makeService(terminalShell?: string): TestTerminalService {
  return new TestTerminalService(makeConfig(terminalShell));
}

describe("TerminalService", () => {
  let service: TestTerminalService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    mockedEnsureSpawnHelper.mockReset();
    service = makeService();
  });

  afterEach(() => {
    // 清掉注册表与 orphan 定时器，避免用例间串味
    try {
      service.onModuleDestroy();
    } catch {
      /* ignore */
    }
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("createUiTerminal", () => {
    it("每个会话最多 3 个 UI 终端，第 4 个抛错", () => {
      service.createUiTerminal("s1", "D:/ws");
      service.createUiTerminal("s1", "D:/ws");
      service.createUiTerminal("s1", "D:/ws");

      expect(() => service.createUiTerminal("s1", "D:/ws")).toThrow(/Terminal limit reached \(3\)/);
      expect(service.list("s1")).toHaveLength(3);
    });

    it("上限按会话隔离，s2 不受 s1 已满影响", () => {
      for (let i = 0; i < 3; i++) service.createUiTerminal("s1", "D:/ws");

      expect(() => service.createUiTerminal("s2", "D:/ws")).not.toThrow();
      expect(service.list("s2")).toHaveLength(1);
    });

    it("终端 id 形如 sessionId:uuid8 且带 sessionId 归属", () => {
      const handle = service.createUiTerminal("sess-1", "D:/ws");

      expect(handle.id).toMatch(/^sess-1:[0-9a-f]{8}$/);
      expect(handle.sessionId).toBe("sess-1");
      expect(handle.cwd).toBe("D:/ws");
      expect(handle.exited).toBe(false);
      expect(handle.disconnectedAt).toBeUndefined();
    });

    it("把 cols/rows/cwd 透传给 PTY，并强制注入 TERM 与 useConpty", () => {
      service.createUiTerminal("s1", "D:/proj", 120, 30);

      const { opts } = service.spawns[0];
      expect(opts).toMatchObject({ name: "xterm-256color", cols: 120, rows: 30, cwd: "D:/proj", useConpty: true });
      expect(opts.env.TERM).toBe("xterm-256color");
    });
  });

  describe("createAgentTerminal", () => {
    it("不受 UI 终端上限约束（agent 终端走独立 id）", () => {
      for (let i = 0; i < 3; i++) service.createUiTerminal("s1", "D:/ws");

      expect(() => service.createAgentTerminal("s1", "D:/ws")).not.toThrow();
      expect(service.list("s1")).toHaveLength(4);
    });

    it("传入 command 时写入命令并回车", () => {
      const handle = service.createAgentTerminal("s1", "D:/ws", "npm test");

      expect(handle.pty.write).toBeDefined();
      expect(service.spawns[0].pty.written).toEqual(["npm test\r"]);
    });

    it("未传 command 时不写入任何内容", () => {
      service.createAgentTerminal("s1", "D:/ws");

      expect(service.spawns[0].pty.written).toEqual([]);
    });
  });

  describe("defaultShell", () => {
    it("配置了 TERMINAL_SHELL 时优先使用它，且不带参数", () => {
      service = makeService("/custom/shell");
      service.createUiTerminal("s1", "D:/ws");

      expect(service.spawns[0].file).toBe("/custom/shell");
      expect(service.spawns[0].args).toEqual([]);
    });

    it("未配置时能解析出一个非空 shell 可执行文件", () => {
      service.createUiTerminal("s1", "D:/ws");

      expect(typeof service.spawns[0].file).toBe("string");
      expect(service.spawns[0].file.length).toBeGreaterThan(0);
      expect(Array.isArray(service.spawns[0].args)).toBe(true);
    });
  });

  describe("get / list / disposeForSession", () => {
    it("get 不存在的 id 抛错", () => {
      expect(() => service.get("nope")).toThrow(/Terminal nope not found/);
    });

    it("disposeForSession 归属不匹配时抛错且不销毁", () => {
      const handle = service.createUiTerminal("owner", "D:/ws");

      expect(() => service.disposeForSession(handle.id, "intruder")).toThrow(
        /Terminal does not belong to session/,
      );
      expect(service.list("owner")).toHaveLength(1);
      expect(service.spawns[0].pty.killed).toBe(false);
    });

    it("disposeForSession 归属匹配时销毁 PTY", () => {
      const handle = service.createUiTerminal("owner", "D:/ws");

      service.disposeForSession(handle.id, "owner");

      expect(service.list("owner")).toHaveLength(0);
      expect(service.spawns[0].pty.killed).toBe(true);
    });

    it("dispose 对不存在的 id 幂等返回（不抛错）", () => {
      expect(() => service.dispose("ghost")).not.toThrow();
    });

    it("list 只返回该会话的终端", () => {
      service.createUiTerminal("s1", "D:/ws");
      service.createUiTerminal("s2", "D:/ws");
      service.createUiTerminal("s1", "D:/ws");

      expect(service.list("s1")).toHaveLength(2);
      expect(service.list("s2")).toHaveLength(1);
      expect(service.list("s3")).toEqual([]);
    });
  });

  describe("orphan 生命周期", () => {
    it("markDisconnected 只打标记，不杀 PTY，终端仍在册", () => {
      const handle = service.createUiTerminal("s1", "D:/ws");

      service.markDisconnected(handle.id);

      expect(service.list("s1")).toHaveLength(1);
      expect(service.get(handle.id).disconnectedAt).toBeDefined();
      expect(service.spawns[0].pty.killed).toBe(false);
    });

    it("markDisconnected 对不存在的 id 静默忽略", () => {
      expect(() => service.markDisconnected("ghost")).not.toThrow();
    });

    it("orphan 未满 5 分钟不被回收，超过后由定时器回收", () => {
      jest.useFakeTimers();
      service = makeService();
      const handle = service.createUiTerminal("s1", "D:/ws");
      service.markDisconnected(handle.id);

      // 4 分钟：仍在
      jest.advanceTimersByTime(4 * 60 * 1000);
      expect(service.list("s1")).toHaveLength(1);
      expect(service.spawns[0].pty.killed).toBe(false);

      // 累计 6 分钟：被回收
      jest.advanceTimersByTime(2 * 60 * 1000);
      expect(service.list("s1")).toHaveLength(0);
      expect(service.spawns[0].pty.killed).toBe(true);
    });

    it("未断连的终端不会被 orphan 回收", () => {
      jest.useFakeTimers();
      service = makeService();
      service.createUiTerminal("s1", "D:/ws");

      jest.advanceTimersByTime(30 * 60 * 1000);

      expect(service.list("s1")).toHaveLength(1);
      expect(service.spawns[0].pty.killed).toBe(false);
    });
  });

  describe("PTY 事件", () => {
    it("累积 transcript 并在超过 1MB 时只保留尾部", () => {
      const handle = service.createUiTerminal("s1", "D:/ws");
      const pty = service.spawns[0].pty;

      pty.emitData("A".repeat(600_000));
      pty.emitData("B".repeat(600_000));

      expect(handle.transcript.length).toBe(1 << 20);
      expect(handle.transcript.endsWith("B")).toBe(true);
      expect(handle.transcript.startsWith("A")).toBe(true);
    });

    it("pty.onExit 记录 exitCode 与 exited", () => {
      const handle = service.createUiTerminal("s1", "D:/ws");

      service.spawns[0].pty.emitExit(137);

      expect(handle.exited).toBe(true);
      expect(handle.exitCode).toBe(137);
    });
  });

  describe("spawn 失败路径", () => {
    it("node-pty 不可用 → 包装为可读错误", () => {
      service.loadError = new Error("node-pty is not available: cannot find module");

      expect(() => service.createUiTerminal("s1", "D:/ws")).toThrow(/Terminal spawn failed/);
      expect(service.list("s1")).toEqual([]);
    });

    it("PtyHelperError 原样透传（保留 fixHint 供前端横幅展示）", () => {
      mockedEnsureSpawnHelper.mockImplementation(() => {
        throw new PtyHelperError("spawn-helper 不可执行", 'chmod +x "/path/helper"');
      });

      let caught: any;
      try {
        service.createUiTerminal("s1", "D:/ws");
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(PtyHelperError);
      expect(caught.fixHint).toBe('chmod +x "/path/helper"');
    });
  });

  describe("onModuleDestroy", () => {
    it("销毁所有登记终端并停止 orphan 定时器", () => {
      jest.useFakeTimers();
      service = makeService();
      const a = service.createUiTerminal("s1", "D:/ws");
      const b = service.createUiTerminal("s2", "D:/ws");

      service.onModuleDestroy();

      expect(service.spawns.every((s) => s.pty.killed)).toBe(true);
      expect(service.list("s1")).toEqual([]);
      expect(service.list("s2")).toEqual([]);
      expect(a.id).toBeTruthy();
      expect(b.id).toBeTruthy();
    });
    it("onApplicationShutdown 同样销毁所有登记终端", () => {
      jest.useFakeTimers();
      service = makeService();
      service.createUiTerminal("s1", "D:/ws");

      service.onApplicationShutdown();

      expect(service.spawns.every((s) => s.pty.killed)).toBe(true);
      expect(service.list("s1")).toEqual([]);
    });
  });
});
