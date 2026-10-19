import { mergePlanModeSettings } from "../../src/modules/chat/plan-mode-settings.util";

describe("mergePlanModeSettings", () => {
  const mint = () => "epoch-new";

  it("普通保存未携带 epoch：保留后端周期", () => {
    const result = mergePlanModeSettings(
      { planEnabled: true, planModeEpoch: "epoch-1", sandboxMode: "workspace-write" },
      { planEnabled: true, sandboxMode: "read-only" },
      mint,
    );
    expect(result.settings.planModeEpoch).toBe("epoch-1");
    expect(result.settings.sandboxMode).toBe("read-only");
    expect(result.transition).toBeNull();
  });

  it("false -> true：生成新周期并返回变更", () => {
    const result = mergePlanModeSettings(
      { planEnabled: false, planModeEpoch: "epoch-old" },
      { planEnabled: true },
      mint,
    );
    expect(result.settings.planModeEpoch).toBe("epoch-new");
    expect(result.transition).toEqual({ from: false, to: true });
  });

  it("true -> false：保留旧周期（退出说明仍需要它）", () => {
    const result = mergePlanModeSettings(
      { planEnabled: true, planModeEpoch: "epoch-1" },
      { planEnabled: false },
      mint,
    );
    expect(result.settings.planModeEpoch).toBe("epoch-1");
    expect(result.transition).toEqual({ from: true, to: false });
  });

  it("旧标签页写回旧 epoch：以后端当前值为准", () => {
    const result = mergePlanModeSettings(
      { planEnabled: true, planModeEpoch: "epoch-2" },
      { planEnabled: true, planModeEpoch: "epoch-1" },
      mint,
    );
    expect(result.settings.planModeEpoch).toBe("epoch-2");
  });

  it("部分更新未携带 planEnabled：保留当前计划态", () => {
    const result = mergePlanModeSettings(
      { planEnabled: true, planModeEpoch: "epoch-1" },
      { sandboxMode: "read-only" },
      mint,
    );
    expect(result.settings.planEnabled).toBe(true);
    expect(result.settings.planModeEpoch).toBe("epoch-1");
    expect(result.transition).toBeNull();
  });

  it("已开启但缺 epoch（老会话）：补一个新周期", () => {
    const result = mergePlanModeSettings(
      { planEnabled: true },
      { planEnabled: true },
      mint,
    );
    expect(result.settings.planModeEpoch).toBe("epoch-new");
    expect(result.transition).toBeNull();
  });
});
