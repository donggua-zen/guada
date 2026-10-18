import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import type { RemoteConnection } from "@/services/modules/remote-workspace.api";

/**
 * 远程工作区连接 Store 测试
 *
 * 覆盖"共享连接清单"核心约定：
 * - ensureConnections：首次加载、已加载早退、并发去重、force 重载、失败可重试
 * - CRUD：成功后同步本地清单（upsert / 过滤），失败原样抛出
 * - connectionOptions：绑定入口下拉的展示投影
 */

vi.mock("@/services/ApiService", () => ({
  apiService: {
    getConnections: vi.fn(),
    createConnection: vi.fn(),
    updateConnection: vi.fn(),
    deleteConnection: vi.fn(),
  },
}));

import { useRemoteWorkspaceStore, toggleConnectionBinding } from "./remoteWorkspace";
import { apiService } from "@/services/ApiService";
import { SSH_CONNECTION_ATTACHMENT_TYPE } from "@/constants";

const mockedGet = vi.mocked(apiService.getConnections);
const mockedCreate = vi.mocked(apiService.createConnection);
const mockedUpdate = vi.mocked(apiService.updateConnection);
const mockedDelete = vi.mocked(apiService.deleteConnection);

function makeConn(id: string, name: string, user: string, host: string): RemoteConnection {
  return {
    id,
    name,
    config: { kind: "ssh", host, port: 22, username: user, authMethod: "password", password: "secret", path: `/home/${user}` },
  };
}

function makeDockerConn(id: string, name: string, container: string): RemoteConnection {
  return {
    id,
    name,
    config: { kind: "docker", container, path: "/workspace" },
  };
}

function makeWslConn(id: string, name: string, distro: string): RemoteConnection {
  return {
    id,
    name,
    config: { kind: "wsl", distro, path: "/home/dev/proj" },
  };
}

