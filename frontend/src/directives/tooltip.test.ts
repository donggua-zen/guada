import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  showTooltip: vi.fn(),
  hideTooltip: vi.fn(),
  refreshTooltip: vi.fn(),
}));

vi.mock("@/components/ui/tooltip", () => mocks);

import { tooltipDirective } from "./tooltip";

type FakeElement = HTMLElement & {
  fire: (name: string) => void;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function createEl(): FakeElement {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const el = {
    addEventListener: vi.fn((name: string, fn: (event: Event) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
    }),
    removeEventListener: vi.fn((name: string, fn: (event: Event) => void) => {
      listeners.get(name)?.delete(fn);
    }),
    fire(name: string) {
      listeners.get(name)?.forEach((fn) => fn(new Event(name)));
    },
  };
  return el as unknown as FakeElement;
}

function bind(
  value: unknown,
  arg?: string,
  modifiers: Record<string, boolean> = {},
): any {
  return { value, arg, modifiers };
}

describe("v-tooltip directive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mounted 挂监听，mouseenter 按方向和内容展示", () => {
    const el = createEl();
    (tooltipDirective as any).mounted(el, bind("hello", "bottom"));

    el.fire("mouseenter");
    expect(mocks.showTooltip).toHaveBeenCalledWith(
      el,
      "hello",
      "bottom",
      "dark",
    );

    el.fire("mouseleave");
    expect(mocks.hideTooltip).toHaveBeenCalled();
  });

  it("updated 只在内容/方向变化时刷新", () => {
    const el = createEl();
    (tooltipDirective as any).mounted(el, bind("a"));

    (tooltipDirective as any).updated(el, bind("a"));
    expect(mocks.refreshTooltip).not.toHaveBeenCalled();

    (tooltipDirective as any).updated(el, bind("b"));
    expect(mocks.refreshTooltip).toHaveBeenCalledWith(el, "b", "top", "dark");
  });

  it("对象形式与 light 效果", () => {
    const el = createEl();
    (tooltipDirective as any).mounted(
      el,
      bind({ content: "x", placement: "right", effect: "light" }),
    );

    el.fire("mouseenter");
    expect(mocks.showTooltip).toHaveBeenCalledWith(
      el,
      "x",
      "right",
      "light",
    );
  });

  it("空内容不展示；更新为空时隐藏", () => {
    const el = createEl();
    (tooltipDirective as any).mounted(el, bind(""));
    el.fire("mouseenter");
    expect(mocks.showTooltip).not.toHaveBeenCalled();

    (tooltipDirective as any).updated(el, bind("x"));
    (tooltipDirective as any).updated(el, bind(""));
    expect(mocks.hideTooltip).toHaveBeenCalled();
  });

  it("beforeUnmount 移除全部监听并隐藏", () => {
    const el = createEl();
    (tooltipDirective as any).mounted(el, bind("x"));
    (tooltipDirective as any).beforeUnmount(el);

    expect(el.removeEventListener).toHaveBeenCalledTimes(5);
    expect(mocks.hideTooltip).toHaveBeenCalled();

    el.fire("mouseenter");
    expect(mocks.showTooltip).not.toHaveBeenCalled();
  });
});
