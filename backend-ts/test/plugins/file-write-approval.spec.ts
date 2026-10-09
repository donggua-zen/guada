/**
 * FilePlugin 工作区外写入审批（模型不能自我提权后的执行语义）。
 *
 * 矩阵：workspace-write 工作区外 → 询问（本次允许 / 本会话内始终允许该路径 / 拒绝）；
 * 工作区内、系统注册路径、danger-full-access → 直接放行；
 * read-only 工作区外 → 直接拒绝；无人应答（子代理/机器人/无连接）→ fail-closed 拒绝。
 * 用真实 WorkspaceService（真实包含性判定）与真实 writeApprovalMemory（用例间 clear），
 * 只有远端路由器与 AskService 是替身。
 */
import { Test, TestingModule } from "@nestjs/testing";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { FilePlugin } from "../../src/modules/plugins/builtins/file.plugin";
import { WorkspaceService } from "../../src/common/services/workspace.service";
import { WorkspaceToolRouter } from "../../src/modules/remote-workspace/workspace-router";
import { AskService } from "../../src/common/services/ask.service";
import {
  WriteApprovalMemory,
  writeApprovalMemory,
} from "../../src/common/services/write-approval-memory";

/** Captures registered tools from PluginApi so tests can invoke execute() */
function capturePluginApi(): any {
  const tools: any[] = [];
  return {
    tools,
    registerTool: (def: any) => tools.push(def),
    registerRawTool: (def: any) => tools.push(def),
    registerPrompt: () => {},
    registerNls: () => {},
    registerToolKit: () => ({
      registerTool: (def: any) => tools.push(def),
      registerRawTool: (def: any) => tools.push(def),
      registerPrompt: () => {},
    }),
    registerCommandProvider: () => {},
  };
}