describe("remoteWorkspace Store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe("ensureConnections 加载", () => {
    it("首次加载填充清单并置 hasLoaded", async () => {
      const store = useRemoteWorkspaceStore();
      mockedGet.mockResolvedValue([makeConn("conn_a", "alpha", "root", "10.0.0.1")]);

      await store.ensureConnections();

      expect(mockedGet).toHaveBeenCalledTimes(1);
      expect(store.connections).toHaveLength(1);
      expect(store.hasLoaded).toBe(true);
      expect(store.isLoading).toBe(false);
    });

    it("已加载后再次调用早退，不重复请求", async () => {
      const store = useRemoteWorkspaceStore();
      mockedGet.mockResolvedValue([]);
      await store.ensureConnections();

      await store.ensureConnections();

      expect(mockedGet).toHaveBeenCalledTimes(1);
    });

    it("并发调用共享同一请求，只请求一次", async () => {
      const store = useRemoteWorkspaceStore();
      mockedGet.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 10)),
      );

      await Promise.all([store.ensureConnections(), store.ensureConnections(), store.ensureConnections()]);

      expect(mockedGet).toHaveBeenCalledTimes(1);
    });

    it("force 忽略已加载缓存强制重拉", async () => {
      const store = useRemoteWorkspaceStore();
      mockedGet.mockResolvedValue([makeConn("conn_a", "alpha", "root", "10.0.0.1")]);
      await store.ensureConnections();

      mockedGet.mockResolvedValue([makeConn("conn_a", "alpha", "root", "10.0.0.1"), makeConn("conn_b", "beta", "dev", "10.0.0.2")]);
      await store.ensureConnections(true);

      expect(mockedGet).toHaveBeenCalledTimes(2);
      expect(store.connections).toHaveLength(2);
    });

    it("加载失败静默：hasLoaded 不置位，下次调用重试", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const store = useRemoteWorkspaceStore();
      mockedGet.mockRejectedValueOnce(new Error("network down"));

      await store.ensureConnections();
      expect(store.hasLoaded).toBe(false);
      expect(store.isLoading).toBe(false);

      mockedGet.mockResolvedValue([makeConn("conn_a", "alpha", "root", "10.0.0.1")]);
      await store.ensureConnections();
      expect(mockedGet).toHaveBeenCalledTimes(2);
      expect(store.hasLoaded).toBe(true);
      errorSpy.mockRestore();
    });
  });

  describe("CRUD 本地同步", () => {
    it("createConnection 成功后追加清单", async () => {
      const store = useRemoteWorkspaceStore();
      const created = makeConn("conn_a", "alpha", "root", "10.0.0.1");
      mockedCreate.mockResolvedValue(created);

      const result = await store.createConnection("alpha", created.config);

      expect(result).toEqual(created);
      expect(store.connections).toEqual([created]);
    });

    it("updateConnection 成功后就地替换同 id 项", async () => {
      const store = useRemoteWorkspaceStore();
      const original = makeConn("conn_a", "alpha", "root", "10.0.0.1");
      mockedGet.mockResolvedValue([original, makeConn("conn_b", "beta", "dev", "10.0.0.2")]);
      await store.ensureConnections();

      const updated: RemoteConnection = { ...original, name: "alpha-renamed" };
      mockedUpdate.mockResolvedValue(updated);
      const result = await store.updateConnection("conn_a", { name: "alpha-renamed" });

      expect(result).toEqual(updated);
      expect(store.connections.map((c) => c.name)).toEqual(["alpha-renamed", "beta"]);
    });

    it("create/update 失败时原样抛出，清单不变", async () => {
      const store = useRemoteWorkspaceStore();
      const original = makeConn("conn_a", "alpha", "root", "10.0.0.1");
      mockedGet.mockResolvedValue([original]);
      await store.ensureConnections();

      mockedCreate.mockRejectedValue(new Error("name conflict"));
      await expect(store.createConnection("alpha", original.config)).rejects.toThrow("name conflict");
      expect(store.connections).toEqual([original]);

      mockedUpdate.mockRejectedValue(new Error("Connection not found"));
      await expect(store.updateConnection("conn_x", { name: "x" })).rejects.toThrow("Connection not found");
      expect(store.connections).toEqual([original]);
    });

    it("deleteConnection 成功后过滤清单", async () => {
      const store = useRemoteWorkspaceStore();
      mockedGet.mockResolvedValue([makeConn("conn_a", "alpha", "root", "10.0.0.1"), makeConn("conn_b", "beta", "dev", "10.0.0.2")]);
      await store.ensureConnections();
      mockedDelete.mockResolvedValue({ success: true });

      await store.deleteConnection("conn_a");

      expect(store.connections.map((c) => c.id)).toEqual(["conn_b"]);
    });

    it("deleteConnection 返回 success:false 时保留清单", async () => {
      const store = useRemoteWorkspaceStore();
      mockedGet.mockResolvedValue([makeConn("conn_a", "alpha", "root", "10.0.0.1")]);
      await store.ensureConnections();
      mockedDelete.mockResolvedValue({ success: false });

      await store.deleteConnection("conn_a");

      expect(store.connections).toHaveLength(1);
    });
  });

  describe("connectionOptions 投影", () => {
    it("映射为 {id, name, kind, description: user@host}", () => {
      const store = useRemoteWorkspaceStore();
      store.connections = [
        makeConn("conn_a", "alpha", "root", "10.0.0.1"),
        makeConn("conn_b", "beta", "dev", "10.0.0.2"),
      ];

      expect(store.connectionOptions).toEqual([
        { id: "conn_a", name: "alpha", kind: "ssh", description: "root@10.0.0.1:22", path: "/home/root" },
        { id: "conn_b", name: "beta", kind: "ssh", description: "dev@10.0.0.2:22", path: "/home/dev" },
      ]);
    });

    it("Docker 连接：kind=docker，描述为容器名", () => {
      const store = useRemoteWorkspaceStore();
      store.connections = [makeDockerConn("conn_d", "my-container", "guada-dev")];

      expect(store.connectionOptions).toEqual([
        { id: "conn_d", name: "my-container", kind: "docker", description: "容器 guada-dev", path: "/workspace" },
      ]);
    });

    it("WSL 连接：kind=wsl，描述为发行版名", () => {
      const store = useRemoteWorkspaceStore();
      store.connections = [makeWslConn("conn_w", "my-wsl", "Ubuntu-AOSP")];

      expect(store.connectionOptions).toEqual([
        { id: "conn_w", name: "my-wsl", kind: "wsl", description: "WSL 发行版 Ubuntu-AOSP", path: "/home/dev/proj" },
      ]);
    });

    it("旧数据无 kind 字段时视作 ssh", () => {
      const store = useRemoteWorkspaceStore();
      store.connections = [
        {
          id: "conn_legacy",
          name: "legacy",
          config: { host: "10.0.0.9", port: 22, username: "root", authMethod: "password", path: "/srv" },
        },
      ];

      expect(store.connectionOptions).toEqual([
        { id: "conn_legacy", name: "legacy", kind: "ssh", description: "root@10.0.0.9:22", path: "/srv" },
      ]);
    });

    it("path 未配置时兜底为空串", () => {
      const store = useRemoteWorkspaceStore();
      const noPath = makeConn("conn_c", "gamma", "ops", "10.0.0.3");
      noPath.config.path = "";
      store.connections = [noPath];

      expect(store.connectionOptions).toEqual([
        { id: "conn_c", name: "gamma", kind: "ssh", description: "ops@10.0.0.3:22", path: "" },
      ]);
    });
  });

  describe("toggleConnectionBinding 纯函数", () => {
    it("未绑定时添加到 ssh-connection 列表", () => {
      const result = toggleConnectionBinding({}, "conn_a");
      expect(result).toEqual({ [SSH_CONNECTION_ATTACHMENT_TYPE]: ["conn_a"] });
    });

    it("已绑定时从列表移除", () => {
      const attachments = { [SSH_CONNECTION_ATTACHMENT_TYPE]: ["conn_a", "conn_b"] };
      const result = toggleConnectionBinding(attachments, "conn_a");
      expect(result).toEqual({ [SSH_CONNECTION_ATTACHMENT_TYPE]: ["conn_b"] });
    });

    it("undefined 入参等价于空 attachments", () => {
      expect(toggleConnectionBinding(undefined, "conn_a")).toEqual({
        [SSH_CONNECTION_ATTACHMENT_TYPE]: ["conn_a"],
      });
    });

    it("非数组的历史脏数据按空列表处理", () => {
      const dirty = { [SSH_CONNECTION_ATTACHMENT_TYPE]: "conn_a" as unknown as string[] };
      expect(toggleConnectionBinding(dirty, "conn_a")).toEqual({
        [SSH_CONNECTION_ATTACHMENT_TYPE]: ["conn_a"],
      });
    });

    it("保留其余附件类型的绑定", () => {
      const attachments = { [SSH_CONNECTION_ATTACHMENT_TYPE]: ["conn_a"], "kb": ["kb_1"] };
      const result = toggleConnectionBinding(attachments, "conn_a");
      expect(result).toEqual({ [SSH_CONNECTION_ATTACHMENT_TYPE]: [], "kb": ["kb_1"] });
    });

    it("不修改入参对象（纯函数语义）", () => {
      const attachments = { [SSH_CONNECTION_ATTACHMENT_TYPE]: ["conn_a"] };
      toggleConnectionBinding(attachments, "conn_b");
      expect(attachments).toEqual({ [SSH_CONNECTION_ATTACHMENT_TYPE]: ["conn_a"] });
    });
  });
});
