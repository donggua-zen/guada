/**
 * MemorySyncService 影子轮次（压缩前记忆维护）。
 *
 * 契约：
 * - 仅 summaryMode=MEMORY_SYNC 执行（其它模式零 LLM 调用）
 * - 执行期间工具范围锁到 file 插件 + 路径牢笼锁到记忆目录，退出时两者原样恢复
 * - 记忆不再有专用工具：指令要求 AI 用文件工具维护 MEMORY.md 索引与明细文件
 * - fail-open：任何失败都不阻断压缩
 */
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { MemorySyncService } from "../../src/modules/chat/memory-sync.service";
import { SummaryMode } from "../../src/modules/chat/compaction/compression-engine";
import { HOOKS } from "../../src/modules/chat/types/hooks.contract";
import { resolveMemoryDir } from "../../src/common/utils/memory-path.util";

describe("MemorySyncService", () => {
  let service: MemorySyncService;
  let llm: { completions: jest.Mock };
  let executor: { executeBatch: jest.Mock };
  let tmpDir: string;
  let scope: string | null;
  let jail: string | null;
  let sessionCtx: any;

  const expectedMemoryDir = () =>
    resolveMemoryDir({ workspacePath: tmpDir, sessionId: "s1", sessionType: "web" });

  function textChunks(text: string) {
    return [{ type: "text_delta", index: 0, text }];
  }

  function toolCallChunks(name: string, args: Record<string, unknown>) {
    return [
      {
        type: "block_end",
        index: 0,
        block: {
          type: "tool-call",
          toolCallId: "t1",
          name,
          arguments: JSON.stringify(args),
        },
      },
    ];
  }

  /** completions 每次调用返回一个新生成器（按 rounds 顺序供应 chunk 序列） */
  function mockRounds(rounds: any[][]) {
    let round = 0;
    llm.completions.mockImplementation(async () => {
      const chunks = rounds[Math.min(round, rounds.length - 1)];
      round++;
      return (async function* () {
        for (const chunk of chunks) yield chunk;
      })();
    });
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-sync-test-"));
    scope = null;
    jail = null;

    llm = { completions: jest.fn() };
    executor = {
      executeBatch: jest.fn(async (calls: any[]) =>
        calls.map((c) => ({
          toolCallId: c.id,
          name: c.name,
          content: "ok",
        })),
      ),
    };

    service = new MemorySyncService(llm as any, executor as any);

    sessionCtx = {
      sessionId: "s1",
      sessionType: "web",
      getWorkspacePath: () => tmpDir,
      getToolScope: jest.fn(() => scope),
      setToolScope: jest.fn((v: string | null) => {
        scope = v;
      }),
      getPathJail: jest.fn(() => jail),
      setPathJail: jest.fn((v: string | null) => {
        jail = v;
      }),
      getHistory: jest.fn(async () => [
        { id: "m1", role: "user", kind: "user", source: { kind: "user" }, metadata: {}, content: [] },
      ]),
      generateMessageId: jest.fn(() => "gen-" + Math.random().toString(36).slice(2)),
      getModelConfig: () => ({
        modelName: "test-model",
        provider: {},
        config: {
          temperature: 0.7,
          topP: 1,
          frequencyPenalty: 0,
          maxOutputTokens: 1000,
          inputCapabilities: [],
        },
      }),
      getSystemText: () => "system",
      getResolvedPlugins: () => [],
      getThinkingEffort: () => undefined,
    };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const payload = (summaryMode: SummaryMode, abortSignal?: AbortSignal) =>
    ({ sessionContext: sessionCtx, summaryMode, abortSignal }) as any;

  it("does nothing unless summaryMode is MEMORY_SYNC", async () => {
    await service.onBeforeCompaction(payload(SummaryMode.DISABLED));
    await service.onBeforeCompaction(payload(SummaryMode.FAST));
    expect(llm.completions).not.toHaveBeenCalled();
    expect(sessionCtx.setToolScope).not.toHaveBeenCalled();
    expect(sessionCtx.setPathJail).not.toHaveBeenCalled();
  });

  it("DEFAULT 指向 FAST：兜底路径不会拉起影子轮次（当前禁用）", async () => {
    expect(SummaryMode.DEFAULT).toBe(SummaryMode.FAST);
    await service.onBeforeCompaction(payload(SummaryMode.DEFAULT));
    expect(llm.completions).not.toHaveBeenCalled();
    expect(sessionCtx.setPathJail).not.toHaveBeenCalled();
  });

  it("skips sub-agent sessions entirely (short tasks get no forced memory sweep)", async () => {
    mockRounds([textChunks("DONE")]);
    sessionCtx.sessionType = "sub_agent";

    await service.onBeforeCompaction(payload(SummaryMode.MEMORY_SYNC));

    expect(llm.completions).not.toHaveBeenCalled();
    expect(sessionCtx.setToolScope).not.toHaveBeenCalled();
    expect(sessionCtx.setPathJail).not.toHaveBeenCalled();
    // 跳过影子轮次不等于解除隔离：隔离路径解析本身不受影响
    expect(
      resolveMemoryDir({
        workspacePath: tmpDir,
        sessionId: "s1",
        sessionType: "sub_agent",
      }),
    ).toContain(path.join(".guada", "subagents", "s1", "memory"));
  });

  it("locks tool scope to the file plugin and the path jail to the memory dir during the run", async () => {
    let scopeDuringCall: string | null = "unset";
    let jailDuringCall: string | null = "unset";
    llm.completions.mockImplementation(async () => {
      scopeDuringCall = scope;
      jailDuringCall = jail;
      return (async function* () {
        for (const c of textChunks("DONE")) yield c;
      })();
    });

    await service.onBeforeCompaction(payload(SummaryMode.MEMORY_SYNC));

    expect(scopeDuringCall).toBe("file");
    expect(jailDuringCall).toBe(expectedMemoryDir());
    // 退出后原样恢复（原值为 null）
    expect(scope).toBeNull();
    expect(jail).toBeNull();
  });

  it("instructs the AI to maintain memory with file tools rather than a dedicated tool", async () => {
    mockRounds([textChunks("DONE")]);
    await service.onBeforeCompaction(payload(SummaryMode.MEMORY_SYNC));

    const params = llm.completions.mock.calls[0][0];
    // messages[0] 是历史消息，指令是追加其后的影子 user 消息
    const instruction = (params.messages as any[])
      .flatMap((m) => m.content)
      .map((b) => b.text || "")
      .find((text: string) => text.includes("SILENT SYSTEM PROCESS")) as string;

    expect(instruction).toBeTruthy();
    expect(instruction).toContain(expectedMemoryDir());
    expect(instruction).toMatch(/file tools \(read\/write\/edit\)/);
    expect(instruction).toContain("DONE");
    // 旧的记忆工具已取消，指令中不得再提
    expect(instruction).not.toMatch(/memory tool/i);
  });

  it("executes tool calls in the shadow turn and stops when the model stops calling tools", async () => {
    mockRounds([
      toolCallChunks("write", { file_path: "MEMORY.md", content: "x" }),
      textChunks("DONE"),
    ]);

    await service.onBeforeCompaction(payload(SummaryMode.MEMORY_SYNC));

    expect(llm.completions).toHaveBeenCalledTimes(2);
    expect(executor.executeBatch).toHaveBeenCalledTimes(1);
    const [calls] = executor.executeBatch.mock.calls[0];
    expect(calls[0].name).toBe("write");
    expect(calls[0].arguments).toEqual({ file_path: "MEMORY.md", content: "x" });
  });

  it("is fail-open: an LLM failure neither throws nor leaks the scope/jail", async () => {
    llm.completions.mockRejectedValue(new Error("provider down"));

    await expect(
      service.onBeforeCompaction(payload(SummaryMode.MEMORY_SYNC)),
    ).resolves.toBeUndefined();

    expect(scope).toBeNull();
    expect(jail).toBeNull();
  });

  it("does not start a round when the run is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await service.onBeforeCompaction(
      payload(SummaryMode.MEMORY_SYNC, controller.signal),
    );

    expect(llm.completions).not.toHaveBeenCalled();
    expect(jail).toBeNull();
  });

  it("restores a pre-existing scope/jail instead of clearing them", async () => {
    scope = "other-plugin";
    jail = path.join(tmpDir, "previous-jail");
    mockRounds([textChunks("DONE")]);

    await service.onBeforeCompaction(payload(SummaryMode.MEMORY_SYNC));

    expect(scope).toBe("other-plugin");
    expect(jail).toBe(path.join(tmpDir, "previous-jail"));
  });

  describe("shadow log (append-only JSONL)", () => {
    const logPath = () => path.join(tmpDir, ".guada", "logs", "compression.jsonl");

    async function readLines() {
      const raw = await fs.readFile(logPath(), "utf-8");
      return raw.trimEnd().split("\n");
    }

    it("appends one JSON line per run so earlier runs survive", async () => {
      mockRounds([textChunks("DONE")]);
      await service.onBeforeCompaction(payload(SummaryMode.MEMORY_SYNC));
      scope = null;
      jail = null;
      await service.onBeforeCompaction(payload(SummaryMode.MEMORY_SYNC));

      const lines = await readLines();
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        const entry = JSON.parse(line);
        expect(Object.keys(entry)).toEqual(["time", "sessionId", "records"]);
        expect(entry.sessionId).toBe("s1");
        // 抽样上下文消息 + 影子指令 + 模型回复
        expect(entry.records.length).toBeGreaterThanOrEqual(3);
      }
    });

    it("keeps appending to a pre-existing log written by the old single-object format", async () => {
      await fs.mkdir(path.dirname(logPath()), { recursive: true });
      const legacyEntry = JSON.stringify({
        time: "2026-09-05T09:52:59.543Z",
        sessionId: "legacy",
        records: [],
      });
      await fs.writeFile(logPath(), legacyEntry + "\n", "utf-8");

      mockRounds([textChunks("DONE")]);
      await service.onBeforeCompaction(payload(SummaryMode.MEMORY_SYNC));

      const lines = await readLines();
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).sessionId).toBe("legacy");
      expect(JSON.parse(lines[1]).sessionId).toBe("s1");
    });

    it("rotates to compression.jsonl.1 once the log exceeds the size cap", async () => {
      const oversized = 6 * 1024 * 1024; // 上限为 5MB
      await fs.mkdir(path.dirname(logPath()), { recursive: true });
      await fs.writeFile(logPath(), "x".repeat(oversized), "utf-8");

      mockRounds([textChunks("DONE")]);
      await service.onBeforeCompaction(payload(SummaryMode.MEMORY_SYNC));

      expect((await fs.stat(logPath() + ".1")).size).toBe(oversized);
      const lines = await readLines();
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).sessionId).toBe("s1");
    });

    it("never lets a logging failure break the shadow turn", async () => {
      // .guada/logs 占位成文件 → mkdirSync 失败
      const logsPath = path.join(tmpDir, ".guada", "logs");
      await fs.mkdir(path.dirname(logsPath), { recursive: true });
      await fs.writeFile(logsPath, "", "utf-8");

      mockRounds([textChunks("DONE")]);
      await expect(
        service.onBeforeCompaction(payload(SummaryMode.MEMORY_SYNC)),
      ).resolves.toBeUndefined();
      expect(scope).toBeNull();
      expect(jail).toBeNull();
    });
  });

  it("is wired to the compaction.before hook", () => {
    expect(HOOKS.BEFORE_COMPACTION).toBe("compaction.before");
    expect(typeof service.onBeforeCompaction).toBe("function");
  });
});
