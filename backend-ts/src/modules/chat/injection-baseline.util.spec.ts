import {
  pickBaselineUserMessage,
  resolveBindingBaseline,
} from "./injection-baseline.util";

/**
 * 注入基准判定矩阵（模式叙事 / 远程绑定变更共用）。
 *
 * 核心回归：「重答后绑定提醒丢失」——旧实现把"已注入"记在会话级状态里，
 * turn/delete 不会回退该记账，于是重答后的消息不再携带 reminder。
 * 新实现把基准挂在消息 metadata 上：基准随消息删除而消失、回退到更早的消息，
 * 变更因此被重新判定并重新注入。
 */
describe("injection-baseline.util", () => {
  const user = (id: string, sshBindings?: string[], extra: Record<string, any> = {}) =>
    ({
      id,
      role: "user",
      kind: "user",
      metadata: sshBindings === undefined ? {} : { sshBindings },
      ...extra,
    }) as any;

  it("取最后一条真实用户消息作为基准", () => {
    const history = [user("m1", []), { id: "a1", role: "assistant" } as any, user("m2", ["c1"])];
    expect(pickBaselineUserMessage(history)?.id).toBe("m2");
  });

  it("排除注入的 hidden 消息（kind='model'）", () => {
    const history = [
      user("m1", ["c1"]),
      user("m2", undefined, { kind: "model" }),
    ];
    expect(pickBaselineUserMessage(history)?.id).toBe("m1");
  });

  it("排除待替换回合（replaceTurnId）", () => {
    const history = [user("m1", ["c1"]), user("m2", ["c1", "c2"])];
    expect(pickBaselineUserMessage(history, "m2")?.id).toBe("m1");
  });

  it("空历史 → undefined（冷启动）", () => {
    expect(pickBaselineUserMessage([])).toBeUndefined();
  });

  it("基准缺失 → 回退系统提示词快照", () => {
    expect(resolveBindingBaseline(undefined, ["c1"])).toEqual(["c1"]);
    expect(resolveBindingBaseline(null, [])).toEqual([]);
    expect(resolveBindingBaseline("oops", ["c1"])).toEqual(["c1"]);
  });

  it("基准存在（含空数组）→ 以消息记录为准，不回退", () => {
    expect(resolveBindingBaseline([], ["c1"])).toEqual([]);
    expect(resolveBindingBaseline(["c1"], [])).toEqual(["c1"]);
  });

  it("重答等价：携带基准的消息被删除 → 基准回退，变更被重新判定", () => {
    const live = ["c1", "c2"];
    // 绑定 c1 后的消息 m1 记录 ["c1"]；随后新增 c2 并发出 m2（记录 ["c1","c2"]）
    const history = [user("m1", ["c1"]), user("m2", ["c1", "c2"])];

    // 重答 m2 所属回合前：基准 == live（旧实现正是凭这份"已注入"记账跳过注入）
    const before = resolveBindingBaseline(
      pickBaselineUserMessage(history)?.metadata?.sshBindings,
      live,
    );
    expect(before).toEqual(live);

    // turn/delete 后 m2 不再可见：基准回退到 m1 → 判定为变更，reminder 重新注入
    const afterRegen = history.filter((m) => m.id !== "m2");
    const after = resolveBindingBaseline(
      pickBaselineUserMessage(afterRegen)?.metadata?.sshBindings,
      live,
    );
    expect(after).toEqual(["c1"]);
    expect(after).not.toEqual(live);
  });

  it("重答首条消息（历史被清空）→ 基准回退系统提示词快照", () => {
    const live = ["c1"];
    const snapshot = ["c1"]; // 系统提示词快照与 live 一致（绑定未再变化）
    const afterRegen: any[] = [];
    const after = resolveBindingBaseline(
      pickBaselineUserMessage(afterRegen)?.metadata?.sshBindings,
      snapshot,
    );
    // 快照已含 live → 不注入（模型从系统提示词即可得知当前绑定）
    expect(after).toEqual(live);
  });
});
