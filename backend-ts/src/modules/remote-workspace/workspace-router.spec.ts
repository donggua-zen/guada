import { WorkspaceToolRouter } from "./workspace-router";

/**
 * WorkspaceToolRouter — workspace 参数分流测试：
 * 缺省/main/local → null（主工作目录，走本地代码路径）；
 * 连接名 → 经 RemoteAgentManager.getAgent（内含会话绑定校验）返回远程目标。
 */
describe("WorkspaceToolRouter", () => {
  const buildRouter = (getAgentImpl?: (...args: any[]) => Promise<any>) => {
    const manager: any = {
      getAgent: getAgentImpl || (async () => ({ basePath: "/remote/proj" })),
    };
    return new WorkspaceToolRouter(manager);
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
});
