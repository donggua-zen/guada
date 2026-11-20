import type { Directive, DirectiveBinding } from "vue";
import {
  showTooltip,
  hideTooltip,
  refreshTooltip,
  type TooltipEffect,
  type TooltipPlacement,
} from "@/components/ui/tooltip";

/**
 * `v-tooltip` 指令：把 tooltip 行为挂到真实触发元素上，不产生额外 DOM。
 *
 * 用法：
 * - `v-tooltip="text"`（默认 top / dark）
 * - `v-tooltip:bottom="text"`（指定方向）
 * - `v-tooltip="{ content, placement, effect }"`（对象形式）
 * - `v-tooltip.light="text"`（浅色浮层）
 *
 * 与 `GdTooltip` 共用 `components/ui/tooltip.ts` 的单例浮层；区别是不包 wrapper，
 * 因此不会在 flex 行里额外产生一个 flex item。
 */

export interface TooltipBindingObject {
  content?: string;
  placement?: TooltipPlacement;
  effect?: TooltipEffect;
}

export type TooltipBindingValue =
  | string
  | TooltipBindingObject
  | null
  | undefined;

interface NormalizedTooltip {
  content: string;
  placement: TooltipPlacement;
  effect: TooltipEffect;
}

interface TooltipState extends NormalizedTooltip {
  handlers: {
    mouseenter: () => void;
    mouseleave: () => void;
    focus: () => void;
    blur: () => void;
    click: () => void;
  };
}

const PLACEMENTS = new Set<TooltipPlacement>([
  "top",
  "bottom",
  "left",
  "right",
]);
const states = new WeakMap<HTMLElement, TooltipState>();

function normalize(
  binding: DirectiveBinding<TooltipBindingValue>,
): NormalizedTooltip {
  const arg =
    binding.arg && PLACEMENTS.has(binding.arg as TooltipPlacement)
      ? (binding.arg as TooltipPlacement)
      : undefined;
  const defaultEffect: TooltipEffect = binding.modifiers.light
    ? "light"
    : "dark";
  const value = binding.value;

  if (typeof value === "string") {
    return { content: value, placement: arg ?? "top", effect: defaultEffect };
  }
  if (value && typeof value === "object") {
    return {
      content: value.content ?? "",
      placement: value.placement ?? arg ?? "top",
      effect: value.effect ?? defaultEffect,
    };
  }
  return { content: "", placement: arg ?? "top", effect: defaultEffect };
}

export const tooltipDirective: Directive<HTMLElement, TooltipBindingValue> = {
  mounted(el, binding) {
    const initial = normalize(binding);
    const show = (): void => {
      const state = states.get(el);
      if (state?.content) {
        showTooltip(el, state.content, state.placement, state.effect);
      }
    };
    const hide = (): void => hideTooltip();
    const state: TooltipState = {
      ...initial,
      handlers: {
        mouseenter: show,
        mouseleave: hide,
        focus: show,
        blur: hide,
        click: hide,
      },
    };
    for (const [name, handler] of Object.entries(state.handlers)) {
      el.addEventListener(name, handler);
    }
    states.set(el, state);
  },

  updated(el, binding) {
    const state = states.get(el);
    if (!state) return;
    const next = normalize(binding);
    const changed =
      next.content !== state.content ||
      next.placement !== state.placement ||
      next.effect !== state.effect;

    state.content = next.content;
    state.placement = next.placement;
    state.effect = next.effect;
    if (!changed) return;

    if (!next.content) {
      hideTooltip();
      return;
    }
    // 只在当前浮层正锚定在本元素且可见时才刷新；未显示时下次 hover 用新值。
    refreshTooltip(el, next.content, next.placement, next.effect);
  },

  beforeUnmount(el) {
    const state = states.get(el);
    if (!state) return;
    for (const [name, handler] of Object.entries(state.handlers)) {
      el.removeEventListener(name, handler);
    }
    states.delete(el);
    hideTooltip();
  },
};

declare module "vue" {
  interface GlobalDirectives {
    vTooltip: typeof tooltipDirective;
  }
}
