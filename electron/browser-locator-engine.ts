import { BrowserBridgeError } from "./browser-errors";
import { getIvyaBundleSource } from "./browser-locator-bundle";

export type LocatorKind =
  | "role"
  | "text"
  | "label"
  | "placeholder"
  | "testid"
  | "altText"
  | "title"
  | "selector";

export interface LocatorDescriptor {
  kind: LocatorKind;
  role?: string;
  name?: string | { __regexp: string; flags?: string };
  text?: string | { __regexp: string; flags?: string };
  testId?: string | { __regexp: string; flags?: string };
  selector?: string;
  exact?: boolean;
  index?: number;
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  includeHidden?: boolean;
  level?: number;
  pressed?: boolean;
  selected?: boolean;
  /**
   * 父链：由 locator.locator()/链式 getBy* 产生，从最外层到直接父级。
   * 每级只在自己的匹配元素内继续查询，index 作用于该级结果。
   */
  scope?: LocatorDescriptor[];
}

export interface LocatorCandidate {
  tag: string;
  id: string;
  text: string;
  inShadow: boolean;
  visible: boolean;
}

export interface LocatorQueryResult {
  count: number;
  matches: LocatorCandidate[];
}

export interface LocatorMaterializeResult {
  ok: boolean;
  count: number;
  selector?: string;
  token?: string;
  inShadow?: boolean;
  candidate?: LocatorCandidate;
  candidates?: LocatorCandidate[];
}

export interface LocatorWaitProbe {
  count: number;
  visibleCount: number;
}

export type LocatorWaitState = "attached" | "visible" | "hidden" | "detached";

const LOCATOR_WORLD_ID = 1009;

/**
 * 通过 ivya 在 isolated world 里查询 live DOM，并把匹配元素 materialize 成
 * 一个临时 CSS selector，交给现有 BrowserActionEngine 执行。
 *
 * 第一阶段只支持 light DOM 动作；shadow root 内元素可以查询，但动作返回
 * UNSUPPORTED。iframe 内元素不在当前 frame 的查询范围内。
 */
export class BrowserLocatorEngine {
  async ensureInjected(webContents: Electron.WebContents): Promise<void> {
    const injected = await this.runScript<boolean>(
      webContents,
      "return Boolean(globalThis.__guadaIvya && globalThis.__guadaIvya.version);",
    ).catch(() => false);
    if (injected === true) return;

    const source = getIvyaBundleSource();
    const result = await webContents.executeJavaScriptInIsolatedWorld(
      LOCATOR_WORLD_ID,
      [
        {
          code: `(() => {
            try {
              ${source}
              return { ok: Boolean(globalThis.__guadaIvya && globalThis.__guadaIvya.version), version: globalThis.__guadaIvya && globalThis.__guadaIvya.version };
            } catch (error) {
              return { ok: false, error: String((error && error.stack) || error) };
            }
          })()`,
        },
      ],
    );
    if (!result || result.ok !== true) {
      throw new BrowserBridgeError(
        "CALL_FAILED",
        "Failed to inject the ivya locator engine into the page.",
        { result },
      );
    }
  }

  async queryAll(
    webContents: Electron.WebContents,
    descriptor: LocatorDescriptor,
  ): Promise<LocatorQueryResult> {
    await this.ensureInjected(webContents);
    const result = await this.runDescriptorScript<LocatorQueryResult>(
      webContents,
      descriptor,
      `const matches = resolveDescriptor(d).map(describe);
       return { count: matches.length, matches };`,
    );
    if (!result || !Array.isArray(result.matches)) {
      throw new BrowserBridgeError(
        "CALL_FAILED",
        "ivya locator query returned an invalid result.",
        { descriptor, result },
      );
    }
    return result;
  }

  async materialize(
    webContents: Electron.WebContents,
    descriptor: LocatorDescriptor,
  ): Promise<LocatorMaterializeResult> {
    await this.ensureInjected(webContents);
    const result = await this.runDescriptorScript<LocatorMaterializeResult>(
      webContents,
      descriptor,
      `const matches = resolveDescriptor(d);
       if (matches.length === 0) {
         return { ok: false, count: 0, candidates: [] };
       }
       if (matches.length > 1) {
         return { ok: false, count: matches.length, candidates: matches.map(describe) };
       }
       const element = matches[0];
       const candidate = describe(element);
       if (candidate.inShadow) {
         return { ok: true, inShadow: true, count: 1, candidate };
       }
       const token = "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
       element.setAttribute("data-guada-loc", token);
       return {
         ok: true,
         count: 1,
         selector: '[data-guada-loc="' + token + '"]',
         token,
         inShadow: false,
         candidate,
       };`,
    );
    if (!result || typeof result !== "object") {
      throw new BrowserBridgeError(
        "CALL_FAILED",
        "ivya locator materialization returned an invalid result.",
        { descriptor, result },
      );
    }
    return result;
  }

