export type ComputerPolicyDecision = "allow" | "ask" | "deny";

export const COMPUTER_POLICY_KEYS = [
  "screenshot",
  "a11y_observe",
  "list_windows",
  "click_element",
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "mouse_move",
  "type",
  "key",
  "scroll",
  "focus_window",
] as const;

export type ComputerPolicyKey = (typeof COMPUTER_POLICY_KEYS)[number];

export type ComputerPolicy = Record<ComputerPolicyKey, ComputerPolicyDecision>;

export const DEFAULT_COMPUTER_POLICY: ComputerPolicy = {
  screenshot: "allow",
  a11y_observe: "allow",
  list_windows: "allow",
  click_element: "ask",
  left_click: "ask",
  right_click: "ask",
  middle_click: "ask",
  double_click: "ask",
  triple_click: "ask",
  mouse_move: "allow",
  type: "ask",
  key: "ask",
  scroll: "ask",
  focus_window: "ask",
};

export function isComputerPolicyKey(value: string): value is ComputerPolicyKey {
  return (COMPUTER_POLICY_KEYS as readonly string[]).includes(value);
}

export interface ComputerUseSettings {
  /** Default off: desktop control is opt-in. */
  enabled: boolean;
  actions: ComputerPolicy;
}

export function normalizeComputerUseSettings(raw: unknown): ComputerUseSettings {
  const object = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    enabled: object.enabled === true,
    actions: normalizeComputerPolicy(object.actions),
  };
}

export function normalizeComputerPolicy(raw: unknown): ComputerPolicy {
  const result: ComputerPolicy = { ...DEFAULT_COMPUTER_POLICY };
  if (!raw || typeof raw !== "object") return result;
  for (const key of COMPUTER_POLICY_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === "allow" || value === "ask" || value === "deny") {
      result[key] = value;
    }
  }
  return result;
}
