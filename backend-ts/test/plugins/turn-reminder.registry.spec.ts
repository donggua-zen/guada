import { TurnReminderRegistry } from "../../src/modules/plugins/turn-reminders/turn-reminder.registry";
import type {
  TurnReminderProvider,
  TurnReminderProviderInput,
} from "../../src/modules/plugins/turn-reminders/turn-reminder.types";
import type { Message } from "../../src/common/types/conversation.types";
import type { ISessionContext } from "../../src/modules/chat/session-context";

const input = {
  sessionContext: {} as ISessionContext,
  iterationCount: 1,
  history: [],
};

function message(id: string): Message {
  return {
    id,
    role: "user",
    kind: "model",
    source: { kind: "plugin", plugin: "test" },
    metadata: {},
    content: [{ type: "text", text: id }],
  };
}

function provider(
  id: string,
  order: number,
  build: TurnReminderProvider["build"],
): TurnReminderProvider {
  return { id, order, build };
}

describe("TurnReminderRegistry", () => {
  it("合并多个 provider 的 persist / transient，并按 order 执行", async () => {
    const registry = new TurnReminderRegistry();
    const calls: string[] = [];
    registry.register(
      "p1",
      provider("late", 20, () => {
        calls.push("late");
        return { transient: [message("t2")] };
      }),
    );
    registry.register(
      "p1",
      provider("early", 10, () => {
        calls.push("early");
        return { persist: [message("p1")], transient: [message("t1")] };
      }),
    );

    const result = await registry.collect(input);
    expect(calls).toEqual(["early", "late"]);
    expect(result.persist.map((m) => m.id)).toEqual(["p1"]);
    expect(result.transient.map((m) => m.id)).toEqual(["t1", "t2"]);
  });

  it("同一 pluginId + provider.id 重复注册时原位覆盖", async () => {
    const registry = new TurnReminderRegistry();
    registry.register("p1", provider("same", 0, () => ({ persist: [message("old")] })));
    registry.register("p1", provider("same", 0, () => ({ persist: [message("new")] })));

    const result = await registry.collect(input);
    expect(result.persist.map((m) => m.id)).toEqual(["new"]);
  });

  it("isEnabled 过滤禁用插件的 provider", async () => {
    const registry = new TurnReminderRegistry();
    const disabledBuild = jest.fn(() => ({ persist: [message("disabled")] }));
    registry.register("disabled-plugin", provider("x", 0, disabledBuild));
    registry.register("enabled-plugin", provider("y", 0, () => ({ persist: [message("enabled")] })));

    const result = await registry.collect(input, (pluginId) => pluginId === "enabled-plugin");
    expect(disabledBuild).not.toHaveBeenCalled();
    expect(result.persist.map((m) => m.id)).toEqual(["enabled"]);
  });

  it("单个 provider 抛错不影响其他 provider", async () => {
    const registry = new TurnReminderRegistry();
    registry.register("bad", provider("bad", 0, () => {
      throw new Error("boom");
    }));
    registry.register("good", provider("good", 1, () => ({ transient: [message("ok")] })));

    const result = await registry.collect(input);
    expect(result.persist).toEqual([]);
    expect(result.transient.map((m) => m.id)).toEqual(["ok"]);
  });

  it("空 registry 返回空集合", async () => {
    const registry = new TurnReminderRegistry();
    await expect(registry.collect(input)).resolves.toEqual({
      persist: [],
      transient: [],
    });
  });
});
