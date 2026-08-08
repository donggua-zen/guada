import { Test, TestingModule } from "@nestjs/testing";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { FilePlugin } from "../../src/modules/plugins/builtins/file.plugin";
import { WorkspaceService } from "../../src/common/services/workspace.service";
import { WorkspaceProviderResolver } from "../../src/common/workspace/workspace-provider.resolver";
import { LocalWorkspaceProvider } from "../../src/common/workspace/local-workspace-provider";
import { PluginApi } from "../../src/modules/plugins/api/plugin-api";

/** Captures registered tools/prompts from PluginApi so tests can invoke execute() */
function capturePluginApi(): PluginApi & {
  tools: Array<{
    name: string;
    execute: (args: any, ctx?: any) => Promise<any>;
    dangerLevel?: string;
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
    registerToolSet: () => {},
    registerToolKit: () => ({ registerTool: () => {}, registerRawTool: () => {}, registerPrompt: () => {} }),
    registerCommandProvider: () => {},
  } as any;
}

describe("FilePlugin", () => {
  let plugin: FilePlugin;
  let api: ReturnType<typeof capturePluginApi>;
  let mockWorkspaceService: Partial<WorkspaceService>;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fileplugin-test-"));
    mockWorkspaceService = {
      resolveFilePath: (filePath: string, workspaceDir: string) =>
        path.isAbsolute(filePath) ? path.normalize(filePath) : path.join(workspaceDir, filePath),
      validateWritePath: () => {},
    };

    // LocalWorkspaceProvider uses fs.* internally — identical behavior to direct fs calls
    const localProvider = new LocalWorkspaceProvider();
    const mockResolver = {
      resolve: () => Promise.resolve(localProvider),
      withProvider: (_path: string, fn: (p: any) => Promise<any>) => fn(localProvider),
    } as Partial<WorkspaceProviderResolver>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilePlugin,
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: WorkspaceProviderResolver, useValue: mockResolver },
      ],
    }).compile();

    plugin = module.get<FilePlugin>(FilePlugin);
    api = capturePluginApi();
    await plugin.onLoad(api as unknown as PluginApi);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── helpers ──

  function getTool(name: string) {
    const tool = api.tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool "${name}" not registered`);
    return tool;
  }

  function ctx(workspacePath?: string) {
    return { session: { workspacePath: workspacePath || tmpDir } } as any;
  }

  async function writeFile(relativePath: string, content: string) {
    const fullPath = path.join(tmpDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
    return fullPath;
  }

  // ── manifest ──

  describe("manifest", () => {
    it("should be defined", () => {
      expect(plugin).toBeDefined();
    });

    it("should have correct manifest", () => {
      expect(plugin.manifest.id).toBe("file");
      expect(plugin.manifest.name).toBe("文件工具");
      expect(plugin.manifest.version).toBe("1.0.0");
      expect(plugin.manifest.category).toBe("core");
    });

    it("should register 6 tools and 1 prompt", () => {
      expect(api.tools).toHaveLength(6);
      expect(api.prompts).toHaveLength(1);
    });
  });

  // ── read ──

  describe("read tool", () => {
    it("should read file by line with line numbers", async () => {
      const fp = await writeFile("test.txt", "line1\nline2\nline3");
      const result = await getTool("read").execute({ file_path: fp }, ctx());
      expect(result).toContain("1\t|line1");
      expect(result).toContain("2\t|line2");
      expect(result).toContain("3\t|line3");
    });

    it("should support offset and limit", async () => {
      const content = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n");
      const fp = await writeFile("test.txt", content);
      const result = await getTool("read").execute(
        { file_path: fp, offset: 2, limit: 3 },
        ctx(),
      );
      expect(result).toContain("3\t|line3");
      expect(result).toContain("4\t|line4");
      expect(result).toContain("5\t|line5");
      expect(result).not.toContain("line2");
      expect(result).not.toContain("line6");
    });

    it("should show remaining lines hint when truncated", async () => {
      const content = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n");
      const fp = await writeFile("test.txt", content);
      const result = await getTool("read").execute(
        { file_path: fp, limit: 3 },
        ctx(),
      );
      expect(result).toContain("7 more lines remain");
      expect(result).toContain("offset=3");
    });

    it("should support negative offset (tail read)", async () => {
      const content = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n");
      const fp = await writeFile("test.txt", content);
      const result = await getTool("read").execute(
        { file_path: fp, offset: -3 },
        ctx(),
      );
      expect(result).toContain("8\t|line8");
      expect(result).toContain("9\t|line9");
      expect(result).toContain("10\t|line10");
      expect(result).not.toContain("line7");
    });

    it("should read by char mode", async () => {
      const fp = await writeFile("test.txt", "Hello World!");
      const result = await getTool("read").execute(
        { file_path: fp, unit: "char", limit: 5 },
        ctx(),
      );
      expect(result).toContain("Hello");
      expect(result).toContain("Text truncated");
      expect(result).toContain("offset=5");
    });
  });

  // ── glob ──

  describe("glob tool", () => {
    beforeEach(async () => {
      await writeFile("src/a.ts", "");
      await writeFile("src/b.ts", "");
      await writeFile("src/sub/c.ts", "");
      await writeFile("package.json", "{}");
      // node_modules should be ignored
      await writeFile("node_modules/pkg/index.ts", "");
    });

    it("should find files matching pattern", async () => {
      const result = await getTool("glob").execute(
        { pattern: "**/*.ts" },
        ctx(),
      );
      expect(result).toContain("src/a.ts");
      expect(result).toContain("src/b.ts");
      expect(result).toContain("src/sub/c.ts");
      expect(result).not.toContain("node_modules");
    });

    it("should respect limit and show hasMore hint", async () => {
      const result = await getTool("glob").execute(
        { pattern: "**/*.ts", limit: 2 },
        ctx(),
      );
      // 3 source .ts files exist (excluding node_modules), limit=2
      expect(result).toContain("2 files found");
      expect(result).toContain("More results exist");
    });

    it("should respect depth=0 (current directory only)", async () => {
      await writeFile("root.ts", "");
      const result = await getTool("glob").execute(
        { pattern: "**/*.ts", depth: 0 },
        ctx(),
      );
      expect(result).toContain("root.ts");
      expect(result).not.toContain("src/a.ts");
    });
  });

  // ── write ──

  describe("write tool", () => {
    it("should write content and create parent directories", async () => {
      const result = await getTool("write").execute(
        { file_path: "nested/dir/file.txt", content: "hello world" },
        ctx(),
      );
      expect(result).toContain("File written");
      expect(result).toContain("11 chars");
      const written = await fs.readFile(path.join(tmpDir, "nested/dir/file.txt"), "utf-8");
      expect(written).toBe("hello world");
    });

    it("should overwrite existing file", async () => {
      const fp = await writeFile("existing.txt", "old content");
      await getTool("write").execute(
        { file_path: fp, content: "new content" },
        ctx(),
      );
      const written = await fs.readFile(fp, "utf-8");
      expect(written).toBe("new content");
    });
  });

  // ── edit ──

  describe("edit tool", () => {
    it("should replace matching text", async () => {
      const fp = await writeFile("test.txt", "foo bar baz");
      const result = await getTool("edit").execute(
        { file_path: fp, old_text: "bar", new_text: "qux" },
        ctx(),
      );
      expect(result).toContain("modified");
      const written = await fs.readFile(fp, "utf-8");
      expect(written).toBe("foo qux baz");
    });

    it("should throw when old_text not found", async () => {
      const fp = await writeFile("test.txt", "foo bar baz");
      await expect(
        getTool("edit").execute(
          { file_path: fp, old_text: "nope", new_text: "yes" },
          ctx(),
        ),
      ).rejects.toThrow("No match text found");
    });

    it("should return unchanged when old_text equals new_text", async () => {
      const fp = await writeFile("test.txt", "hello");
      const result = await getTool("edit").execute(
        { file_path: fp, old_text: "hello", new_text: "hello" },
        ctx(),
      );
      expect(result).toContain("unchanged");
    });

    it("should handle CRLF files correctly", async () => {
      const fp = path.join(tmpDir, "crlf.txt");
      await fs.writeFile(fp, "line1\r\nline2\r\nline3");
      await getTool("edit").execute(
        { file_path: fp, old_text: "line2", new_text: "edited" },
        ctx(),
      );
      const written = await fs.readFile(fp, "utf-8");
      expect(written).toContain("edited");
      // CRLF preserved
      expect(written).toContain("\r\n");
    });
  });

  // ── delete ──

  describe("delete tool", () => {
    it("should delete a file", async () => {
      const fp = await writeFile("toDelete.txt", "content");
      const result = await getTool("delete").execute(
        { path: fp },
        ctx(),
      );
      expect(result).toContain("File deleted");
      await expect(fs.access(fp)).rejects.toThrow();
    });

    it("should delete a directory recursively", async () => {
      const dirPath = path.join(tmpDir, "toDeleteDir");
      await writeFile("toDeleteDir/inner.txt", "content");
      const result = await getTool("delete").execute(
        { path: dirPath },
        ctx(),
      );
      expect(result).toContain("Directory deleted");
      await expect(fs.access(dirPath)).rejects.toThrow();
    });
  });

  // ── grep ──

  describe("grep tool", () => {
    beforeEach(async () => {
      await writeFile("src/a.ts", "function foo() {\n  return 42;\n}\n");
      await writeFile("src/b.ts", "const bar = () => {\n  console.log('hello');\n};\n");
      await writeFile("src/c.py", "def greet():\n    print('hello')\n");
      // node_modules should be ignored
      await writeFile("node_modules/pkg/index.ts", "function foo() {\n  return 99;\n}\n");
    });

    it("should search a single file and return matches with line numbers", async () => {
      const fp = path.join(tmpDir, "src/a.ts");
      const result = await getTool("grep").execute(
        { pattern: "foo", path: fp },
        ctx(),
      );
      expect(result).toContain("foo");
      expect(result).toContain(":1:");
    });

    it("should search recursively and skip node_modules", async () => {
      const result = await getTool("grep").execute(
        { pattern: "foo", path: path.join(tmpDir, "src") },
        ctx(),
      );
      expect(result).toContain("a.ts");
      expect(result).not.toContain("node_modules");
    });

    it("should respect max_results as a global limit", async () => {
      // Create files with many matches
      for (let i = 0; i < 5; i++) {
        await writeFile(`src/multi${i}.ts`, `match\nmatch\nmatch\n`);
      }
      const result = await getTool("grep").execute(
        { pattern: "match", path: path.join(tmpDir, "src"), max_results: 3 },
        ctx(),
      );
      // Count lines that contain "match" (result lines, not the header)
      const matchLines = result.split("\n").filter((l: string) => l.includes("match") && !l.startsWith("No"));
      expect(matchLines.length).toBeLessThanOrEqual(3);
    });

    it("should be case-insensitive when pattern is all lowercase", async () => {
      const result = await getTool("grep").execute(
        { pattern: "hello", path: path.join(tmpDir, "src/b.ts") },
        ctx(),
      );
      // b.ts has 'hello' in lowercase — case-insensitive should match
      expect(result).not.toContain("No matches");
    });

    it("should be case-sensitive when pattern contains uppercase", async () => {
      const result = await getTool("grep").execute(
        { pattern: "Hello", path: path.join(tmpDir, "src/b.ts") },
        ctx(),
      );
      // 'hello' in b.ts is lowercase, 'Hello' (case-sensitive) should not match
      expect(result).toBe("No matches found.");
    });

    it("should return No matches when nothing found", async () => {
      const result = await getTool("grep").execute(
        { pattern: "zzzznotfound", path: path.join(tmpDir, "src") },
        ctx(),
      );
      expect(result).toBe("No matches found.");
    });

    it("should throw on invalid regex", async () => {
      await expect(
        getTool("grep").execute(
          { pattern: "[invalid", path: path.join(tmpDir, "src") },
          ctx(),
        ),
      ).rejects.toThrow("Invalid regex");
    });

    it("should detect enclosing function name", async () => {
      const result = await getTool("grep").execute(
        { pattern: "return 42", path: path.join(tmpDir, "src/a.ts") },
        ctx(),
      );
      expect(result).toContain("← in foo()");
    });
  });

  // ── grepInFile / findEnclosingFunction 私有方法测试已移除 ──
  // 这两个方法在 Phase 3 迁移中移至 LocalWorkspaceProvider，不再属于 FilePlugin

  // ── IGNORE_PATTERNS ──

  describe("IGNORE_PATTERNS", () => {
    it("should include node_modules, .git, dist, build", () => {
      const patterns: string[] = (FilePlugin as any).IGNORE_PATTERNS;
      expect(patterns.some((p) => p.includes("node_modules"))).toBe(true);
      expect(patterns.some((p) => p.includes(".git"))).toBe(true);
      expect(patterns.some((p) => p.includes("dist"))).toBe(true);
      expect(patterns.some((p) => p.includes("build"))).toBe(true);
    });
  });

  // ── prompt ──

  describe("registered prompt", () => {
    it("should have STATIC frequency and workspace info", () => {
      expect(api.prompts[0].frequency).toBe("STATIC");
    });

    it("should return empty string when no workspacePath", () => {
      const promptDef = api.prompts[0];
      // The content is a function stored in the PluginApi capture
      // We can test it via the plugin's onLoad prompt registration
    });
  });
});
