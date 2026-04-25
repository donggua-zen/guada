import { Test, TestingModule } from "@nestjs/testing";
import { ToolResultCleaner } from "./tool-result-cleaner.service";
import { MessageRecord } from "../llm-core/types/llm.types";

describe("ToolResultCleaner", () => {
  let cleaner: ToolResultCleaner;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ToolResultCleaner],
    }).compile();

    cleaner = module.get<ToolResultCleaner>(ToolResultCleaner);
  });

  it("should be defined", () => {
    expect(cleaner).toBeDefined();
  });

  describe("cleanToolResults", () => {
    it("should not modify non-tool messages", () => {
      const messages: MessageRecord[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];

      const result = cleaner.cleanToolResults(messages, "moderate");

      expect(result).toEqual(messages);
    });

    it("should clean regenerable tool results with moderate strategy", () => {
      const messages: MessageRecord[] = [
        {
          role: "tool",
          name: "knowledge_base_search",
          content: "A".repeat(3000), // 长内容
        },
      ];

      const result = cleaner.cleanToolResults(messages, "moderate");

      expect(result[0].content).toContain("工具调用已精简");
      expect(result[0].metadata?.cleaningLevel).toBe("minimal");
      expect(result[0].metadata?.originalContentLength).toBe(3000);
    });

    it("should summarize verbose tool results with moderate strategy", () => {
      const messages: MessageRecord[] = [
        {
          role: "tool",
          name: "custom_tool",
          content: "B".repeat(2500), // 超过 2000 字符
        },
      ];

      const result = cleaner.cleanToolResults(messages, "moderate");

      expect(result[0].content).toContain("...[省略");
      expect(result[0].metadata?.summarized).toBe(true);
      expect(result[0].metadata?.originalLength).toBe(2500);
    });

    it("should not modify short tool results with moderate strategy", () => {
      const messages: MessageRecord[] = [
        {
          role: "tool",
          name: "custom_tool",
          content: "Short content",
        },
      ];

      const result = cleaner.cleanToolResults(messages, "moderate");

      expect(result[0].content).toBe("Short content");
      expect(result[0].metadata?.summarized).toBeUndefined();
    });

    it("should apply aggressive cleaning to all long tools", () => {
      const messages: MessageRecord[] = [
        {
          role: "tool",
          name: "custom_tool",
          content: "C".repeat(1500), // 超过 1000 字符
        },
      ];

      const result = cleaner.cleanToolResults(messages, "aggressive");

      expect(result[0].content).toContain("...[省略");
      expect(result[0].metadata?.summarized).toBe(true);
    });

    it("should only truncate very long content with conservative strategy", () => {
      const messages: MessageRecord[] = [
        {
          role: "tool",
          name: "custom_tool",
          content: "D".repeat(3000), // 小于 5000 字符
        },
      ];

      const result = cleaner.cleanToolResults(messages, "conservative");

      // 保守策略下,3000 字符不会被清理
      expect(result[0].content).toBe("D".repeat(3000));
    });

    it("should handle mixed message types correctly", () => {
      const messages: MessageRecord[] = [
        { role: "user", content: "Query" },
        {
          role: "tool",
          name: "web_search",
          content: "E".repeat(4000),
        },
        { role: "assistant", content: "Answer" },
      ];

      const result = cleaner.cleanToolResults(messages, "moderate");

      expect(result[0].role).toBe("user");
      expect(result[1].content).toContain("工具调用已精简");
      expect(result[2].role).toBe("assistant");
    });
  });

  describe("isRegenerableTool", () => {
    it("should identify knowledge base tools as regenerable", () => {
      expect(cleaner["isRegenerableTool"]("knowledge_base_search")).toBe(true);
      expect(cleaner["isRegenerableTool"]("kb_retrieve")).toBe(true);
    });

    it("should identify web search tools as regenerable", () => {
      expect(cleaner["isRegenerableTool"]("web_search")).toBe(true);
      expect(cleaner["isRegenerableTool"]("search_web")).toBe(true);
    });

    it("should not identify custom tools as regenerable", () => {
      expect(cleaner["isRegenerableTool"]("custom_tool")).toBe(false);
      expect(cleaner["isRegenerableTool"]("my_function")).toBe(false);
    });
  });
});
