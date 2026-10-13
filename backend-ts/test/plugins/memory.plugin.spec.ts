/**
 * MemoryPlugin（prompt-only）注入与旧布局迁移。
 *
 * 记忆 = <workspace>/.guada/memory/MEMORY.md（索引，只注入前 200 行）+ 按需读取的明细文件；
 * 插件不再注册任何工具（写入由 AI 用文件工具完成），索引存在性/截断/迁移在此固化为契约。
 */
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { MemoryPlugin } from "../../src/modules/plugins/builtins/memory.plugin";
import { PluginApi } from "../../src/modules/plugins/api/plugin-api";
import {
  MEMORY_INDEX_FILE,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_INDEX_SOFT_LINES,
  resolveMemoryDir,
} from "../../src/common/utils/memory-path.util";

function capturePluginApi(): PluginApi & {
  tools: any[];
  prompts: Array<{
    frequency: string;
    description: string;
    content?: (ctx: any) => Promise<string>;
  }>;
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

describe("MemoryPlugin", () => {
  let plugin: MemoryPlugin;
  let api: ReturnType<typeof capturePluginApi>;
  let tmpDir: string;
  let memoryDir: string;

  const webCtx = () =>
    ({
      session: { sessionId: "s1", sessionType: "web", workspacePath: tmpDir },
    }) as any;

  const subAgentCtx = () =>
    ({
      session: { sessionId: "sub1", sessionType: "sub_agent", workspacePath: tmpDir },
    }) as any;

  const renderPrompt = (ctx: any = webCtx()) => api.prompts[0].content!(ctx);

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-plugin-test-"));
    memoryDir = path.join(tmpDir, ".guada", "memory");
    plugin = new MemoryPlugin();
    api = capturePluginApi();
    await plugin.onLoad(api as unknown as PluginApi);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeIndex(lines: string[]) {
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(
      path.join(memoryDir, MEMORY_INDEX_FILE),
      lines.join("\n"),
      "utf-8",
    );
  }

  describe("registration", () => {
    it("registers no tools and a single VOLATILE prompt", () => {
      expect(plugin.manifest.id).toBe("memory");
      expect(api.tools).toHaveLength(0);
      expect(api.prompts).toHaveLength(1);
      expect(api.prompts[0].frequency).toBe("VOLATILE");
    });
  });

  describe("index injection", () => {
    it("reports the memory directory and an empty state when the index is missing", async () => {
      const prompt = await renderPrompt();
      expect(prompt).toContain("<memory-index>");
      expect(prompt).toContain("(no memory index yet)");
      expect(prompt).toContain(resolveMemoryDir({ workspacePath: tmpDir, sessionId: "s1" }));
    });

    it("injects the index content and the maintenance guide", async () => {
      await writeIndex([
        "[测试禁 mock](feedback/feedback_testing.md) — 集成测试打真库",
        "[工作区面板](arch/workspace_panel.md) — 树在预览面板内",
      ]);
      const prompt = await renderPrompt();
      expect(prompt).toContain("[测试禁 mock](feedback/feedback_testing.md) — 集成测试打真库");
      expect(prompt).toContain("[工作区面板](arch/workspace_panel.md) — 树在预览面板内");
      expect(prompt).toContain("# Memory Maintenance");
      expect(prompt).toContain("Keep the index under");
    });

    it(`injects only the first ${MEMORY_INDEX_MAX_LINES} lines and reports the overflow`, async () => {
      const total = MEMORY_INDEX_MAX_LINES + 50;
      await writeIndex(
        Array.from({ length: total }, (_, i) => `line-${i + 1}`),
      );
      const prompt = await renderPrompt();
      expect(prompt).toContain(`line-${MEMORY_INDEX_MAX_LINES}`);
      expect(prompt).not.toContain(`line-${MEMORY_INDEX_MAX_LINES + 1}`);
      expect(prompt).toContain(`${total} lines`);
      expect(prompt).toContain(`only the first ${MEMORY_INDEX_MAX_LINES}`);
    });

    it(`exactly ${MEMORY_INDEX_MAX_LINES} lines plus a trailing newline is NOT reported as overflow`, async () => {
      // 行数口径（countIndexLines）忽略末尾单个换行：否则"正好 200 行"会被算成 201 行
      await fs.mkdir(memoryDir, { recursive: true });
      await fs.writeFile(
        path.join(memoryDir, MEMORY_INDEX_FILE),
        Array.from({ length: MEMORY_INDEX_MAX_LINES }, (_, i) => `line-${i + 1}`).join("\n") + "\n",
        "utf-8",
      );
      const prompt = await renderPrompt();
      expect(prompt).toContain(`line-${MEMORY_INDEX_MAX_LINES}`);
      expect(prompt).not.toContain("only the first");
    });

    it("reports the soft cap once the index passes it but stays under the hard cap", async () => {
      await writeIndex(
        Array.from({ length: MEMORY_INDEX_SOFT_LINES + 10 }, (_, i) => `line-${i + 1}`),
      );
      const prompt = await renderPrompt();
      expect(prompt).toContain("soft cap");
      expect(prompt).not.toContain("only the first");
    });

    it("normalizes CRLF indexes", async () => {
      await fs.mkdir(memoryDir, { recursive: true });
      await fs.writeFile(
        path.join(memoryDir, MEMORY_INDEX_FILE),
        "a — 1\r\nb — 2\r\n",
        "utf-8",
      );
      const prompt = await renderPrompt();
      expect(prompt).toContain("a — 1\nb — 2");
      expect(prompt).not.toContain("\r");
    });

    it("reads the isolated index of a sub-agent session", async () => {
      const subDir = resolveMemoryDir({
        workspacePath: tmpDir,
        sessionId: "sub1",
        sessionType: "sub_agent",
      });
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(path.join(subDir, MEMORY_INDEX_FILE), "sub only", "utf-8");

      const prompt = await renderPrompt(subAgentCtx());
      expect(prompt).toContain("sub only");
      expect(prompt).toContain(subDir);
      // 主会话索引不参与子智能体注入
      expect(prompt).not.toContain(memoryDir + path.sep + MEMORY_INDEX_FILE);
    });
  });

  describe("legacy layout migration", () => {
    it("migrates factual.md + memos into the new layout without deleting the originals", async () => {
      await fs.mkdir(memoryDir, { recursive: true });
      await fs.writeFile(
        path.join(memoryDir, "factual.md"),
        "用户偏好：中文回答",
        "utf-8",
      );
      await fs.mkdir(path.join(tmpDir, ".guada", "memos"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, ".guada", "memos", "架构决策.md"),
        "内容",
        "utf-8",
      );

      const prompt = await renderPrompt();
      const index = await fs.readFile(path.join(memoryDir, MEMORY_INDEX_FILE), "utf-8");

      expect(index).toContain("[历史事实记忆（迁移）](notes/legacy_factual.md)");
      expect(index).toContain("[架构决策](memos/架构决策.md) — ");
      // 迁移结果同时注入上下文
      expect(prompt).toContain("[架构决策](memos/架构决策.md) — ");
      // 明细已复制，原文件保留
      expect(
        await fs.readFile(path.join(memoryDir, "notes", "legacy_factual.md"), "utf-8"),
      ).toBe("用户偏好：中文回答");
      expect(
        await fs.readFile(path.join(memoryDir, "memos", "架构决策.md"), "utf-8"),
      ).toBe("内容");
      expect(await fs.readFile(path.join(memoryDir, "factual.md"), "utf-8")).toBe(
        "用户偏好：中文回答",
      );
    });

    it("is idempotent across repeated prompt builds", async () => {
      await fs.mkdir(memoryDir, { recursive: true });
      await fs.writeFile(path.join(memoryDir, "factual.md"), "旧内容", "utf-8");

      await renderPrompt();
      const first = await fs.readFile(path.join(memoryDir, MEMORY_INDEX_FILE), "utf-8");
      await renderPrompt();
      const second = await fs.readFile(path.join(memoryDir, MEMORY_INDEX_FILE), "utf-8");

      expect(second).toBe(first);
      expect(second.match(/legacy_factual\.md/g)).toHaveLength(1);
    });

    it("never overwrites an index the AI or user already wrote", async () => {
      await fs.mkdir(memoryDir, { recursive: true });
      await fs.writeFile(path.join(memoryDir, "factual.md"), "旧内容", "utf-8");
      await writeIndex(["[手写](hand.md) — 保留我"]);

      await renderPrompt();
      const index = await fs.readFile(path.join(memoryDir, MEMORY_INDEX_FILE), "utf-8");
      expect(index).toBe("[手写](hand.md) — 保留我");
    });

    it("does not create an index when there is no legacy data", async () => {
      await renderPrompt();
      await expect(
        fs.access(path.join(memoryDir, MEMORY_INDEX_FILE)),
      ).rejects.toThrow();
    });
  });
});
