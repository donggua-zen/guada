import { WorkspaceToolRouter } from "./workspace-router";
import { JobRegistryService } from "../jobs/job-registry.service";

/**
 * WorkspaceToolRouter — workspace 参数分流测试：
 * 缺省/main/local → null（主工作目录，走本地代码路径）；
 * 连接名 → 经 RemoteAgentManager.getAgent（内含会话绑定校验）返回远程目标。
 */
describe("WorkspaceToolRouter", () => {
  const buildRouter = (
    getAgentImpl?: (...args: any[]) => Promise<any>,
    registry?: JobRegistryService,
    drainImpl?: () => Promise<any[]>,
  ) => {
    const manager: any = {
      getAgent: getAgentImpl || (async () => ({ basePath: "/remote/proj" })),
      drainSessionProcesses: drainImpl || (async () => []),
    };
    return new WorkspaceToolRouter(manager, registry);
  };

  it("缺省 / main / local → 返回 null（主工作目录）", async () => {
    const router = buildRouter();
    expect(await router.resolveRemoteTarget(undefined, "s1", {})).toBeNull();
    expect(await router.resolveRemoteTarget("", "s1", {})).toBeNull();
    expect(await router.resolveRemoteTarget("main", "s1", {})).toBeNull();
    expect(await router.resolveRemoteTarget("local", "s1", {})).toBeNull();
  });

  it("主目录取值不触发 manager.getAgent（不建立远端连接）", async () => {
    const getAgent = jest.fn();
    const router = buildRouter(getAgent);
    await router.resolveRemoteTarget(undefined, "s1", {});
    expect(getAgent).not.toHaveBeenCalled();
  });

  it("连接名 → 返回远程目标（provider + basePath + 连接名）", async () => {
    const getAgent = jest.fn(async () => ({
      basePath: "/remote/proj",
      connectionKind: "ssh",
    }));
    const router = buildRouter(getAgent);
    const attachments = { "ssh-connection": ["conn-1"] };
    const target = await router.resolveRemoteTarget(
      "my-server",
      "s1",
      attachments,
    );
    expect(getAgent).toHaveBeenCalledWith("my-server", "s1", attachments);
    expect(target).not.toBeNull();
    expect(target!.connectionName).toBe("my-server");
    expect(target!.basePath).toBe("/remote/proj");
    expect(target!.provider.scheme).toBe("ssh");
  });

  it("Docker 连接 → provider.scheme=docker（传输差异对工具层透明）", async () => {
    const getAgent = jest.fn(async () => ({
      basePath: "/workspace",
      connectionKind: "docker",
    }));
    const router = buildRouter(getAgent);
    const target = await router.resolveRemoteTarget("my-container", "s1", {
      "ssh-connection": ["conn-d1"],
    });
    expect(target).not.toBeNull();
    expect(target!.basePath).toBe("/workspace");
    expect(target!.provider.scheme).toBe("docker");
  });

  it("getAgent 抛错（连接不存在/未绑定会话）→ 原样向上传播", async () => {
    const router = buildRouter(async () => {
      throw new Error(
        "Connection 'x' is not bound to this session.",
      );
    });
    await expect(
      router.resolveRemoteTarget("x", "s1", { "ssh-connection": [] }),
    ).rejects.toThrow("not bound to this session");
  });

  describe("远程 Job", () => {
    let registry: JobRegistryService;

    beforeEach(() => {
      registry = new JobRegistryService({ emit: jest.fn() } as any);
    });

    afterEach(() => {
      registry.onModuleDestroy();
    });

    const provider = {
      readProcess: jest.fn(async () => ({
        text: "remote output",
        offset: 0,
        nextOffset: 13,
        size: 13,
        truncated: false,
        logFilePath: "/tmp/remote.log",
        status: "completed",
        exitCode: 0,
        uptimeMs: 10,
      })),
      kill: jest.fn(),
    };

    function register(router: WorkspaceToolRouter) {
      return router.registerRemoteProcess(
        "s1",
        "r:conn:p1",
        "conn",
        "utf-8",
        {
          command: "sleep 10",
          logFilePath: "/tmp/remote.log",
          provider: provider as any,
        },
      );
    }

    it("后台登记注册 remote-shell job，push 完成后可读", async () => {
      const router = buildRouter(undefined, registry);
      const jobId = register(router)!;
      expect(jobId).toMatch(/^job-/);
      expect(registry.get(jobId, "s1")).toMatchObject({
        kind: "remote-shell",
        label: "sleep 10",
        handle: "r:conn:p1",
        status: "running",
      });

      router.handleRemoteProcessDone({
        sessionId: "s1",
        connectionName: "conn",
        processId: "p1",
        jobId,
        status: "completed",
        exitCode: 0,
      });
      const settled = await registry.wait(jobId, "s1", 1000);
      expect(settled.status).toBe("completed");

      const read = await registry.read(jobId, "s1");
      expect(read.output.text).toBe("remote output");
      expect(provider.readProcess).toHaveBeenCalledWith(
        "r:conn:p1",
        expect.objectContaining({ maxBytes: expect.any(Number) }),
        "utf-8",
      );
    });

    it("连接断开 → running job 置 lost，read 返回兜底说明", async () => {
      const router = buildRouter(undefined, registry);
      const jobId = register(router)!;
      provider.readProcess.mockRejectedValueOnce(new Error("connection closed"));

      router.handleRemoteProcessDisconnected({
        sessionId: "s1",
        connectionName: "conn",
      });

      const settled = await registry.wait(jobId, "s1", 1000);
      expect(settled.status).toBe("lost");
      const read = await registry.read(jobId, "s1");
      expect(read.output.text).toContain("connection lost");
    });

    it("turn.stopping drain 结算并抑制通知", async () => {
      const router = buildRouter(
        undefined,
        registry,
        async () => [
          {
            connectionName: "conn",
            processId: "p1",
            status: "completed",
            exitCode: 0,
            outputB64: Buffer.from("drained output").toString("base64"),
            truncated: false,
            logFile: "/tmp/remote.log",
          },
        ],
      );
      const jobId = register(router)!;

      const rows = await router.drainRemoteProcesses("s1");
      expect(rows[0].output).toBe("drained output");
      const settled = await registry.wait(jobId, "s1", 1000);
      expect(settled.status).toBe("completed");
      expect(settled.reported).toBe(true);
    });
  });
});
