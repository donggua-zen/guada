import {
  assertDirInCliEnv,
  ensureAgentInCliEnv,
  parseAgentVersionOutput,
  type CliAgentEnv,
} from "./cli-agent-install";

/**
 * cli-agent-install 共享内核测试：用内存假环境驱动候选目录探测、
 * stdio 版本下限门禁（≥0.6.0）、注入后复验与失败聚合。
 * Docker / WSL 两条链路都走这份逻辑，因此此处覆盖即同时保护两者。
 */
jest.mock("./agent-deploy", () => ({
  ensureLocalBinary: jest.fn(),
  fetchLatestVersion: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { ensureLocalBinary, fetchLatestVersion } from "./agent-deploy";

const mockLocalBinary = ensureLocalBinary as jest.MockedFunction<typeof ensureLocalBinary>;
const mockLatest = fetchLatestVersion as jest.MockedFunction<typeof fetchLatestVersion>;

const AGENT = "guada-agent";

interface FakeEnvOptions {
  /** 预置二进制：binaryPath → version */
  existing?: Record<string, string>;
  /** 不可写的安装目录 */
  readOnlyDirs?: string[];
  /** 注入后 `<bin> --version` 能读到的版本（模拟注入内容） */
  injectVersion?: string;
  /** 注入抛错 */
  injectError?: string;
}

function makeFakeEnv(dirCandidates: string[], options: FakeEnvOptions = {}) {
  const files = new Map<string, string>(Object.entries(options.existing || {}));
  const readOnly = new Set(options.readOnlyDirs || []);
  const calls: { injected: string[]; killed: number; versions: string[] } = {
    injected: [],
    killed: 0,
    versions: [],
  };
  const env: CliAgentEnv = {
    noun: "目标",
    targetRef: "'t1'",
    installErrorPrefix: "无法在目标 't1' 内安装 agent",
    unsupportedHint: "SUPPORT_HINT",
    dirMissingHint: "DIR_HINT",
    exec: async (args) => {
      const [cmd, ...rest] = args;
      if (cmd === "sh" && rest[0] === "-c") {
        const mk = /^mkdir -p '(.+)'$/.exec(rest[1]);
        if (mk) {
          if (readOnly.has(mk[1])) {
            return { code: 1, stdout: "", stderr: "mkdir: can't create directory: Read-only file system" };
          }
          return { code: 0, stdout: "", stderr: "" };
        }
        return { code: 0, stdout: "OK\n", stderr: "" };
      }
      if (rest[0] === "--version") {
        calls.versions.push(cmd);
        const v = files.get(cmd);
        return v ? { code: 0, stdout: `${v}\n`, stderr: "" } : { code: 127, stdout: "", stderr: "not found" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    agentDirCandidates: () => dirCandidates,
    injectBinary: async (_localPath, destPath) => {
      if (options.injectError) throw new Error(options.injectError);
      calls.injected.push(destPath);
      if (options.injectVersion) files.set(destPath, options.injectVersion);
    },
    killStaleAgents: async () => {
      calls.killed++;
    },
    openAgentStdio: () => {
      throw new Error("not used in this spec");
    },
  };
  return { env, calls, files };
}

describe("parseAgentVersionOutput", () => {
  it("提取首行版本号", () => {
    expect(parseAgentVersionOutput("0.6.0\n")).toBe("0.6.0");
    expect(parseAgentVersionOutput("  0.6.1  \nnoise")).toBe("0.6.1");
  });

  it("非版本输出视为不可用（空串）", () => {
    expect(parseAgentVersionOutput("")).toBe("");
    expect(parseAgentVersionOutput("sh: command not found")).toBe("");
    expect(parseAgentVersionOutput("v0.6.0")).toBe(""); // 严格数字段起始
  });
});

describe("ensureAgentInCliEnv", () => {
  beforeEach(() => {
    mockLocalBinary.mockReset();
    mockLatest.mockReset();
    mockLocalBinary.mockResolvedValue("/local/guada-agent-linux-amd64");
  });

  it("已有满足下限且版本匹配的二进制 → 复用（不下载不注入）", async () => {
    const { env, calls } = makeFakeEnv(["/tmp/.guada-agent"], {
      existing: { "/tmp/.guada-agent/guada-agent": "0.6.0" },
    });
    const r = await ensureAgentInCliEnv(env, "amd64", { latestVersionUrl: "" });
    expect(r).toMatchObject({ version: "0.6.0", injected: false, agentDir: "/tmp/.guada-agent" });
    expect(calls.injected).toHaveLength(0);
    expect(mockLocalBinary).not.toHaveBeenCalled();
  });

  it("目标内为低于下限的旧版（0.5.1）→ 重新注入并复验", async () => {
    const { env, calls } = makeFakeEnv(["/tmp/.guada-agent"], {
      existing: { "/tmp/.guada-agent/guada-agent": "0.5.1" },
      injectVersion: "0.6.0",
    });
    const r = await ensureAgentInCliEnv(env, "amd64", {});
    expect(r.injected).toBe(true);
    expect(r.version).toBe("0.6.0");
    expect(calls.injected).toEqual(["/tmp/.guada-agent/guada-agent"]);
    expect(r.log.join("\n")).toContain("predates stdio support");
  });

  it("已有低版本但 latest 指向同版本（0.5.1）→ 也不复用（下限优先）", async () => {
    const { env } = makeFakeEnv(["/tmp/.guada-agent"], {
      existing: { "/tmp/.guada-agent/guada-agent": "0.5.1" },
      injectVersion: "0.6.0",
    });
    mockLatest.mockResolvedValue({ version: "0.5.1", url: "" } as any);
    const r = await ensureAgentInCliEnv(env, "amd64", { latestVersionUrl: "https://x/latest.json" });
    expect(r.injected).toBe(true);
    expect(r.version).toBe("0.6.0");
  });

  it("latest 低于下限 → 忽略该版本，走本地缓存（不给 ensureLocalBinary 传 latest）", async () => {
    const { env } = makeFakeEnv(["/tmp/.guada-agent"], { injectVersion: "0.6.0" });
    mockLatest.mockResolvedValue({ version: "0.4.5", url: "" } as any);
    const r = await ensureAgentInCliEnv(env, "arm64", {
      latestVersionUrl: "https://x/latest.json",
    });
    expect(mockLocalBinary).toHaveBeenCalled();
    const call = mockLocalBinary.mock.calls[0];
    expect(call[0]).toBe("linux");
    expect(call[1]).toBe("arm64");
    expect(call[3]).toBeUndefined(); // latestVersionUrl 被下限过滤
    expect(r.log.join("\n")).toContain("older than the required minimum");
  });

  it("latest 检查失败 → 容忍（不阻塞）并继续本地缓存", async () => {
    const { env } = makeFakeEnv(["/tmp/.guada-agent"], { injectVersion: "0.6.0" });
    mockLatest.mockRejectedValue(new Error("network down"));
    const r = await ensureAgentInCliEnv(env, "amd64", { latestVersionUrl: "https://x/latest.json" });
    expect(r.version).toBe("0.6.0");
    expect(r.log.join("\n")).toContain("Latest version check failed (ignored)");
  });

  it("候选目录不可写 → 逐目录记录错误并给出聚合错误（含提示尾行）", async () => {
    const { env } = makeFakeEnv(["/tmp/.guada-agent", "/var/tmp/.guada-agent"], {
      readOnlyDirs: ["/tmp/.guada-agent", "/var/tmp/.guada-agent"],
    });
    await expect(ensureAgentInCliEnv(env, "amd64", {})).rejects.toThrow(
      /无法在目标 't1' 内安装 agent（已尝试 \/tmp\/\.guada-agent、\/var\/tmp\/\.guada-agent）[\s\S]*Read-only file system[\s\S]*SUPPORT_HINT/,
    );
  });

  it("注入后无法执行（noexec 等）→ 继续下一候选，全部失败后报错", async () => {
    const { env } = makeFakeEnv(["/tmp/.guada-agent", "/dev/shm/.guada-agent"], {
      injectVersion: "", // 注入后 --version 仍不可读
    });
    await expect(ensureAgentInCliEnv(env, "amd64", {})).rejects.toThrow(/注入后无法执行/);
  });

  it("注入抛错 → 归入该候选错误并继续（下一候选可用则成功）", async () => {
    const { env } = makeFakeEnv(["/tmp/.guada-agent"], { injectError: "cp failed" });
    await expect(ensureAgentInCliEnv(env, "amd64", {})).rejects.toThrow(/cp failed/);
  });

  it("注入前调用 killStaleAgents（若适配器提供）", async () => {
    const { env, calls } = makeFakeEnv(["/tmp/.guada-agent"], { injectVersion: "0.6.0" });
    await ensureAgentInCliEnv(env, "amd64", {});
    expect(calls.killed).toBe(1);
  });
});

describe("assertDirInCliEnv", () => {
  it("目录存在 → 通过", async () => {
    const { env } = makeFakeEnv(["/tmp/.guada-agent"]);
    await expect(assertDirInCliEnv(env, "/workspace")).resolves.toBeUndefined();
  });

  it("目录不存在 → 报错包含名词与目录提示", async () => {
    const env: CliAgentEnv = {
      ...makeFakeEnv(["/tmp/.guada-agent"]).env,
      exec: async () => ({ code: 0, stdout: "MISSING\n", stderr: "" }),
    };
    await expect(assertDirInCliEnv(env, "/nope")).rejects.toThrow(
      /目标内工作目录不存在：\/nope — DIR_HINT/,
    );
  });
});
