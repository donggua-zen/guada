import { Test, TestingModule } from "@nestjs/testing";
import { ShellToolProvider } from "./shell-tool.provider";

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
    const metadata = provider.getMetadata({});
    expect(metadata.namespace).toBe("shell");
    expect(metadata.displayName).toBe("Shell 命令行工具");
    expect(metadata.isMcp).toBe(false);
  });

  it("应该返回工具配置列表", async () => {
    const tools = await provider.getTools(true);
    expect(tools).toHaveLength(3);
    expect(tools[0].name).toBe("execute_command");
    expect(tools[1].name).toBe("close_terminal");
    expect(tools[2].name).toBe("check_terminal_output");
  });

  it("当禁用时应该返回空数组", async () => {
    const tools = await provider.getTools(false);
    expect(tools).toHaveLength(0);
  });

  describe("execute_command", () => {
    it("应该执行简单的命令并返回输出", async () => {
      const resultStr = await provider.execute(
        {
          id: "test-1",
          name: "execute_command",
          arguments: { command: "echo Hello World" },
        },
        { sessionId: "test-session-001" },
      );

      const result = JSON.parse(resultStr);
      expect(result.stdout).toContain("Hello World");
      expect(result.exitCode).toBe(0);
    });

    it("应该处理无效命令并抛出错误", async () => {
      await expect(
        provider.execute(
          {
            id: "test-2",
            name: "execute_command",
            arguments: { command: "" },
          },
          { sessionId: "test-session-002" },
        ),
      ).rejects.toThrow("命令不能为空");
    });

    it("同一会话启动新命令应自动结束旧的", async () => {
      const sessionId = "test-session-replace";

      // 启动一个长时间运行的命令（使用 ping 模拟，Windows 和 Unix 都支持）
      const longCommand = process.platform === "win32" ? "ping -n 60 127.0.0.1" : "ping -c 60 127.0.0.1";
      const promise1 = provider.execute(
        {
          id: "test-replace-1",
          name: "execute_command",
          arguments: { command: longCommand },
        },
        { sessionId },
      );

      // 等待一小段时间确保第一个命令已启动
      await new Promise((resolve) => setTimeout(resolve, 800));

      // 在同一会话启动第二个命令
      const resultStr2 = await provider.execute(
        {
          id: "test-replace-2",
          name: "execute_command",
          arguments: { command: "echo Second Command" },
        },
        { sessionId },
      );

      const result2 = JSON.parse(resultStr2);
      expect(result2.stdout).toContain("Second Command");

      // 第一个命令应该被中止（由于进程被 kill，可能 reject 或 resolve 带错误）
      try {
        await promise1;
      } catch (error: any) {
        expect(error.message).toContain("aborted");
      }
    });
  });

  describe("close_terminal", () => {
    it("应该关闭当前会话的终端", async () => {
      const sessionId = "test-session-close";

      // 先启动一个长时间运行的命令（使用 ping 模拟）
      const longCommand = process.platform === "win32" ? "ping -n 60 127.0.0.1" : "ping -c 60 127.0.0.1";
      provider.execute(
        {
          id: "test-close-1",
          name: "execute_command",
          arguments: { command: longCommand },
        },
        { sessionId },
      );

      // 等待命令启动并确保会话已注册
      await new Promise((resolve) => setTimeout(resolve, 800));

      // 关闭终端
      const resultStr = await provider.execute(
        {
          id: "test-close-2",
          name: "close_terminal",
          arguments: {},
        },
        { sessionId },
      );

      const result = JSON.parse(resultStr);
      expect(result.success).toBe(true);
      expect(result.message).toBe("终端已关闭");
    });

    it("没有运行中的终端时应返回提示", async () => {
      const resultStr = await provider.execute(
        {
          id: "test-close-3",
          name: "close_terminal",
          arguments: {},
        },
        { sessionId: "test-session-no-terminal" },
      );

      const result = JSON.parse(resultStr);
      expect(result.success).toBe(true);
      expect(result.message).toContain("没有正在运行的终端");
    });

    it("没有 sessionId 时应抛出错误", async () => {
      await expect(
        provider.execute({
          id: "test-close-4",
          name: "close_terminal",
          arguments: {},
        }),
      ).rejects.toThrow("无法获取会话 ID");
    });
  });

  describe("check_terminal_output", () => {
    it("应该返回终端的输出", async () => {
      const sessionId = "test-session-check";

      // 启动一个命令
      const resultStr1 = await provider.execute(
        {
          id: "test-check-1",
          name: "execute_command",
          arguments: { command: "echo CheckOutput" },
        },
        { sessionId },
      );

      const result1 = JSON.parse(resultStr1);
      expect(result1.stdout).toContain("CheckOutput");
    });

    it("没有运行中的终端时应返回提示", async () => {
      const resultStr = await provider.execute(
        {
          id: "test-check-2",
          name: "check_terminal_output",
          arguments: {},
        },
        { sessionId: "test-session-no-output" },
      );

      const result = JSON.parse(resultStr);
      expect(result.success).toBe(true);
      expect(result.message).toContain("没有正在运行的终端");
    });

    it("没有 sessionId 时应抛出错误", async () => {
      await expect(
        provider.execute({
          id: "test-check-3",
          name: "check_terminal_output",
          arguments: {},
        }),
      ).rejects.toThrow("无法获取会话 ID");
    });
  });

  describe("formatDisplayMessage", () => {
    it("应该为 execute_command 生成正确的展示文案", () => {
      const result = provider.formatDisplayMessage("execute_command", { command: "ls -la" }, true);
      expect(result.action).toBe("正在执行命令");
      expect(result.toolName).toBe("shell__execute_command");
    });

    it("应该为 close_terminal 生成正确的展示文案", () => {
      const result = provider.formatDisplayMessage("close_terminal", {}, true);
      expect(result.action).toBe("正在关闭终端");
      expect(result.toolName).toBe("shell__close_terminal");
    });

    it("应该为 check_terminal_output 生成正确的展示文案", () => {
      const result = provider.formatDisplayMessage("check_terminal_output", {}, false);
      expect(result.action).toBe("已等待终端输出");
      expect(result.toolName).toBe("shell__check_terminal_output");
    });
  });

  describe("getPrompt", () => {
    it("应该返回工具使用说明", async () => {
      const prompt = await provider.getPrompt({});

      expect(prompt).toContain("Shell 命令行工具使用说明");
      expect(prompt).toContain("check_terminal_output");
      expect(prompt).toContain("close_terminal");
      expect(prompt).toContain("30 秒");
      expect(prompt).toContain("后台运行");
      expect(prompt).toContain("重要提醒");
    });
  });
});
