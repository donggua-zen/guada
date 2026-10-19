/// <reference types="jest" />

import { AgentEngine } from "../../src/modules/chat/agent-engine.service";
import { createAllMocks } from "./helpers/mock-factories";
import { loadChunksFromJsonl } from "./helpers/chunk-replayer";
import * as path from "path";
import type { Message } from "../../src/common/types/conversation.types";

/**
 * 引擎与 turn reminder provider 的接线：
 * - persist 消息先 appendMessages，再重读历史，请求里包含它；
 * - transient 只追加到请求尾部；
 * - 落库失败时回退为临时注入。
 */
function boundedToolCallGenerator() {
  let callCount = 0;
  const toolChunks = loadChunksFromJsonl(
    path.join(__dirname, "fixtures/chunks-with-tool-calls.jsonl"),
  );
  const textChunks = loadChunksFromJsonl(
    path.join(__dirname, "fixtures/chunks-text-only.jsonl"),
  );
  return () =>
    (async function* () {
      callCount++;
      if (callCount === 1) {
        for (const chunk of toolChunks) {
          yield chunk;
          if (chunk.type === "finish") break;
        }
      } else {
        for (const chunk of textChunks) yield chunk;
      }
    })();
}

const eventBus = {
  serial: jest.fn(async (_e: string, _p: unknown, fallback: () => unknown) => fallback()),
  parallel: jest.fn(async () => []),
} as any;

function reminder(id: string, text: string, transient = false): Message {
  return {
    id,
    role: "user",
    kind: "model",
    source: { kind: "plugin", plugin: "plan-mode" },
    metadata: { plugin: "plan-mode", hidden: true, ...(transient ? { transient: true } : {}) },
    content: [{ type: "text", text }],
  };
}

function lastText(message: Message): string {
  return String(
    (message.content[0] as { text?: string } | undefined)?.text ?? "",
  );
}

describe("AgentEngine - turn reminders", () => {
  it("persist 后重读历史；transient 只追加到请求尾部", async () => {
    const mocks = createAllMocks({ llmGenerator: boundedToolCallGenerator() });
    const history: Message[] = [];
    mocks.sessionContext.getHistory.mockImplementation(async () => [...history]);
    mocks.sessionContext.appendMessages.mockImplementation(async (messages: Message[]) => {
      history.push(...messages);
    });

    let calls = 0;
    const registry = {
      collect: jest.fn(async () => {
        calls++;
        if (calls === 1) {
          return {
            persist: [reminder("full-1", "FULL PLAN MODE INSTRUCTIONS")],
            transient: [],
          };
        }
        return {
          persist: [],
          transient: [reminder("sparse-1", "SPARSE PLAN MODE REMINDER", true)],
        };
      }),
    };

    const engine = new AgentEngine(
      mocks.toolExecutor as any,
      mocks.llmService as any,
      eventBus,
      registry as any,
    );

    await engine.run(mocks.sessionContext, { id: "msg-001" });

    // 第一次请求：完整提醒已落库，出现在请求消息里
    const completions = mocks.llmService.completions as jest.Mock;
    const firstParams = completions.mock.calls[0][0] as any;
    expect(firstParams.messages.map(lastText)).toContain("FULL PLAN MODE INSTRUCTIONS");

    // 第二次请求：完整提醒仍在历史，稀疏提醒只出现在尾部、不落库
    const secondParams = completions.mock.calls[1][0] as any;
    const texts = secondParams.messages.map(lastText);
    expect(texts).toContain("FULL PLAN MODE INSTRUCTIONS");
    expect(texts[texts.length - 1]).toBe("SPARSE PLAN MODE REMINDER");
    expect(history.map((m) => lastText(m))).not.toContain("SPARSE PLAN MODE REMINDER");
  });

  it("persist 落库失败时回退为临时注入", async () => {
    const mocks = createAllMocks({
      llmChunks: loadChunksFromJsonl(
        path.join(__dirname, "fixtures/chunks-text-only.jsonl"),
      ),
    });
    let firstAppend = true;
    mocks.sessionContext.appendMessages.mockImplementation(async () => {
      if (firstAppend) {
        firstAppend = false;
        throw new Error("disk full");
      }
    });

    const registry = {
      collect: jest.fn(async () => ({
        persist: [reminder("full-1", "FULL FALLBACK REMINDER")],
        transient: [],
      })),
    };

    const engine = new AgentEngine(
      mocks.toolExecutor as any,
      mocks.llmService as any,
      eventBus,
      registry as any,
    );

    await engine.run(mocks.sessionContext, { id: "msg-001" });

    const params = (mocks.llmService.completions as jest.Mock).mock.calls[0][0] as any;
    const texts = params.messages.map(lastText);
    expect(texts[texts.length - 1]).toBe("FULL FALLBACK REMINDER");
  });
});
