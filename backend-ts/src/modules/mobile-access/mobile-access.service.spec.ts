import { BadRequestException } from "@nestjs/common";
import { MobileAccessService } from "./mobile-access.service";
import {
  buildPublicAccessUrl,
  normalizeMobileAccessConfig,
  type MobileAccessConfig,
} from "./mobile-access.types";

/**
 * 只测配置层纯逻辑与密码门禁：SSH 隧道本身由 ssh2 承担，不在此 mock 网络。
 */

function createService(options: {
  passwordSet?: boolean;
  stored?: Record<string, any>;
} = {}) {
  const state = {
    passwordSet: options.passwordSet ?? false,
    stored: options.stored ? JSON.parse(JSON.stringify(options.stored)) : {},
  };
  const storage = {
    getSettings: jest.fn(async () => ({ ...state.stored })),
    updateSettings: jest.fn(async (_group: string, data: Record<string, any>) => {
      state.stored = { ...data };
    }),
  };
  const accountStore = {
    ensureReady: jest.fn(async () => undefined),
    isPasswordSet: jest.fn(() => state.passwordSet),
  };
  const tunnel = {
    apply: jest.fn(async () => undefined),
    restart: jest.fn(async () => undefined),
    reconnect: jest.fn(async () => undefined),
    getSnapshot: jest.fn(() => ({ status: "stopped" as const, url: null, lastError: null })),
  };
  const httpAdapterHost = {
    httpAdapter: {
      getHttpServer: () => ({ address: () => ({ port: 3000 }) }),
    },
  };
  const service = new MobileAccessService(
    storage as any,
    accountStore as any,
    tunnel as any,
    httpAdapterHost as any,
  );
  return { service, storage, accountStore, tunnel, state };
}

afterEach(() => {
  delete process.env.LISTEN_HOST;
});

describe("normalizeMobileAccessConfig", () => {
  it("空数据回落为全关闭的默认配置", () => {
    const config = normalizeMobileAccessConfig({});
    expect(config.lanEnabled).toBe(false);
    expect(config.publicEnabled).toBe(false);
    expect(config.ssh.port).toBe(22);
    expect(config.ssh.remotePort).toBe(8787);
    expect(config.ssh.remoteBindAddress).toBe("127.0.0.1");
  });

  it("非法端口/绑定地址回落默认值", () => {
    const config = normalizeMobileAccessConfig({
      ssh: { port: 99999, remotePort: -1, remoteBindAddress: "1.2.3.4" },
    });
    expect(config.ssh.port).toBe(22);
    expect(config.ssh.remotePort).toBe(8787);
    expect(config.ssh.remoteBindAddress).toBe("127.0.0.1");
  });
});

describe("buildPublicAccessUrl", () => {
  const base = normalizeMobileAccessConfig({}).ssh;

  it("优先使用自定义公网地址并补尾斜杠", () => {
    expect(buildPublicAccessUrl({ ...base, publicUrl: "https://guada.example.com" })).toBe(
      "https://guada.example.com/",
    );
  });

  it("未自定义时按 SSH 主机与远端端口推导", () => {
    expect(buildPublicAccessUrl({ ...base, host: "1.2.3.4", remotePort: 8787 })).toBe(
      "http://1.2.3.4:8787/",
    );
  });

  it("缺少主机时返回 null", () => {
    expect(buildPublicAccessUrl({ ...base, host: "", remotePort: 8787 })).toBeNull();
  });
});