  async release(webContents: Electron.WebContents, token: string): Promise<void> {
    try {
      await this.runScript(
        webContents,
        `document.querySelectorAll('[data-guada-loc="${escapeAttribute(token)}"]').forEach(function (el) {
           el.removeAttribute('data-guada-loc');
         });
         return true;`,
      );
    } catch {
      // 页面导航/销毁后元素自然消失，忽略清理失败。
    }
  }

  async text(
    webContents: Electron.WebContents,
    descriptor: LocatorDescriptor,
  ): Promise<string> {
    await this.ensureInjected(webContents);
    const result = await this.runDescriptorScript<string>(
      webContents,
      descriptor,
      `const matches = resolveDescriptor(d);
       if (!matches.length) return "";
       return String(matches[0].innerText || matches[0].textContent || "").trim();`,
    );
    return typeof result === "string" ? result : "";
  }

  async isVisible(
    webContents: Electron.WebContents,
    descriptor: LocatorDescriptor,
  ): Promise<boolean> {
    await this.ensureInjected(webContents);
    const result = await this.runDescriptorScript<boolean>(
      webContents,
      descriptor,
      `const matches = resolveDescriptor(includeHiddenTail(d));
       return matches.some(isVisibleElement);`,
    );
    return result === true;
  }

  async waitProbe(
    webContents: Electron.WebContents,
    descriptor: LocatorDescriptor,
  ): Promise<LocatorWaitProbe> {
    await this.ensureInjected(webContents);
    const result = await this.runDescriptorScript<LocatorWaitProbe>(
      webContents,
      descriptor,
      `const matches = resolveDescriptor(includeHiddenTail(d));
       return { count: matches.length, visibleCount: matches.filter(isVisibleElement).length };`,
    );
    if (!result || typeof result.count !== "number") {
      return { count: 0, visibleCount: 0 };
    }
    return result;
  }

  async waitFor(
    webContents: Electron.WebContents,
    descriptor: LocatorDescriptor,
    state: LocatorWaitState,
    timeout: number,
  ): Promise<{ ok: true; found: true; state: LocatorWaitState; descriptor: LocatorDescriptor }> {
    const safeTimeout = Math.min(30_000, Math.max(100, Math.round(timeout)));
    const deadline = Date.now() + safeTimeout;
    const interval = 100;

    for (;;) {
      const probe = await this.waitProbe(webContents, descriptor);
      const done =
        state === "attached"
          ? probe.count > 0
          : state === "visible"
            ? probe.visibleCount > 0
            : state === "hidden"
              ? probe.count > 0 && probe.visibleCount === 0
              : probe.count === 0;
      if (done) {
        return { ok: true, found: true, state, descriptor };
      }
      if (Date.now() >= deadline) {
        throw new BrowserBridgeError(
          "TIMEOUT",
          `Timed out after ${safeTimeout}ms waiting for locator to be ${state}.`,
          { state, timeout: safeTimeout, descriptor, probe },
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(interval, Math.max(1, deadline - Date.now()))),
      );
    }
  }

  private async runDescriptorScript<T>(
    webContents: Electron.WebContents,
    descriptor: LocatorDescriptor,
    body: string,
  ): Promise<T> {
    return this.runScript<T>(
      webContents,
      `const d = ${JSON.stringify(descriptor)};
       const ivya = globalThis.__guadaIvya && globalThis.__guadaIvya.ivya;
       if (!ivya) return { __error: "ivya engine is not injected" };
       ${LOCATOR_HELPERS}
       ${body}`,
    );
  }

  private async runScript<T>(
    webContents: Electron.WebContents,
    body: string,
  ): Promise<T> {
    if (webContents.isDestroyed()) {
      throw new BrowserBridgeError("TAB_NOT_FOUND", "The tab was destroyed.");
    }
    const result = await webContents.executeJavaScriptInIsolatedWorld(
      LOCATOR_WORLD_ID,
      [{ code: `(() => {\n${body}\n})()` }],
    );
    if (result && typeof result === "object" && "__error" in result) {
      throw new BrowserBridgeError("CALL_FAILED", String((result as any).__error));
    }
    return result as T;
  }
}

export function flattenLocatorChain(descriptor: LocatorDescriptor): LocatorDescriptor[] {
  const steps: LocatorDescriptor[] = [];
  const walk = (step: LocatorDescriptor | undefined): void => {
    if (!step || typeof step !== "object") return;
    if (Array.isArray(step.scope)) {
      for (const parent of step.scope) walk(parent);
    }
    const copy: LocatorDescriptor = { ...step };
    delete copy.scope;
    steps.push(copy);
  };
  walk(descriptor);
  return steps;
}

