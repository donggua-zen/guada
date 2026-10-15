import {
  AgentWorkspaceProvider,
  REMOTE_PROCESS_ID_PREFIX,
} from "./agent-workspace-provider";

/**
 * AgentWorkspaceProvider — WorkspaceProvider 协议映射测试（stub RemoteAgent）：
 * 主路径原生 RPC（glob/grep），旧版 agent（unknown method）降级路径，
 * 进程方法的前缀命名空间映射与 encoding 透传。
 */
describe("AgentWorkspaceProvider", () => {
  /** 模拟旧版 agent：不认识 0.5.0 新增的 RPC */
  const unknownMethod = (method: string) =>
    new Error(`unknown method: ${method}`);

  const buildProvider = (agentOverrides: Record<string, any> = {}) => {
    const agent: any = {
      basePath: "/remote/proj",
      resolveRemotePath: (p: string) =>
        p.startsWith("/") ? p : `/remote/proj/${p}`,
      executeRaw: jest.fn(async () => ({ kind: "completed", output: "", exitCode: 0, uptimeMs: 1 })),
      uploadBuffer: jest.fn(async () => {}),
      readFileRangeRaw: jest.fn(async () => Buffer.from("range")),
      readFileRaw: jest.fn(async () => "content"),
      writeFileRaw: jest.fn(async () => {}),
      pollRaw: jest.fn(async () => null),
      killRaw: jest.fn(async () => ({ status: "killed" })),
      writeStdinRaw: jest.fn(async () => {}),
      drainCompletedRaw: jest.fn(async () => []),
      globRaw: jest.fn(async () => ({ files: [], hasMore: false })),
      grepRaw: jest.fn(async () => []),
      ...agentOverrides,
    };
    return {
      provider: new AgentWorkspaceProvider(agent, "conn-a"),
      agent,
    };
  };

  describe("glob → 主路径原生 RPC", () => {
    it("透传 globRaw（pattern/cwd/ignore/limit/deep）", async () => {
      const { provider, agent } = buildProvider({
        globRaw: jest.fn(async () => ({
          files: [{ path: "src/a.ts", size: 10 }],
          hasMore: true,
        })),
      });
      const files = await provider.glob("**/*.ts", {
        cwd: "/remote/proj/src",
        ignore: ["**/node_modules/**"],
        limit: 5,
        deep: 2,
      });
      expect(agent.globRaw).toHaveBeenCalledWith(
        "**/*.ts",
        "/remote/proj/src",
        ["**/node_modules/**"],
        5,
        2,
      );
      expect(files).toEqual([{ path: "src/a.ts", size: 10 }]);
    });

    it("globRaw 抛非 unknown method 错误 → 原样向上", async () => {
      const { provider } = buildProvider({
        globRaw: jest.fn(async () => {
          throw new Error("connection lost");
        }),
      });
      await expect(
        provider.glob("**/*", { cwd: "/remote/proj" }),
      ).rejects.toThrow("connection lost");
    });
  });

  describe("glob → 旧版 agent 降级（find 命令构造）", () => {
    const legacyAgent = (overrides: Record<string, any> = {}) => ({
      globRaw: jest.fn(async () => {
        throw unknownMethod("glob");
      }),
      ...overrides,
    });

    it("静态前缀缩小 find 起始目录，非递归模式带 maxdepth", async () => {
      const { provider, agent } = buildProvider(legacyAgent());
      await provider.glob("src/*.ts", { cwd: "/remote/proj", limit: 5 });
      const cmd = agent.executeRaw.mock.calls[0][0] as string;
      expect(cmd).toContain("find '/remote/proj/src'");
      expect(cmd).toContain("-maxdepth 1");
      expect(cmd).toContain("-name '*.ts'");
      expect(cmd).toContain("-exec wc -c {} +");
    });

    it("递归模式（** 开头）不带 maxdepth，且对忽略目录剪枝", async () => {
      const { provider, agent } = buildProvider(legacyAgent());
      await provider.glob("**/*.py", {
        cwd: "/remote/proj",
        ignore: ["**/node_modules/**", "**/.git/**"],
      });
      const cmd = agent.executeRaw.mock.calls[0][0] as string;
      expect(cmd).toContain("find '/remote/proj' ");
      expect(cmd).not.toContain("-maxdepth");
      expect(cmd).toContain("-path '*/node_modules'");
      expect(cmd).toContain("-prune -o");
      expect(cmd).toContain("-path '*/.git'");
    });

    it("depth 参数映射为 find maxdepth（fg deep 语义）", async () => {
      const { provider, agent } = buildProvider(legacyAgent());
      await provider.glob("**/*", { cwd: "/remote/proj", deep: 2 });
      expect(agent.executeRaw.mock.calls[0][0]).toContain("-maxdepth 2");
    });

    it("模式含单引号 → 拒绝（防注入）", async () => {
      const { provider, agent } = buildProvider(legacyAgent());
      await expect(
        provider.glob("a'b.ts", { cwd: "/remote/proj" }),
      ).rejects.toThrow("Unsupported agent");
      expect(agent.executeRaw).not.toHaveBeenCalled();
    });

    it("wc 输出解析：total 过滤、忽略正则、单段 * 不跨段、limit 截断", async () => {
      const wcOutput = [
        "  100 /remote/proj/src/a.ts",
        "  2048 /remote/proj/src/node_modules/x.ts", // find 剪枝失效时的兜底过滤
        "  300 /remote/proj/src/sub/b.ts", // 单段 * 不跨段，应被精确过滤
        "  400 /remote/proj/src/c.md", // 扩展名不匹配
        "  700 /remote/proj/src/total", // 文件名恰为 total 不应误滤（含路径）
        "  800 total", // wc 聚合行
        "  500 /remote/proj/src/e.ts",
        "  999 /remote/proj/src/d.tsx", // *.ts 不匹配 .tsx
      ].join("\n");
      const { provider } = buildProvider(
        legacyAgent({
          executeRaw: jest.fn(async () => ({
            kind: "completed",
            output: wcOutput,
            exitCode: 0,
            uptimeMs: 1,
          })),
        }),
      );
      const files = await provider.glob("src/*.ts", {
        cwd: "/remote/proj",
        ignore: ["**/node_modules/**"],
        limit: 2,
      });
      // 结果相对 cwd；仅顶层 .ts；limit=2 截断
      expect(files).toEqual([
        { path: "src/a.ts", size: 100 },
        { path: "src/e.ts", size: 500 },
      ]);
    });

    it("wc 空输出 → 空数组", async () => {
      const { provider } = buildProvider(legacyAgent());
      expect(await provider.glob("**/*", { cwd: "/remote/proj" })).toEqual([]);
    });
  });

  describe("grep → 主路径与降级", () => {
    it("主路径透传 grepRaw（RE2 语义、相对路径行）", async () => {
      const { provider, agent } = buildProvider({
        grepRaw: jest.fn(async () => ["code.go:2: port := 8080"]),
      });
      const lines = await provider.grep("\\d+", {
        path: "/remote/proj",
        maxResults: 10,
        ignore: ["**/node_modules/**"],
      });
      expect(agent.grepRaw).toHaveBeenCalledWith("\\d+", "/remote/proj", 10, [
        "**/node_modules/**",
      ]);
      expect(lines).toEqual(["code.go:2: port := 8080"]);
    });

    it("旧版 agent → 降级 shell grep（--exclude-dir + head 截断）", async () => {
      const { provider, agent } = buildProvider({
        grepRaw: jest.fn(async () => {
          throw unknownMethod("grep");
        }),
        executeRaw: jest.fn(async () => ({
          kind: "completed",
          output: "code.go:2: port := 8080\ndocs/x.md:1: port 9\n",
          exitCode: 0,
          uptimeMs: 1,
        })),
      });
      const lines = await provider.grep("port", {
        path: "/remote/proj",
        maxResults: 5,
        ignore: ["**/node_modules/**"],
      });
      const cmd = agent.executeRaw.mock.calls[0][0] as string;
      expect(cmd).toContain("grep -rn");
      expect(cmd).toContain("--exclude-dir='node_modules'");
      expect(cmd).toContain("| head -n 5");
      expect(lines).toEqual(["code.go:2: port := 8080", "docs/x.md:1: port 9"]);
    });

    it("无匹配 → 空数组", async () => {
      const { provider } = buildProvider();
      expect(await provider.grep("nope", { path: "/remote/proj" })).toEqual([]);
    });
  });

  describe("进程方法映射", () => {
    it("execute completed → kind=completed + processStatus，encoding 透传", async () => {
      const { provider, agent } = buildProvider({
        executeRaw: jest.fn(async () => ({
          kind: "completed",
          output: "hello",
          exitCode: 0,
          uptimeMs: 12,
        })),
      });
      const r = await provider.execute("ls", "/x", {
        timeout: 1000,
        encoding: "gbk",
      });
      expect(agent.executeRaw).toHaveBeenCalledWith("ls", {
        timeoutMs: 1000,
        signal: undefined,
        background: undefined,
        encoding: "gbk",
      });
      expect(r).toMatchObject({
        kind: "completed",
        output: "hello",
        exitCode: 0,
        processStatus: "completed",
      });
    });

    it("execute backgrounded → processId 加 r: 前缀 + logFilePath 透传", async () => {
      const { provider } = buildProvider({
        executeRaw: jest.fn(async () => ({
          kind: "backgrounded",
          output: "partial",
          exitCode: null,
          uptimeMs: 60000,
          processId: "7",
          logFile: "/tmp/guada-logs/x.out",
        })),
      });
      const r = await provider.execute("sleep 100", "/x", { timeout: 1000 });
      expect(r.kind).toBe("backgrounded");
      expect((r as any).processId).toBe("r:conn-a:7");
      expect((r as any).logFilePath).toBe("/tmp/guada-logs/x.out");
    });

    it("poll → 透传（含 encoding）并把 processId 还原为带前缀形态", async () => {
      const { provider, agent } = buildProvider({
        pollRaw: jest.fn(async () => ({
          processId: "3",
          status: "completed",
          exitCode: 0,
          output: "done",
          uptimeMs: 50,
        })),
      });
      const r = await provider.poll("r:conn-a:3", 500, undefined, "gbk");
      expect(agent.pollRaw).toHaveBeenCalledWith("3", 500, undefined, "gbk");
      expect((r as any)!.processId).toBe("r:conn-a:3");
      expect((r as any)!.status).toBe("completed");
    });

    it("pollRaw not found → provider.poll 返回 null", async () => {
      const { provider } = buildProvider({ pollRaw: jest.fn(async () => null) });
      expect(await provider.poll("r:conn-a:9", 100)).toBeNull();
    });

    it("kill/writeToStdin 剥离 r: 前缀后转发", async () => {
      const { provider, agent } = buildProvider();
      expect(provider.kill("r:conn-a:5")).toBe("killed");
      provider.writeToStdin(`${REMOTE_PROCESS_ID_PREFIX}5`, "hi\n");
      await Promise.resolve();
      expect(agent.killRaw).toHaveBeenCalledWith("5");
      expect(agent.writeStdinRaw).toHaveBeenCalledWith("5", "hi\n");
    });

    it("drainCompleted → 全部行带 r: 前缀", async () => {
      const { provider } = buildProvider({
        drainCompletedRaw: jest.fn(async () => [
          { processId: "1", status: "completed", exitCode: 0, output: "o", uptimeMs: 9 },
        ]),
      });
      const rows = await provider.drainCompleted();
      expect(rows).toHaveLength(1);
      expect((rows[0] as any).processId).toBe("r:conn-a:1");
    });
  });

  describe("文件方法映射", () => {
    it("writeFile(Buffer) → 走分块上传", async () => {
      const { provider, agent } = buildProvider();
      await provider.writeFile("bin.dat", Buffer.from([1, 2, 3]));
      expect(agent.uploadBuffer).toHaveBeenCalledWith("/remote/proj/bin.dat", expect.any(Buffer));
      expect(agent.writeFileRaw).not.toHaveBeenCalled();
    });

    it("writeFile(string) → writeFileRaw", async () => {
      const { provider, agent } = buildProvider();
      await provider.writeFile("a.txt", "hello", { encoding: "utf-8" });
      expect(agent.writeFileRaw).toHaveBeenCalledWith("a.txt", "hello", "utf-8");
    });

    it("readFileRange → readFileRangeRaw", async () => {
      const { provider, agent } = buildProvider();
      const buf = await provider.readFileRange("a.bin", 0, 16);
      expect(agent.readFileRangeRaw).toHaveBeenCalledWith("a.bin", 0, 16);
      expect(buf.toString()).toBe("range");
    });

    it("resolvePath：相对路径基于 basePath，绝对路径原样", () => {
      const { provider } = buildProvider();
      expect(provider.resolvePath("a/b.txt")).toBe("/remote/proj/a/b.txt");
      expect(provider.resolvePath("/etc/hosts")).toBe("/etc/hosts");
    });
  });
});
