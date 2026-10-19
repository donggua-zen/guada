import { pickTitleMessages } from "../../src/modules/chat/session-title.util";
import type { Message } from "../../src/common/types/conversation.types";

function message(
  id: string,
  role: "user" | "assistant" | "tool",
  kind: "user" | "model",
  metadata: Record<string, any> = {},
): Message {
  return {
    id,
    role,
    kind,
    source: { kind: "user" },
    metadata,
    content: [{ type: "text", text: id }],
  };
}

describe("pickTitleMessages", () => {
  it("保留助手消息（kind='model'）与真实用户消息", () => {
    const picked = pickTitleMessages([
      message("u1", "user", "user"),
      message("a1", "assistant", "model"),
    ]);
    expect(picked.map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("过滤 hidden / 注入的 user 消息", () => {
    const picked = pickTitleMessages([
      message("u1", "user", "user"),
      message("reminder", "user", "model", { hidden: true }),
      message("a1", "assistant", "model"),
      message("hidden", "assistant", "model", { hidden: true }),
    ]);
    expect(picked.map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("只取最后 limit 条", () => {
    const picked = pickTitleMessages(
      [
        message("u1", "user", "user"),
        message("a1", "assistant", "model"),
        message("u2", "user", "user"),
        message("a2", "assistant", "model"),
      ],
      2,
    );
    expect(picked.map((m) => m.id)).toEqual(["u2", "a2"]);
  });
});
