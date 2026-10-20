import { ComputerLeaseRegistry } from "../../src/modules/plugins/builtins/computer-use/lease";

describe("ComputerLeaseRegistry", () => {
  it("accepts a matching accessibility lease for click_element", () => {
    const registry = new ComputerLeaseRegistry();
    registry.record("session-1", "accessibility", 4);
    expect(() => registry.require("session-1", "click_element", 4, false)).not.toThrow();
  });

  it("rejects element actions backed by a screenshot lease", () => {
    const registry = new ComputerLeaseRegistry();
    registry.record("session-1", "screenshot", 4);
    expect(() => registry.require("session-1", "click_element", 4, false)).toThrow(
      /requires a accessibility observation/
    );
  });

  it("requires a screenshot lease for pixel clicks", () => {
    const registry = new ComputerLeaseRegistry();
    registry.record("session-1", "accessibility", 2);
    expect(() => registry.require("session-1", "left_click", 2, true)).toThrow(
      /requires a screenshot observation/
    );
    registry.record("session-1", "screenshot", 3);
    expect(() => registry.require("session-1", "left_click", 3, true)).not.toThrow();
  });

  it("accepts any lease for type and key", () => {
    const registry = new ComputerLeaseRegistry();
    registry.record("session-1", "window_list", 9);
    expect(() => registry.require("session-1", "type", 9, false)).not.toThrow();
    expect(() => registry.require("session-1", "key", 9, false)).not.toThrow();
  });

  it("rejects stale generations and missing leases", () => {
    const registry = new ComputerLeaseRegistry();
    expect(() => registry.require("session-1", "type", 1, false)).toThrow(/No computer observation/);
    registry.record("session-1", "accessibility", 5);
    expect(() => registry.require("session-1", "type", 4, false)).toThrow(/Stale observation generation/);
    registry.clear("session-1");
    expect(() => registry.require("session-1", "type", 5, false)).toThrow(/No computer observation/);
  });
});