describe("MobileAccessService 密码门禁", () => {
  it("未设密码时开启局域网被拒绝", async () => {
    const { service } = createService({ passwordSet: false });
    await expect(service.updateConfig({ lanEnabled: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("未设密码时开启公网被拒绝", async () => {
    const { service } = createService({ passwordSet: false });
    await expect(service.updateConfig({ publicEnabled: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("已设密码时允许开启，并按 LISTEN_HOST 计算 restartRequired", async () => {
    process.env.LISTEN_HOST = "127.0.0.1";
    const { service, tunnel } = createService({ passwordSet: true });
    const result = await service.updateConfig({ lanEnabled: true });
    expect(result.lanEnabled).toBe(true);
    expect(result.restartRequired).toBe(true);
    expect(tunnel.apply).toHaveBeenCalled();
  });

  it("已绑 0.0.0.0 时开启局域网不需要重启", async () => {
    process.env.LISTEN_HOST = "0.0.0.0";
    const { service } = createService({ passwordSet: true });
    const result = await service.updateConfig({ lanEnabled: true });
    expect(result.restartRequired).toBe(false);
  });
});

describe("MobileAccessService 公网配置校验", () => {
  const validSsh = {
    host: "1.2.3.4",
    username: "root",
    authMethod: "password" as const,
    password: "secret123",
  };

  it("只要求已设密码：不再对存量密码做强度二次判断", async () => {
    const { service } = createService({ passwordSet: true });
    const result = await service.updateConfig({ publicEnabled: true, ssh: validSsh });
    expect(result.publicEnabled).toBe(true);
  });

  it("开启公网但缺少主机被拒绝", async () => {
    const { service } = createService({ passwordSet: true });
    await expect(
      service.updateConfig({ publicEnabled: true, ssh: { ...validSsh, host: "" } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("密码认证缺少密码被拒绝", async () => {
    const { service } = createService({ passwordSet: true });
    await expect(
      service.updateConfig({
        publicEnabled: true,
        ssh: { ...validSsh, password: "" },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("私钥认证缺少私钥路径被拒绝", async () => {
    const { service } = createService({ passwordSet: true });
    await expect(
      service.updateConfig({
        publicEnabled: true,
        ssh: { host: "1.2.3.4", username: "root", authMethod: "privateKey" },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("自定义公网地址非 http(s) 被拒绝", async () => {
    const { service } = createService({ passwordSet: true });
    await expect(
      service.updateConfig({
        publicEnabled: true,
        ssh: { ...validSsh, publicUrl: "ftp://example.com" },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("合法配置保存成功，且密码不回显", async () => {
    const { service, state } = createService({ passwordSet: true });
    const result = await service.updateConfig({
      publicEnabled: true,
      ssh: { ...validSsh, remotePort: 9000 },
    });
    expect(result.publicEnabled).toBe(true);
    expect(result.ssh.host).toBe("1.2.3.4");
    expect((result.ssh as any).passwordEnc).toBeUndefined();
    expect(result.hasPassword).toBe(true);
    expect(state.stored.ssh.passwordEnc).toMatch(/^enc:/);
  });

  it("留空密码表示保持原密文（不回传明文也能保存其他字段）", async () => {
    const { service, state } = createService({ passwordSet: true });
    await service.updateConfig({
      publicEnabled: true,
      ssh: { ...validSsh, remotePort: 9000 },
    });
    const encBefore = state.stored.ssh.passwordEnc;
    await service.updateConfig({
      ssh: { remotePort: 9001 },
    });
    expect(state.stored.ssh.passwordEnc).toBe(encBefore);
    expect(state.stored.ssh.remotePort).toBe(9001);
  });

  it("主机变更时自动清空旧指纹", async () => {
    const { service, state } = createService({ passwordSet: true });
    await service.updateConfig({
      ssh: {
        host: "1.2.3.4",
        username: "root",
        authMethod: "privateKey",
        privateKeyPath: "/tmp/key",
      },
    });
    // 先模拟隧道写入指纹
    state.stored.ssh.hostFingerprint = "sha256:old";
    await service.updateConfig({ ssh: { host: "5.6.7.8" } });
    expect(state.stored.ssh.hostFingerprint).toBe("");
  });
});

describe("MobileAccessService 密码存在时禁止被清除", () => {
  it("isAnyAccessEnabled 反映任一入口开启", async () => {
    const stored: MobileAccessConfig = normalizeMobileAccessConfig({
      lanEnabled: false,
      publicEnabled: true,
      ssh: { host: "1.2.3.4" },
    });
    const { service } = createService({ passwordSet: true, stored: stored as any });
    expect(await service.isAnyAccessEnabled()).toBe(true);
  });

  it("全部关闭时允许清除密码", async () => {
    const { service } = createService({ passwordSet: true });
    expect(await service.isAnyAccessEnabled()).toBe(false);
  });
});
