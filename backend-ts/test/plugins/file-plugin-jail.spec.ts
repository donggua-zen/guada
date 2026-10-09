/**
 * FilePlugin 路径牢笼（setPathJail）执行语义。
 *
 * 影子轮次等系统级写入把文件工具收窄到单一根目录：读/写/编辑/glob/grep 一律受限，
 * 且牢笼内写入不受只读安全模式限制；牢笼解除后安全模式行为原样恢复。
 * 用真实 WorkspaceService（含真实 isPathWithin 包含性判断），只有远端路由器与审批是替身。
 */
import { Test, TestingModule } from "@nestjs/testing";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { FilePlugin } from "../../src/modules/plugins/builtins/file.plugin";
import { WorkspaceService } from "../../src/common/services/workspace.service";
import { WorkspaceToolRouter } from "../../src/modules/remote-workspace/workspace-router";
import { AskService } from "../../src/common/services/ask.service";
import { PluginApi } from "../../src/modules/plugins/api/plugin-api";

/** Captures registered tools from PluginApi so tests can invoke execute() */
function capturePluginApi(): PluginApi & {
  tools: Array<{
    name: string;
    execute: (args: any, ctx?: any) => Promise<any>;
  }>;
  prompts: Array<{ frequency: string; description: string }>;
} {
  const tools: any[] = [];
  const prompts: any[] = [];
  return {
    tools,
    prompts,
    registerTool: (def: any) => tools.push(def),
    registerRawTool: (def: any) => tools.push(def),
    registerPrompt: (def: any) => prompts.push(def),
    registerNls: () => {},
    registerToolKit: () => ({
      registerTool: (def: any) => tools.push(def),
      registerRawTool: (def: any) => tools.push(def),
      registerPrompt: (def: any) => prompts.push(def),
    }),
    registerCommandProvider: () => {},
  } as any;
}

