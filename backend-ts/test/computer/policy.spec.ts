import {
  DEFAULT_COMPUTER_POLICY,
  normalizeComputerPolicy,
  normalizeComputerUseSettings,
} from "../../src/modules/plugins/builtins/computer-use/policy";

describe("computer use policy", () => {
  it("is opt-in and asks before input by default", () => {
    const settings = normalizeComputerUseSettings(undefined);
    expect(settings.enabled).toBe(false);
    expect(settings.actions.screenshot).toBe("allow");
    expect(settings.actions.a11y_observe).toBe("allow");
    expect(settings.actions.click_element).toBe("ask");
    expect(settings.actions.type).toBe("ask");
    expect(settings.actions.key).toBe("ask");
  });

  it("enables only on an explicit true value", () => {
    expect(normalizeComputerUseSettings({ enabled: true }).enabled).toBe(true);
    expect(normalizeComputerUseSettings({ enabled: "true" }).enabled).toBe(false);
    expect(normalizeComputerUseSettings({ enabled: 1 }).enabled).toBe(false);
  });

  it("keeps valid overrides and ignores invalid decisions", () => {
    const policy = normalizeComputerPolicy({
      click_element: "deny",
      type: "allow",
      key: "sometimes",
      unknown: "allow",
    });
    expect(policy.click_element).toBe("deny");
    expect(policy.type).toBe("allow");
    expect(policy.key).toBe(DEFAULT_COMPUTER_POLICY.key);
  });
});
