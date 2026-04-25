import { Test, TestingModule } from "@nestjs/testing";
import { ContextManagerService } from "./context-manager.service";
import { MessageRepository } from "../../common/database/message.repository";
import { SessionContextStateRepository } from "../../common/database/session-context-state.repository";
import { UploadPathService } from "../../common/services/upload-path.service";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { ToolContextFactory } from "../tools/tool-context";
import { MessageRecord } from "../llm-core/types/llm.types";

describe("ContextManagerService - Semantic Turns", () => {
  let contextManager: ContextManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContextManagerService,
        {
          provide: MessageRepository,
          useValue: {},
        },
        {
          provide: SessionContextStateRepository,
          useValue: {},
        },
        {
          provide: UploadPathService,
          useValue: {},
        },
        {
          provide: ToolOrchestrator,
          useValue: {},
        },
        {
          provide: ToolContextFactory,
          useValue: {},
        },
      ],
    }).compile();

    contextManager = module.get<ContextManagerService>(ContextManagerService);
  });

  it("should be defined", () => {
    expect(contextManager).toBeDefined();
  });

  describe("groupMessagesBySemanticTurns", () => {
    it("should return empty array for empty messages", () => {
      const result = contextManager.groupMessagesBySemanticTurns([]);
      expect(result).toEqual([]);
    });

    it("should group simple conversation correctly", () => {
      const messages: MessageRecord[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
        { role: "user", content: "How are you?" },
        { role: "assistant", content: "I'm good" },
      ];

      const result = contextManager.groupMessagesBySemanticTurns(messages);

      expect(result).toHaveLength(2);
      expect(result[0].startIndex).toBe(0);
      expect(result[0].endIndex).toBe(1);
      expect(result[0].hasToolCalls).toBe(false);
      expect(result[1].startIndex).toBe(2);
      expect(result[1].endIndex).toBe(3);
    });

    it("should handle tool calls within a turn", () => {
      const messages: MessageRecord[] = [
        { role: "user", content: "Search for weather" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "1", type: "function", name: "search_weather", arguments: "{}" }],
        },
        {
          role: "tool",
          name: "search_weather",
          content: '{"temp": 25}',
        },
        { role: "assistant", content: "The weather is nice, 25°C" },
      ];

      const result = contextManager.groupMessagesBySemanticTurns(messages);

      expect(result).toHaveLength(1);
      expect(result[0].startIndex).toBe(0);
      expect(result[0].endIndex).toBe(3);
      expect(result[0].hasToolCalls).toBe(true);
      expect(result[0].messageCount).toBe(4);
    });

    it("should handle multiple turns with mixed tool calls", () => {
      const messages: MessageRecord[] = [
        // Turn 1: Simple Q&A
        { role: "user", content: "What is AI?" },
        { role: "assistant", content: "AI is..." },
        // Turn 2: With tool calls
        { role: "user", content: "Search for latest AI news" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "1", type: "function", name: "web_search", arguments: "{}" }],
        },
        { role: "tool", name: "web_search", content: "News..." },
        { role: "assistant", content: "Here are the latest news..." },
        // Turn 3: Another simple Q&A
        { role: "user", content: "Thanks" },
        { role: "assistant", content: "You're welcome" },
      ];

      const result = contextManager.groupMessagesBySemanticTurns(messages);

      expect(result).toHaveLength(3);
      expect(result[0].hasToolCalls).toBe(false);
      expect(result[1].hasToolCalls).toBe(true);
      expect(result[1].messageCount).toBe(4);
      expect(result[2].hasToolCalls).toBe(false);
    });

    it("should handle single user message without response", () => {
      const messages: MessageRecord[] = [
        { role: "user", content: "Hello" },
      ];

      const result = contextManager.groupMessagesBySemanticTurns(messages);

      expect(result).toHaveLength(1);
      expect(result[0].startIndex).toBe(0);
      expect(result[0].endIndex).toBe(0);
      expect(result[0].hasToolCalls).toBe(false);
    });

    it("should handle complex multi-step tool chain", () => {
      const messages: MessageRecord[] = [
        { role: "user", content: "Analyze this data" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "1", type: "function", name: "fetch_data", arguments: "{}" }],
        },
        { role: "tool", name: "fetch_data", content: "Data..." },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "2", type: "function", name: "analyze", arguments: "{}" }],
        },
        { role: "tool", name: "analyze", content: "Analysis..." },
        { role: "assistant", content: "Based on the analysis..." },
      ];

      const result = contextManager.groupMessagesBySemanticTurns(messages);

      expect(result).toHaveLength(1);
      expect(result[0].hasToolCalls).toBe(true);
      expect(result[0].messageCount).toBe(6);
    });
  });
});
