import { EventEmitter2 } from "@nestjs/event-emitter";
import { PluginHookRegistry } from "./plugin-hook.registry";

describe("PluginHookRegistry", () => {
  let emitter: EventEmitter2;
  let registry: PluginHookRegistry;
  let enabled: Record<string, boolean>;

  beforeEach(() => {
    emitter = new EventEmitter2();
    registry = new PluginHookRegistry(emitter);
    enabled = {};
    registry.setEnabledResolver((id) => enabled[id] !== false);
  });

  function firstListener(event: string) {
    const listeners = emitter.listeners(event) as Array<(p: unknown) => unknown>;
    expect(listeners.length).toBeGreaterThan(0);
    return listeners[0];
  }

  it("runs serial hooks in order and skips disabled plugins", async () => {
    const calls: string[] = [];
    registry.register("p1", {
      event: "agent.pre_step",
      order: 2,
      handler: () => {
        calls.push("p1");
      },
    });
    registry.register("p2", {
      event: "agent.pre_step",
      order: 1,
      handler: () => {
        calls.push("p2");
      },
    });
    enabled.p2 = false;

    await firstListener("agent.pre_step")({});
    expect(calls).toEqual(["p1"]);
  });

  it("ignores values returned by agent.pre_step (side-effect only)", async () => {
    registry.register("p1", {
      event: "agent.pre_step",
      handler: () => ({ kind: "enter" }),
    });
    const result = await firstListener("agent.pre_step")({});
    expect(result).toBeUndefined();
  });

  it("accepts only {kind:'retry'} from agent.request_error", async () => {
    registry.register("p1", {
      event: "agent.request_error",
      handler: () => ({ kind: "retry" }),
    });
    expect(await firstListener("agent.request_error")({})).toEqual({ kind: "retry" });
  });

  it("sanitizes invalid turn.stopping decisions", async () => {
    registry.register("p1", {
      event: "turn.stopping",
      handler: () => ({ kind: "continue", messages: "oops" }),
    });
    expect(await firstListener("turn.stopping")({})).toBeUndefined();
  });

  it("passes valid turn.stopping decisions through", async () => {
    registry.register("p1", {
      event: "turn.stopping",
      handler: () => ({ kind: "continue", messages: ["more"] }),
    });
    expect(await firstListener("turn.stopping")({})).toEqual({
      kind: "continue",
      messages: ["more"],
    });
  });

  it("unregisters a plugin's hooks", async () => {
    registry.register("p1", { event: "turn.stopping", handler: () => undefined });
    expect(registry.size()).toBe(1);
    registry.unregisterPlugin("p1");
    expect(registry.size()).toBe(0);
  });

  it("does not let plugin exceptions break the chain", async () => {
    const calls: string[] = [];
    registry.register("p1", {
      event: "agent.pre_step",
      handler: () => {
        throw new Error("boom");
      },
    });
    registry.register("p2", {
      event: "agent.pre_step",
      handler: () => {
        calls.push("p2");
      },
    });
    await firstListener("agent.pre_step")({});
    expect(calls).toEqual(["p2"]);
  });
});