describe("FilePlugin 工作区外写入审批", () => {
  let plugin: FilePlugin;
  let api: any;
  let workspaceService: WorkspaceService;
  let writeApproval: jest.Mock;
  let tmpDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-write-approval-"));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-write-outside-"));
    writeApprovalMemory.clear();

    writeApproval = jest.fn(async () => "once");

    workspaceService = new WorkspaceService(
      {
        get: (key: string) =>
          key === "WORKSPACE_BASE_DIR" ? path.join(tmpDir, "base") : undefined,
      } as any,
      {} as any,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilePlugin,
        { provide: WorkspaceService, useValue: workspaceService },
        {
          provide: AskService,
          useValue: { requestApproval: jest.fn(), requestWriteApproval: writeApproval },
        },
        {
          provide: WorkspaceToolRouter,
          useValue: { resolveRemoteTarget: async () => null },
        },
      ],
    }).compile();

    plugin = module.get<FilePlugin>(FilePlugin);
    api = capturePluginApi();
    await plugin.onLoad(api);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
    writeApprovalMemory.clear();
  });

  function getTool(name: string) {
    const tool = api.tools.find((t: any) => t.name === name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
    return tool;
  }

  function sessionCtx(
    opts: { sandbox?: string; answerSurface?: boolean } = {},
  ) {
    return {
      session: {
        workspacePath: tmpDir,
        sessionId: "s-write",
        sessionType: "web",
        getSandboxMode: () => opts.sandbox ?? "workspace-write",
        getPathJail: () => null,
        getSettings: () => ({}),
        ...(opts.answerSurface === undefined
          ? {}
          : { hasAnswerSurface: () => opts.answerSurface }),
      },
      toolCallId: "call-1",
    } as any;
  }

  it("工作区内写入：不询问", async () => {
    const result = await getTool("write").execute(
      { file_path: path.join(tmpDir, "a.txt"), content: "x" },
      sessionCtx(),
    );

    expect(result).toContain("File written");
    expect(writeApproval).not.toHaveBeenCalled();
  });

  it("系统注册的安全路径：不询问", async () => {
    workspaceService.registerSafeWritePath(outsideDir);

    const result = await getTool("write").execute(
      { file_path: path.join(outsideDir, "b.txt"), content: "x" },
      sessionCtx(),
    );

    expect(result).toContain("File written");
    expect(writeApproval).not.toHaveBeenCalled();
  });

  it("工作区外写入：询问一次（携带路径/操作/预览），批准后写入", async () => {
    const target = path.join(outsideDir, "c.txt");

    const result = await getTool("write").execute(
      { file_path: target, content: "hello-outside" },
      sessionCtx(),
    );

    expect(result).toContain("File written");
    expect(writeApproval).toHaveBeenCalledTimes(1);
    const params = writeApproval.mock.calls[0][1];
    expect(params.resolvedPath).toBe(path.resolve(target));
    expect(params.operation).toBe("write");
    expect(params.toolName).toBe("write");
    expect(params.preview).toContain("hello-outside");
    expect(await fs.readFile(target, "utf-8")).toBe("hello-outside");
  });

  it("「本会话内始终允许该路径」：同路径只问一次，换路径再问", async () => {
    writeApproval.mockResolvedValue("session");
    const ctx = sessionCtx();
    const same = path.join(outsideDir, "d.txt");

    await getTool("write").execute({ file_path: same, content: "1" }, ctx);
    await getTool("write").execute({ file_path: same, content: "2" }, ctx);
    expect(writeApproval).toHaveBeenCalledTimes(1);

    await getTool("write").execute(
      { file_path: path.join(outsideDir, "e.txt"), content: "3" },
      ctx,
    );
    expect(writeApproval).toHaveBeenCalledTimes(2);
  });

  it("路径记忆按解析后的绝对路径归一（.. 变体命中同一条）", async () => {
    writeApproval.mockResolvedValue("session");
    const ctx = sessionCtx();
    const target = path.join(outsideDir, "f.txt");

    await getTool("write").execute({ file_path: target, content: "1" }, ctx);
    // 等价写法的另一条路径（经 .. 绕一圈）
    const variant = path.join(
      outsideDir,
      "..",
      path.basename(outsideDir),
      "f.txt",
    );
    await getTool("write").execute({ file_path: variant, content: "2" }, ctx);

    expect(writeApproval).toHaveBeenCalledTimes(1);
  });

  it("用户拒绝：抛错且不写入", async () => {
    writeApproval.mockRejectedValueOnce(
      new Error("AskDeniedError: 用户拒绝写入该路径"),
    );
    const target = path.join(outsideDir, "g.txt");

    await expect(
      getTool("write").execute({ file_path: target, content: "x" }, sessionCtx()),
    ).rejects.toThrow(/AskDeniedError/);
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("read-only：工作区外写入直接拒绝，不询问", async () => {
    await expect(
      getTool("write").execute(
        { file_path: path.join(outsideDir, "h.txt"), content: "x" },
        sessionCtx({ sandbox: "read-only" }),
      ),
    ).rejects.toThrow(/Read-only mode/);
    expect(writeApproval).not.toHaveBeenCalled();
  });

  it("danger-full-access：不询问", async () => {
    const target = path.join(outsideDir, "i.txt");

    const result = await getTool("write").execute(
      { file_path: target, content: "x" },
      sessionCtx({ sandbox: "danger-full-access" }),
    );

    expect(result).toContain("File written");
    expect(writeApproval).not.toHaveBeenCalled();
  });

  it("无人应答（子代理/机器人/无连接）：拒绝且不询问，绝不挂起", async () => {
    await expect(
      getTool("write").execute(
        { file_path: path.join(outsideDir, "j.txt"), content: "x" },
        sessionCtx({ answerSurface: false }),
      ),
    ).rejects.toThrow(/approval is unavailable/);
    expect(writeApproval).not.toHaveBeenCalled();
  });

  it("edit 同样走审批（携带 - / + 预览）", async () => {
    const target = path.join(outsideDir, "k.txt");
    await fs.writeFile(target, "old-value", "utf-8");

    const result = await getTool("edit").execute(
      { file_path: target, old_text: "old-value", new_text: "new-value" },
      sessionCtx(),
    );

    expect(result).toContain("modified");
    expect(writeApproval).toHaveBeenCalledTimes(1);
    const params = writeApproval.mock.calls[0][1];
    expect(params.operation).toBe("edit");
    expect(params.preview).toContain("old-value");
    expect(params.preview).toContain("new-value");
  });
});

describe("WriteApprovalMemory", () => {
  it("按解析后的绝对路径记账，按会话隔离", () => {
    const mem = new WriteApprovalMemory();
    mem.remember("s1", path.join("/data", "x", "..", "y", "f.txt"));

    expect(mem.has("s1", path.resolve("/data/y/f.txt"))).toBe(true);
    expect(mem.has("s2", path.resolve("/data/y/f.txt"))).toBe(false);
  });

  it("单会话容量上限：超出后淘汰最早一条", () => {
    const mem = new WriteApprovalMemory();
    for (let i = 0; i < 200; i++) {
      mem.remember("s1", path.resolve(`/data/p${i}.txt`));
    }
    mem.remember("s1", path.resolve("/data/p200.txt"));

    expect(mem.has("s1", path.resolve("/data/p0.txt"))).toBe(false);
    expect(mem.has("s1", path.resolve("/data/p200.txt"))).toBe(true);
  });
});
