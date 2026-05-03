import { Test, TestingModule } from "@nestjs/testing";
import { ShellToolProvider } from "./shell-tool.provider";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

describe("ShellToolProvider", () => {
  let provider: ShellToolProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ShellToolProvider],
    }).compile();

    provider = module.get<ShellToolProvider>(ShellToolProvider);
  });

  it("应该正确定义命名空间", () => {
    expect(provider.namespace).toBe("shell");
  });

  it("应该返回正确的元数据", () => {
    const metadata = provider.getMetadata();
    expect(metadata.namespace).toBe("shell");
    expect(metadata.displayName).toBe("Shell 工具");
    expect(metadata.isMcp).toBe(false);
  });

  it("应该返回工具配置列表", async () => {
    const tools = await provider.getTools(true);
    expect(tools).toHaveLength(3);
    expect(tools[0].name).toBe("execute_command");
    expect(tools[1].name).toBe("read_file");
    expect(tools[2].name).toBe("list_directory");
  });

  it("当禁用时应该返回空数组", async () => {
    const tools = await provider.getTools(false);
    expect(tools).toHaveLength(0);
  });

  describe("execute_command", () => {
    it("应该执行简单的命令并返回输出", async () => {
      const result = await provider.execute({
        id: "test-1",
        name: "execute_command",
        arguments: { command: "echo Hello World" },
      });

      expect(result).toContain("Hello World");
      expect(result).toContain("标准输出");
    });

    it("应该处理无效命令并返回错误", async () => {
      const result = await provider.execute({
        id: "test-2",
        name: "execute_command",
        arguments: { command: "" },
      });

      expect(result).toContain("错误");
      expect(result).toContain("命令不能为空");
    });

    it("应该在指定工作目录执行命令", async () => {
      const tempDir = os.tmpdir();
      // 使用 Windows 兼容的命令
      const command = process.platform === "win32" ? "cd" : "pwd";
      const result = await provider.execute({
        id: "test-3",
        name: "execute_command",
        arguments: { 
          command, 
          working_directory: tempDir 
        },
      });

      expect(result).toContain(tempDir);
    });
  });

  describe("read_file", () => {
    let tempFilePath: string;

    beforeEach(async () => {
      // 创建临时测试文件
      tempFilePath = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
      await fs.writeFile(tempFilePath, "测试文件内容\n第二行内容", "utf-8");
    });

    afterEach(async () => {
      // 清理临时文件
      try {
        await fs.unlink(tempFilePath);
      } catch (error) {
        // 忽略删除错误
      }
    });

    it("应该读取文件内容", async () => {
      const result = await provider.execute({
        id: "test-4",
        name: "read_file",
        arguments: { file_path: tempFilePath },
      });

      expect(result).toContain("测试文件内容");
      expect(result).toContain("第二行内容");
      expect(result).toContain(tempFilePath);
    });

    it("应该处理不存在的文件", async () => {
      const result = await provider.execute({
        id: "test-5",
        name: "read_file",
        arguments: { file_path: "/nonexistent/file.txt" },
      });

      expect(result).toContain("错误");
      expect(result).toContain("文件不存在");
    });

    it("应该拒绝空文件路径", async () => {
      const result = await provider.execute({
        id: "test-6",
        name: "read_file",
        arguments: { file_path: "" },
      });

      expect(result).toContain("错误");
      expect(result).toContain("文件路径不能为空");
    });
  });

  describe("list_directory", () => {
    it("应该列出目录内容", async () => {
      const tempDir = os.tmpdir();
      const result = await provider.execute({
        id: "test-7",
        name: "list_directory",
        arguments: { directory_path: tempDir },
      });

      expect(result).toContain("目录内容");
      expect(result).toContain(tempDir);
    });

    it("应该处理不存在的目录", async () => {
      const result = await provider.execute({
        id: "test-8",
        name: "list_directory",
        arguments: { directory_path: "/nonexistent/directory" },
      });

      expect(result).toContain("错误");
      expect(result).toContain("目录不存在");
    });

    it("应该拒绝空目录路径", async () => {
      const result = await provider.execute({
        id: "test-9",
        name: "list_directory",
        arguments: { directory_path: "" },
      });

      expect(result).toContain("错误");
      expect(result).toContain("目录路径不能为空");
    });
  });

  describe("getPrompt", () => {
    it("应该返回工具使用说明", async () => {
      const prompt = await provider.getPrompt({});
      
      expect(prompt).toContain("Shell 工具使用说明");
      expect(prompt).toContain("execute_command");
      expect(prompt).toContain("read_file");
      expect(prompt).toContain("list_directory");
      expect(prompt).toContain("重要提醒");
    });
  });
});
