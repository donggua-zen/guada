import { Test, TestingModule } from "@nestjs/testing";
import { TimeToolProvider } from "./time-tool.provider";

describe("TimeToolProvider", () => {
  let provider: TimeToolProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TimeToolProvider],
    }).compile();

    provider = module.get<TimeToolProvider>(TimeToolProvider);
  });

  it("should be defined", () => {
    expect(provider).toBeDefined();
  });

  it("should return empty array for getTools", async () => {
    const tools = await provider.getTools(true);
    expect(tools).toEqual([]);
  });

  it("should throw error when execute is called", async () => {
    const request = {
      id: "test-id",
      name: "test",
      arguments: {},
    };

    await expect(provider.execute(request)).rejects.toThrow(
      "时间工具仅用于提示词注入，不支持直接调用"
    );
  });

  it("should return current time in prompt", async () => {
    const prompt = await provider.getPrompt();
    expect(prompt).toContain("【当前时间信息】");
    expect(prompt).toContain("当前时间是：");
    expect(prompt).toContain(
      "请注意：在与用户对话时，如果需要提及时间相关信息，请使用上述提供的准确时间。",
    );
  });
});
