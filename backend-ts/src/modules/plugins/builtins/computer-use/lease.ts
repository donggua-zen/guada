import type { ComputerPolicyKey } from "./policy";

export type ObservationKind = "accessibility" | "screenshot" | "window_list";

export interface ObservationLease {
  kind: ObservationKind;
  generation: number;
}

/**
 * Session-scoped observation lease. An input must reference the generation of
 * the observation it was derived from; any input invalidates the lease.
 */
export class ComputerLeaseRegistry {
  private leases = new Map<string, ObservationLease>();

  record(sessionId: string, kind: ObservationKind, generation: number): void {
    if (!sessionId || !Number.isInteger(generation) || generation <= 0) return;
    this.leases.set(sessionId, { kind, generation });
  }

  clear(sessionId: string): void {
    if (!sessionId) return;
    this.leases.delete(sessionId);
  }

  require(
    sessionId: string,
    action: ComputerPolicyKey,
    expectedGeneration: number,
    hasPoint: boolean
  ): void {
    const lease = this.leases.get(sessionId);
    if (!lease) {
      throw new Error(
        "No computer observation is available. Call computer_observe or computer_a11y_observe before sending input."
      );
    }
    if (
      !Number.isInteger(expectedGeneration) ||
      expectedGeneration <= 0 ||
      lease.generation !== expectedGeneration
    ) {
      throw new Error(
        `Stale observation generation: expected ${lease.generation}, received ${expectedGeneration}. Re-observe before sending input.`
      );
    }

    const requiredKind = requiredObservationKind(action, hasPoint);
    if (requiredKind && lease.kind !== requiredKind) {
      throw new Error(
        `The "${action}" action requires a ${requiredKind} observation, but the latest observation is ${lease.kind}. Re-observe with the matching tool first.`
      );
    }
  }
}

export function requiredObservationKind(
  action: ComputerPolicyKey,
  hasPoint: boolean
): ObservationKind | null {
  switch (action) {
    case "click_element":
      return "accessibility";
    case "left_click":
    case "right_click":
    case "middle_click":
    case "double_click":
    case "triple_click":
    case "mouse_move":
      return "screenshot";
    case "focus_window":
      return "window_list";
    case "scroll":
      return hasPoint ? "screenshot" : null;
    case "type":
    case "key":
      return null;
    default:
      throw new Error(`Unsupported computer input action: ${action}`);
  }
}