describe("FilePlugin path jail", () => {
  let plugin: FilePlugin;
  let api: ReturnType<typeof capturePluginApi>;
  let workspaceService: WorkspaceService;
  let approve: jest.Mock;
  let writeApproval: jest.Mock;
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-jail-test-"));
    memoryDir = path.join(tmpDir, ".guada", "memory");
    await fs.mkdir(memoryDir, { recursive: true });

    // 牢笼模式与工作区内写入都不得唤起用户审批（哨兵：被调用即失败）
    approve = jest.fn(() => {
      throw new Error("approval must not be requested in jail mode");
    });
    writeApproval = jest.fn(() => {
      throw new Error("write approval must not be requested here");
    });
    workspaceService = new WorkspaceService(
      { get: (key: string) => (key === "WORKSPACE_BASE_DIR" ? path.join(tmpDir, "base") : undefined) } as any,
      {} as any,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilePlugin,
        { provide: WorkspaceService, useValue: workspaceService },
        {
          provide: AskService,
          useValue: { requestApproval: approve, requestWriteApproval: writeApproval },
        },
        {
          provide: WorkspaceToolRouter,
          useValue: {
            resolveRemoteTarget: (workspace?: string) =>
              Promise.resolve(
                workspace && !["", "main", "local"].includes(workspace)
                  ? { connectionName: workspace, basePath: "/remote", provider: {} }
                  : null,
              ),
          },
        },
      ],
    }).compile();

    plugin = module.get<FilePlugin>(FilePlugin);
    api = capturePluginApi();
    await plugin.onLoad(api as unknown as PluginApi);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function getTool(name: string) {
    const tool = api.tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool "${name}" not registered`);
    return tool;
  }

  function sessionCtx(opts: { jail?: string | null; sandbox?: string } = {}) {
    const jail = opts.jail === undefined ? memoryDir : opts.jail;
    return {
      session: {
        workspacePath: tmpDir,
        sessionId: "s1",
        sessionType: "web",
        getSandboxMode: () => opts.sandbox ?? "read-only",
        getPathJail: () => jail,
        getSettings: () => ({}),
      },
    } as any;
  }

  async function writeFile(fullPath: string, content: string) {
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
    return fullPath;
  }

  // ── 包含性判断（isPathWithin 抽取后的边界语义） ──

  describe("isPathWithin", () => {
    it("accepts the root itself and its descendants", () => {
      expect(workspaceService.isPathWithin(memoryDir, [memoryDir])).toBe(true);
      expect(
        workspaceService.isPathWithin(path.join(memoryDir, "a", "b.md"), [memoryDir]),
      ).toBe(true);
    });

    it("rejects sibling paths sharing a name prefix", () => {
      expect(workspaceService.isPathWithin(memoryDir + "x", [memoryDir])).toBe(false);
    });

    it("rejects traversal out of the root", () => {
      expect(
        workspaceService.isPathWithin(path.join(memoryDir, "..", "elsewhere"), [memoryDir]),
      ).toBe(false);
    });
  });

  // ── read ──

  describe("read", () => {
    it("reads inside the jail", async () => {
      const fp = await writeFile(path.join(memoryDir, "MEMORY.md"), "hello");
      const result = await getTool("read").execute({ file_path: fp }, sessionCtx());
      expect(result).toContain("hello");
    });

    it("rejects an absolute path outside the jail", async () => {
      const outside = await writeFile(path.join(tmpDir, "outside.txt"), "secret");
      await expect(
        getTool("read").execute({ file_path: outside }, sessionCtx()),
      ).rejects.toThrow(/Path jail active/);
    });

    it("rejects a relative traversal out of the jail", async () => {
      await expect(
        getTool("read").execute(
          { file_path: path.join("..", "..", "outside.txt") },
          sessionCtx(),
        ),
      ).rejects.toThrow(/Path jail active/);
    });
  });

  // ── write ──

  describe("write", () => {
    it("allows writes inside the jail even in a read-only session", async () => {
      const result = await getTool("write").execute(
        { file_path: path.join(memoryDir, "notes", "new.md"), content: "content" },
        sessionCtx({ sandbox: "read-only" }),
      );
      expect(result).toContain("File written");
      const written = await fs.readFile(path.join(memoryDir, "notes", "new.md"), "utf-8");
      expect(written).toBe("content");
    });

    it("accepts a working-directory-relative path that lands inside the jail", async () => {
      const result = await getTool("write").execute(
        {
          file_path: path.join(".guada", "memory", "relative.md"),
          content: "x",
        },
        sessionCtx({ sandbox: "read-only" }),
      );
      expect(result).toContain("File written");
      await expect(
        fs.readFile(path.join(memoryDir, "relative.md"), "utf-8"),
      ).resolves.toBe("x");
    });

    it("rejects writes outside the jail", async () => {
      await expect(
        getTool("write").execute(
          { file_path: path.join(tmpDir, "project.txt"), content: "x" },
          sessionCtx(),
        ),
      ).rejects.toThrow(/Path jail active/);
      await expect(fs.access(path.join(tmpDir, "project.txt"))).rejects.toThrow();
    });

    it("rejects a relative path that resolves outside the jail", async () => {
      // 相对路径按工作目录解析（牢笼只收窄可用面，不改变路径语义）
      await expect(
        getTool("write").execute(
          { file_path: "notes/new.md", content: "x" },
          sessionCtx(),
        ),
      ).rejects.toThrow(/Path jail active/);
    });

    it("does not request user approval for writes inside the jail (system flow)", async () => {
      const result = await getTool("write").execute(
        { file_path: path.join(memoryDir, "escalated.md"), content: "x" },
        sessionCtx({ sandbox: "read-only" }),
      );
      expect(result).toContain("File written");
      expect(approve).not.toHaveBeenCalled();
      expect(writeApproval).not.toHaveBeenCalled();
    });
  });

  // ── edit ──

  describe("edit", () => {
    it("edits inside the jail", async () => {
      await writeFile(path.join(memoryDir, "MEMORY.md"), "a — b");
      const result = await getTool("edit").execute(
        { file_path: path.join(memoryDir, "MEMORY.md"), old_text: "b", new_text: "c" },
        sessionCtx(),
      );
      expect(result).toContain("modified");
    });

    it("rejects edits outside the jail", async () => {
      const outside = await writeFile(path.join(tmpDir, "code.ts"), "const a = 1;");
      await expect(
        getTool("edit").execute(
          { file_path: outside, old_text: "1", new_text: "2" },
          sessionCtx(),
        ),
      ).rejects.toThrow(/Path jail active/);
    });
  });

  // ── grep ──

  describe("grep", () => {
    it("searches inside the jail", async () => {
      await writeFile(path.join(memoryDir, "MEMORY.md"), "needle here");
      const result = await getTool("grep").execute(
        { pattern: "needle", path: memoryDir },
        sessionCtx(),
      );
      expect(result).toContain("needle");
    });

    it("rejects a search root outside the jail", async () => {
      await expect(
        getTool("grep").execute({ pattern: "x", path: tmpDir }, sessionCtx()),
      ).rejects.toThrow(/Path jail active/);
    });
  });

  // ── glob ──

  describe("glob", () => {
    beforeEach(async () => {
      await writeFile(path.join(memoryDir, "feedback", "a.md"), "");
      await writeFile(path.join(tmpDir, "project.ts"), "");
    });

    it("defaults its base directory to the jail root", async () => {
      const result = await getTool("glob").execute(
        { pattern: "**/*.md" },
        sessionCtx(),
      );
      expect(result).toContain("a.md");
      expect(result).not.toContain("project.ts");
    });

    it("rejects a pattern containing traversal", async () => {
      await expect(
        getTool("glob").execute({ pattern: "../**/*.ts" }, sessionCtx()),
      ).rejects.toThrow(/Path jail active/);
    });

    it("rejects an absolute pattern", async () => {
      await expect(
        getTool("glob").execute({ pattern: path.join(tmpDir, "**/*.ts") }, sessionCtx()),
      ).rejects.toThrow(/Path jail active/);
    });

    it("rejects an explicit directory outside the jail", async () => {
      await expect(
        getTool("glob").execute({ pattern: "**/*.ts", directory: tmpDir }, sessionCtx()),
      ).rejects.toThrow(/Path jail active/);
    });
  });

  // ── 远程工作目录 ──

  describe("remote workspaces", () => {
    it("rejects a remote workspace target while jailed", async () => {
      await expect(
        getTool("read").execute(
          { file_path: "MEMORY.md", workspace: "my-ssh" },
          sessionCtx(),
        ),
      ).rejects.toThrow(/remote workspaces are not accessible/);
    });
  });

  // ── 牢笼解除后安全模式行为原样恢复 ──

  describe("sandbox behavior without a jail", () => {
    it("still denies writes in a read-only session", async () => {
      await expect(
        getTool("write").execute(
          { file_path: "project.txt", content: "x" },
          sessionCtx({ jail: null, sandbox: "read-only" }),
        ),
      ).rejects.toThrow(/Read-only mode/);
    });

    it("allows memory writes in a read-only session (memory is app state, not project files)", async () => {
      const result = await getTool("write").execute(
        { file_path: path.join(".guada", "memory", "MEMORY.md"), content: "x" },
        sessionCtx({ jail: null, sandbox: "read-only" }),
      );
      expect(result).toContain("File written");
      // 只读例外只覆盖记忆目录，项目文件仍然拒绝
      await expect(
        getTool("write").execute(
          { file_path: path.join(tmpDir, "src", "app.ts"), content: "x" },
          sessionCtx({ jail: null, sandbox: "read-only" }),
        ),
      ).rejects.toThrow(/Read-only mode/);
    });

    it("asks the user for writes outside the workspace root, then writes when approved", async () => {
      const outside = path.join(tmpDir, "..", "escaped-approved.txt");
      writeApproval.mockResolvedValueOnce("once");

      const result = await getTool("write").execute(
        { file_path: path.join(tmpDir, "..", "escaped-approved.txt"), content: "x" },
        sessionCtx({ jail: null, sandbox: "workspace-write" }),
      );

      expect(result).toContain("File written");
      expect(writeApproval).toHaveBeenCalledTimes(1);
      expect(writeApproval.mock.calls[0][1].resolvedPath).toBe(path.resolve(outside));
      await fs.rm(outside, { force: true });
    });

    it("does not write outside the workspace when the user denies", async () => {
      const outside = path.join(tmpDir, "..", "escaped-denied.txt");
      writeApproval.mockRejectedValueOnce(
        new Error("AskDeniedError: 用户拒绝写入该路径"),
      );

      await expect(
        getTool("write").execute(
          { file_path: path.join(tmpDir, "..", "escaped-denied.txt"), content: "x" },
          sessionCtx({ jail: null, sandbox: "workspace-write" }),
        ),
      ).rejects.toThrow(/AskDeniedError/);
      await expect(fs.access(outside)).rejects.toThrow();
    });

    it("allows writes inside the workspace root", async () => {
      const result = await getTool("write").execute(
        { file_path: "project.txt", content: "x" },
        sessionCtx({ jail: null, sandbox: "workspace-write" }),
      );
      expect(result).toContain("File written");
    });
  });
});
