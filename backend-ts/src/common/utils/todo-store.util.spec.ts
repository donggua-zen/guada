import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { BaseEvent } from "../persistence/types";
import {
  TODO_META_CARD,
  TODO_TOOL_NAME,
  extractTodoStateFromEvents,
  resolveTodoFilePath,
  writeTodoStore,
} from "./todo-store.util";

/** 造一条 tool/result 事件 */
function toolResult(
  seq: number,
  data: Record<string, unknown>,
): BaseEvent {
  return { type: "tool/result", seq, time: 1700000000000 + seq, data };
}

/** 造一条 todo 工具结果（带合法 meta） */
function todoResult(
  seq: number,
  items: Array<{ content: string; status: string }>,
): BaseEvent {
  return toolResult(seq, {
    messageId: `m_${seq}`,
    toolCallId: `tc_${seq}`,
    name: TODO_TOOL_NAME,
    content: "formatted",
    meta: { card: TODO_META_CARD, action: "update", items },
  });
}

describe("todo-store.util", () => {
  describe("resolveTodoFilePath", () => {
    it("落在 <workspaceDir>/.guada/todo/<sessionId>.json", () => {
      expect(resolveTodoFilePath("/ws/proj", "session-abc")).toBe(
        path.join("/ws/proj", ".guada", "todo", "session-abc.json"),
      );
    });
  });

  describe("writeTodoStore", () => {
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "todo-store-util-"));
    });

    afterEach(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("递归建目录并写入 { items } JSON", async () => {
      const store = {
        items: [{ content: "写测试", status: "in_progress" as const }],
      };
      await writeTodoStore(tmpRoot, "session-x", store);

      const filePath = resolveTodoFilePath(tmpRoot, "session-x");
      expect(fs.existsSync(filePath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(filePath, "utf-8"))).toEqual(store);
    });
  });

  describe("extractTodoStateFromEvents", () => {
    it("取最后一个匹配项（即锚点时刻的状态）", () => {
      const events = [
        todoResult(1, [{ content: "第一步", status: "in_progress" }]),
        toolResult(2, { name: "read", content: "无关" }),
        todoResult(3, [
          { content: "第一步", status: "completed" },
          { content: "第二步", status: "in_progress" },
        ]),
      ];

      expect(extractTodoStateFromEvents(events)).toEqual({
        items: [
          { content: "第一步", status: "completed" },
          { content: "第二步", status: "in_progress" },
        ],
      });
    });

    it("忽略非 tool/result 事件", () => {
      const events: BaseEvent[] = [
        {
          type: "assistant/message",
          seq: 1,
          time: 1,
          data: {
            messageId: "m1",
            content: [
              {
                type: "tool-call",
                toolCallId: "tc1",
                name: TODO_TOOL_NAME,
                arguments: '{"action":"update"}',
              },
            ],
          },
        },
      ];
      expect(extractTodoStateFromEvents(events)).toBeNull();
    });

    it("忽略非 todo 工具的结果", () => {
      const events = [
        toolResult(1, {
          name: "shell",
          content: "ok",
          meta: { card: "terminal", exitCode: 0 },
        }),
      ];
      expect(extractTodoStateFromEvents(events)).toBeNull();
    });

    it("忽略无 meta 的 todo 结果（存量会话）", () => {
      const events = [
        toolResult(1, {
          name: TODO_TOOL_NAME,
          content: "[>] 第一步",
        }),
      ];
      expect(extractTodoStateFromEvents(events)).toBeNull();
    });

    it("忽略 card 不匹配或 items 非数组的 meta", () => {
      const events = [
        toolResult(1, {
          name: TODO_TOOL_NAME,
          content: "x",
          meta: { card: "other", items: [] },
        }),
        toolResult(2, {
          name: TODO_TOOL_NAME,
          content: "x",
          meta: { card: TODO_META_CARD, items: "oops" },
        }),
      ];
      expect(extractTodoStateFromEvents(events)).toBeNull();
    });

    it("item 结构非法时整条弃用，回退到更早的合法结果", () => {
      const events = [
        todoResult(1, [{ content: "第一步", status: "pending" }]),
        toolResult(2, {
          name: TODO_TOOL_NAME,
          content: "x",
          meta: {
            card: TODO_META_CARD,
            items: [{ content: "坏数据", status: "unknown-status" }],
          },
        }),
      ];

      expect(extractTodoStateFromEvents(events)).toEqual({
        items: [{ content: "第一步", status: "pending" }],
      });
    });

    it("空事件列表返回 null", () => {
      expect(extractTodoStateFromEvents([])).toBeNull();
    });
  });
});