/** 链式 locator 的末级（没有父链时就是 descriptor 本身）。 */
export function locatorTail(descriptor: LocatorDescriptor): LocatorDescriptor | undefined {
  const steps = flattenLocatorChain(descriptor);
  return steps[steps.length - 1];
}

/** 把 includeHidden 加到链式 locator 的末级，父链保持原选项。 */
export function setTailIncludeHidden(
  descriptor: LocatorDescriptor,
  value: boolean,
): LocatorDescriptor {
  const steps = flattenLocatorChain(descriptor);
  if (!steps.length) return descriptor;
  const tail: LocatorDescriptor = { ...steps[steps.length - 1], includeHidden: value };
  if (steps.length === 1) return tail;
  return { ...tail, scope: steps.slice(0, -1) };
}

const LOCATOR_HELPERS = `
  const revive = (value) => {
    if (value && typeof value === "object" && typeof value.__regexp === "string") {
      return new RegExp(value.__regexp, value.flags || "");
    }
    return value;
  };
  const isVisibleElement = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const describe = (el) => {
    const root = el.getRootNode && el.getRootNode();
    const inShadow = Boolean(root && root.host && root.mode);
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : "",
      id: el.id || "",
      text: String(el.innerText || el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 200),
      inShadow,
      visible: isVisibleElement(el),
    };
  };
  const applyIndex = (matches, descriptor) => {
    if (typeof descriptor.index !== "number" || !Number.isFinite(descriptor.index)) return matches;
    const index = Math.trunc(descriptor.index);
    const picked = index < 0 ? matches[matches.length + index] : matches[index];
    return picked ? [picked] : [];
  };
  const roleOptions = (descriptor) => {
    const options = {};
    if (descriptor.name !== undefined) options.name = revive(descriptor.name);
    if (descriptor.exact !== undefined) options.exact = descriptor.exact;
    if (descriptor.checked !== undefined) options.checked = descriptor.checked;
    if (descriptor.disabled !== undefined) options.disabled = descriptor.disabled;
    if (descriptor.expanded !== undefined) options.expanded = descriptor.expanded;
    if (descriptor.includeHidden !== undefined) options.includeHidden = descriptor.includeHidden;
    if (descriptor.level !== undefined) options.level = descriptor.level;
    if (descriptor.pressed !== undefined) options.pressed = descriptor.pressed;
    if (descriptor.selected !== undefined) options.selected = descriptor.selected;
    return options;
  };
  const queryElements = (descriptor, root) => {
    if (descriptor.kind === "role") {
      return ivya.queryAllByRole(descriptor.role, roleOptions(descriptor), root);
    }
    if (descriptor.kind === "text") {
      return ivya.queryAllByText(revive(descriptor.text), { exact: descriptor.exact === true }, root);
    }
    if (descriptor.kind === "label") {
      return ivya.queryAllByLabelText(revive(descriptor.text), { exact: descriptor.exact === true }, root);
    }
    if (descriptor.kind === "placeholder") {
      return ivya.queryAllByPlaceholder(revive(descriptor.text), { exact: descriptor.exact === true }, root);
    }
    if (descriptor.kind === "testid") {
      return ivya.queryAllByTestId(revive(descriptor.testId), root);
    }
    if (descriptor.kind === "altText") {
      return ivya.queryAllByAltText(revive(descriptor.text), { exact: descriptor.exact === true }, root);
    }
    if (descriptor.kind === "title") {
      return ivya.queryAllByTitle(revive(descriptor.text), { exact: descriptor.exact === true }, root);
    }
    if (descriptor.kind === "selector") {
      return Array.from(root.querySelectorAll(descriptor.selector));
    }
    return [];
  };
  const chainOf = (descriptor) => {
    const steps = [];
    const walk = (step) => {
      if (!step || typeof step !== "object") return;
      if (Array.isArray(step.scope)) {
        for (let i = 0; i < step.scope.length; i++) walk(step.scope[i]);
      }
      const copy = Object.assign({}, step);
      delete copy.scope;
      steps.push(copy);
    };
    walk(descriptor);
    return steps;
  };
  const resolveDescriptor = (descriptor) => {
    const steps = chainOf(descriptor);
    let roots = [document];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const collected = [];
      const seen = new Set();
      for (let r = 0; r < roots.length; r++) {
        const found = queryElements(step, roots[r]);
        for (let f = 0; f < found.length; f++) {
          if (seen.has(found[f])) continue;
          seen.add(found[f]);
          collected.push(found[f]);
        }
      }
      roots = applyIndex(collected, step);
    }
    return roots;
  };
  const includeHiddenTail = (descriptor) => {
    const steps = chainOf(descriptor);
    if (!steps.length) return descriptor;
    steps[steps.length - 1].includeHidden = true;
    const tail = steps[steps.length - 1];
    if (steps.length === 1) return tail;
    return Object.assign({}, tail, { scope: steps.slice(0, -1) });
  };
`;

function escapeAttribute(value: string): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
