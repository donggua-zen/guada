import log from "electron-log/main";
import { BrowserBridgeError } from "./browser-errors";

export type ScrollAlignment = "center" | "end" | "start" | "nearest";
export type WaitState = "attached" | "visible" | "hidden" | "detached";
export type MouseButton = "left" | "right" | "middle";

export interface ActionProbe {
  found: boolean;
  visible: boolean;
  enabled: boolean;
  editable: boolean;
  stable: boolean;
  inViewport: boolean;
  covered: boolean;
  tagName: string;
  type?: string;
  checked?: boolean;
  value?: string;
  valueLength?: number;
  selectedValues?: string[];
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
}

export interface ActionOptions {
  button?: MouseButton;
  clickCount?: number;
  modifiers?: string[];
  force?: boolean;
  timeout?: number;
  trusted?: boolean;
}

export interface FillOptions {
  force?: boolean;
  timeout?: number;
  trusted?: boolean;
}

export interface PressOptions {
  selector?: string;
  modifiers?: string[];
  timeout?: number;
  trusted?: boolean;
}

export interface ScrollOptions {
  selector?: string;
  deltaX?: number;
  deltaY?: number;
  timeout?: number;
}

export interface SelectOptions {
  force?: boolean;
  timeout?: number;
}

export interface ActionEngineHost {
  isWindowVisible(windowId: string): boolean;
  setWebviewRenderable(windowId: string, renderable: boolean): void;
}

const DEFAULT_ACTION_TIMEOUT_MS = 3000;
const MAX_ACTION_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 75;
const STABILITY_SAMPLE_MS = 50;
const DISPATCH_SETTLE_MS = 50;

interface ActionRequirements {
  enabled?: boolean;
  editable?: boolean;
  stable?: boolean;
  covered?: boolean;
}

/**
 * 统一动作引擎。
 *
 * 所有会改变页面状态的输入都先经过同一条 actionability 探测：
 * 可见、启用、可编辑、稳定、未被遮挡。探测通过后优先用
 * webContents.sendInputEvent 发送 trusted 输入，CDP 作为兜底。
 */
export class BrowserActionEngine {
  constructor(private readonly host: ActionEngineHost) {}

  async elementState(
    webContents: Electron.WebContents,
    selector: string,
  ): Promise<ActionProbe & { ok: true }> {
    const probe = await this.probe(webContents, selector, "center");
    return { ok: true, ...probe };
  }

  async click(
    webContents: Electron.WebContents,
    windowId: string,
    selector: string,
    options: ActionOptions = {},
  ): Promise<any> {
    const probe = await this.waitForActionable(webContents, selector, options, {
      enabled: true,
      editable: false,
      stable: true,
      covered: true,
    });
    await this.dispatchClick(webContents, windowId, selector, probe, options);
    return this.result(webContents, "click", selector, {
      button: normalizeButton(options.button),
      clickCount: normalizeClickCount(options.clickCount),
    });
  }

  async hover(
    webContents: Electron.WebContents,
    windowId: string,
    selector: string,
    options: ActionOptions = {},
  ): Promise<any> {
    const probe = await this.waitForActionable(webContents, selector, options, {
      enabled: false,
      editable: false,
      stable: true,
      covered: true,
    });
    const point = centerPoint(probe);
    await this.dispatchMouseMove(webContents, windowId, point.x, point.y, options.trusted !== false);
    return this.result(webContents, "hover", selector);
  }

  async press(
    webContents: Electron.WebContents,
    windowId: string,
    key: string,
    options: PressOptions = {},
  ): Promise<any> {
    const parsed = parseKeyCombo(key);
    const modifiers = [...parsed.modifiers, ...(options.modifiers || [])];
    let selector = options.selector;
    if (selector) {
      await this.waitForActionable(webContents, selector, options, {
        enabled: true,
        editable: false,
        stable: true,
        covered: true,
      });
      await this.focusElement(webContents, selector);
    } else {
      webContents.focus();
    }

    if (options.trusted === false) {
      await this.dispatchKeyScript(webContents, parsed, modifiers);
    } else {
      try {
        this.dispatchKeyElectron(webContents, parsed, modifiers);
      } catch (error: any) {
        log.warn(`sendInputEvent key failed, falling back to CDP: ${error?.message || error}`);
        await this.dispatchKeyCdp(webContents, windowId, parsed, modifiers);
      }
    }

    await sleep(DISPATCH_SETTLE_MS);
    return this.result(webContents, "press", selector, { key });
  }

  async scroll(
    webContents: Electron.WebContents,
    windowId: string,
    options: ScrollOptions = {},
  ): Promise<any> {
    const viewport = await this.viewportSize(webContents);
    let x = Math.round(viewport.width / 2);
    let y = Math.round(viewport.height / 2);
    if (options.selector) {
      const probe = await this.waitForActionable(
        webContents,
        options.selector,
        options,
        { enabled: false, stable: false, covered: false },
      );
      const point = centerPoint(probe);
      x = point.x;
      y = point.y;
    }
    const dx = Number.isFinite(Number(options.deltaX)) ? Number(options.deltaX) : 0;
    const dy = Number.isFinite(Number(options.deltaY))
      ? Number(options.deltaY)
      : dx === 0
        ? Math.round(Math.max(200, viewport.height * 0.8))
        : 0;

    const before = await this.readScrollState(webContents, options.selector);
    try {
      webContents.sendInputEvent({
        type: "mouseWheel",
        x,
        y,
        deltaX: dx,
        deltaY: dy,
        canScroll: true,
      } as any);
    } catch (error: any) {
      log.warn(`sendInputEvent wheel failed, falling back to CDP: ${error?.message || error}`);
      await this.dispatchWheelCdp(webContents, windowId, x, y, dx, dy);
    }

    await sleep(120);
    let after = await this.readScrollState(webContents, options.selector);
    let changed = scrollChanged(before, after);

    if (!changed) {
      // 隐藏窗口里 sendInputEvent 的 wheel 可能被吞掉；用 CDP 再试一次。
      try {
        await this.dispatchWheelCdp(webContents, windowId, x, y, dx, dy);
        await sleep(120);
        after = await this.readScrollState(webContents, options.selector);
        changed = scrollChanged(before, after);
      } catch (error: any) {
        log.warn(`CDP wheel failed: ${error?.message || error}`);
      }
    }

    if (!changed) {
      // 最后兜底：直接调用 scrollBy。CSS overflow 容器也能覆盖。
      await webContents.executeJavaScript(
        `(() => {
          const el = ${options.selector ? `document.querySelector(${JSON.stringify(options.selector)})` : "null"};
          if (el && typeof el.scrollBy === 'function') el.scrollBy(${dx}, ${dy});
          else window.scrollBy(${dx}, ${dy});
        })()`,
        false,
      );
      await sleep(80);
      after = await this.readScrollState(webContents, options.selector);
    }

    return this.result(webContents, "scroll", options.selector, {
      deltaX: dx,
      deltaY: dy,
      scrollX: after.x,
      scrollY: after.y,
      ...(options.selector
        ? {
            elementScrollLeft: after.elementX,
            elementScrollTop: after.elementY,
          }
        : {}),
    });
  }

  async selectOption(
    webContents: Electron.WebContents,
    selector: string,
    values: unknown,
    options: SelectOptions = {},
  ): Promise<any> {
    if (values === undefined || values === null) {
      throw new BrowserBridgeError(
        "INVALID_ARGUMENT",
        "selectOption(target, values) requires a value, label, index, or array of them.",
      );
    }
    const probe = await this.waitForActionable(webContents, selector, options, {
      enabled: true,
      stable: true,
      covered: true,
    });
    if (probe.tagName.toLowerCase() !== "select") {
      throw new BrowserBridgeError(
        "UNSUPPORTED",
        `selectOption requires a <select>, got <${probe.tagName.toLowerCase()}>.`,
        { selector, tagName: probe.tagName },
      );
    }

    const result = await webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el || el.tagName !== 'SELECT') return { ok: false, error: 'not-select' };
        const raw = ${JSON.stringify(values)};
        const wanted = Array.isArray(raw) ? raw : [raw];
        if (wanted.length === 0) return { ok: false, error: 'empty-values' };
        const norm = wanted.map((v) => (v && typeof v === 'object' ? v : { value: String(v) }));
        const options = Array.from(el.options);
        const matched = [];
        for (const item of norm) {
          let opt;
          if (item.index !== undefined) opt = options[Number(item.index)];
          else if (item.label !== undefined) opt = options.find((o) => o.label.trim() === String(item.label));
          else opt = options.find((o) => o.value === String(item.value));
          if (!opt) return { ok: false, error: 'option-not-found', item };
          matched.push(opt);
        }
        if (!el.multiple && matched.length > 1) return { ok: false, error: 'not-multiple' };
        if (!el.multiple) {
          matched[0].selected = true;
        } else {
          for (const opt of options) opt.selected = matched.indexOf(opt) >= 0;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, selected: Array.from(el.selectedOptions).map((o) => o.value) };
      })()`,
      false,
    );

    if (!result || result.ok !== true) {
      throw new BrowserBridgeError(
        "ACTION_FAILED",
        `selectOption failed for "${selector}": ${result?.error || "unknown error"}`,
        { selector, result },
      );
    }

    return this.result(webContents, "select", selector, {
      selected: result.selected || [],
    });
  }

  async check(
    webContents: Electron.WebContents,
    windowId: string,
    selector: string,
    checked: boolean,
    options: ActionOptions = {},
  ): Promise<any> {
    const initial = await this.waitForActionable(webContents, selector, options, {
      enabled: true,
      stable: true,
      covered: true,
    });
    const tag = initial.tagName.toLowerCase();
    const type = String(initial.type || "").toLowerCase();
    if (tag !== "input" || (type !== "checkbox" && type !== "radio")) {
      throw new BrowserBridgeError(
        "UNSUPPORTED",
        `check/uncheck requires a checkbox or radio input, got <${tag}${type ? ` type="${type}"` : ""}>.`,
        { selector, tagName: tag, type },
      );
    }
    if (type === "radio" && checked === false) {
      throw new BrowserBridgeError(
        "UNSUPPORTED",
        "A radio input cannot be unchecked directly; check another radio in the group instead.",
        { selector },
      );
    }

    if (initial.checked === checked) {
      return this.result(webContents, "check", selector, { checked });
    }

    let last = initial;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.dispatchClick(webContents, windowId, selector, last, options);
      await sleep(75);
      last = await this.probe(webContents, selector, "center");
      if (last.checked === checked) {
        return this.result(webContents, "check", selector, { checked });
      }
    }

    throw new BrowserBridgeError(
      "ACTION_FAILED",
      `Failed to ${checked ? "check" : "uncheck"} "${selector}"; state did not change.`,
      { selector, expected: checked, actual: last.checked, probe: last },
    );
  }

  async fill(
    webContents: Electron.WebContents,
    windowId: string,
    selector: string,
    value: string,
    options: FillOptions = {},
  ): Promise<any> {
    // 先做一次轻量探测，让 select/file/checkbox 明确报 UNSUPPORTED，
    // 而不是先等 editable 超时再报 NOT_ACTIONABLE。
    const initial = await this.probe(webContents, selector, "center");
    if (initial.found) {
      const initialTag = initial.tagName.toLowerCase();
      const initialType = String(initial.type || "").toLowerCase();
      if (initialTag === "select") {
        throw new BrowserBridgeError(
          "UNSUPPORTED",
          "fill() cannot set a <select>; use tab.selectOption(target, values).",
          { selector, tagName: initialTag },
        );
      }
      if (
        initialTag === "input" &&
        ["file", "checkbox", "radio", "button", "submit", "reset", "image"].includes(
          initialType,
        )
      ) {
        throw new BrowserBridgeError(
          "UNSUPPORTED",
          `fill() does not support input type="${initialType}"; use tab.check() for checkboxes/radios, or file upload tooling for files.`,
          { selector, tagName: initialTag, type: initialType },
        );
      }
    }

    const probe = await this.waitForActionable(webContents, selector, options, {
      enabled: true,
      editable: true,
      stable: true,
      covered: true,
    });

    const tag = probe.tagName.toLowerCase();
    const type = String(probe.type || "").toLowerCase();
    if (tag === "select") {
      throw new BrowserBridgeError(
        "UNSUPPORTED",
        "fill() cannot set a <select>; use tab.selectOption(target, values).",
        { selector, tagName: tag },
      );
    }
    if (tag === "input" && (type === "file" || type === "checkbox" || type === "radio")) {
      throw new BrowserBridgeError(
        "UNSUPPORTED",
        `fill() does not support input type="${type}"; use tab.check() for checkboxes/radios, or file upload tooling for files.`,
        { selector, tagName: tag, type },
      );
    }

    await this.focusElement(webContents, selector);
    await this.selectAll(webContents, selector);

    let filled = false;
    if (options.trusted !== false && value.length > 0) {
      try {
        await this.withCdp(webContents, windowId, async (send) => {
          await send("Input.insertText", { text: value });
        });
        filled = true;
      } catch (error: any) {
        log.warn(`CDP insertText failed, falling back to native setter: ${error?.message || error}`);
      }
    }

    if (!filled) {
      filled = await this.setValueScript(webContents, selector, value);
    }

    await sleep(DISPATCH_SETTLE_MS);
    let after = await this.probe(webContents, selector, "center");
    if (!this.fillMatches(after, value, tag, type) && filled) {
      // CDP insertText 在 date/number 等输入上可能“成功”但没有写入目标值；
      // 再用 native setter 兜底一次，避免把可修复的场景判死。
      const scriptFilled = await this.setValueScript(webContents, selector, value);
      if (scriptFilled) {
        await sleep(DISPATCH_SETTLE_MS);
        after = await this.probe(webContents, selector, "center");
      }
    }

    if (!filled || !this.fillMatches(after, value, tag, type)) {
      const expectedLength = value.length;
      const actualValue = tag === "input" && type === "password"
        ? undefined
        : after.value;
      throw new BrowserBridgeError(
        "ACTION_FAILED",
        `fill() did not update "${selector}" to the requested value.`,
        {
          selector,
          expectedLength,
          actualLength: after.valueLength,
          ...(actualValue === undefined ? {} : { actualValue }),
        },
      );
    }

    return this.result(webContents, "fill", selector, { value });
  }

  private fillMatches(
    probe: ActionProbe,
    value: string,
    tag: string,
    type: string,
  ): boolean {
    if (probe.valueLength !== value.length) return false;
    // password 不回读明文，只比较长度
    if (tag === "input" && type === "password") return true;
    return probe.value === undefined || probe.value === value;
  }

  async waitForState(
    webContents: Electron.WebContents,
    selector: string,
    state: WaitState,
    timeout: number,
  ): Promise<any> {
    const safeTimeout = normalizeTimeout(timeout);
    const result = await webContents.executeJavaScript(
      `new Promise((resolve) => {
        const selector = ${JSON.stringify(selector)};
        const state = ${JSON.stringify(state)};
        const started = Date.now();
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        };
        const check = () => {
          const el = document.querySelector(selector);
          let done = false;
          if (state === 'attached') done = !!el;
          else if (state === 'detached') done = !el;
          else if (state === 'visible') done = isVisible(el);
          else if (state === 'hidden') done = !isVisible(el);
          if (done) {
            clearInterval(timer);
            resolve({ ok: true });
          } else if (Date.now() - started >= ${safeTimeout}) {
            clearInterval(timer);
            resolve({ ok: false });
          }
        };
        const timer = setInterval(check, 50);
        check();
      })`,
      true,
    );

    if (!result || result.ok !== true) {
      throw new BrowserBridgeError(
        "TIMEOUT",
        `Timed out after ${safeTimeout}ms waiting for "${selector}" to be ${state}.`,
        { selector, state, timeout: safeTimeout },
      );
    }

    return { ok: true, found: true, selector, state };
  }

  // ── 探测 ──

  private async probe(
    webContents: Electron.WebContents,
    selector: string,
    alignment: ScrollAlignment,
  ): Promise<ActionProbe> {
    const raw = await webContents.executeJavaScript(
      buildProbeScript(selector, alignment),
      false,
    );
    return normalizeProbe(raw);
  }

  private async waitForActionable(
    webContents: Electron.WebContents,
    selector: string,
    options: { force?: boolean; timeout?: number },
    requirements: ActionRequirements,
  ): Promise<ActionProbe> {
    const timeout = normalizeTimeout(options.timeout);
    const deadline = Date.now() + timeout;
    const alignments: ScrollAlignment[] = ["center", "end", "start", "nearest"];
    let last: ActionProbe | null = null;
    let lastReason: string | undefined;
    let lastError: unknown;
    let everFound = false;

    for (let attempt = 0; ; attempt++) {
      try {
        const probe = await this.probe(
          webContents,
          selector,
          alignments[attempt % alignments.length],
        );
        last = probe;
        everFound = everFound || probe.found;
        const reason = actionabilityReason(
          probe,
          requirements,
          options.force === true,
        );
        if (!reason) return probe;
        lastReason = reason;
      } catch (error) {
        lastError = error;
      }

      if (Date.now() >= deadline) break;
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
    }

    if (!everFound) {
      throw new BrowserBridgeError(
        "NOT_FOUND",
        `Element not found for "${selector}"${
          lastError instanceof Error ? `: ${lastError.message}` : ""
        }`,
        { selector, timeout },
      );
    }

    throw new BrowserBridgeError(
      "NOT_ACTIONABLE",
      `Element "${selector}" is not ${lastReason || "actionable"} after ${timeout}ms.`,
      {
        selector,
        reason: lastReason || "not-actionable",
        timeout,
        probe: last,
        ...(lastError instanceof Error ? { error: lastError.message } : {}),
      },
    );
  }

  // ── 输入派发 ──

  private async dispatchClick(
    webContents: Electron.WebContents,
    windowId: string,
    selector: string,
    probe: ActionProbe,
    options: ActionOptions,
  ): Promise<void> {
    const point = centerPoint(probe);
    const button = normalizeButton(options.button);
    const clickCount = normalizeClickCount(options.clickCount);

    if (options.trusted === false) {
      await this.clickScript(webContents, selector, point, button, clickCount, options.modifiers || []);
      return;
    }

    try {
      await this.dispatchClickElectron(webContents, point, button, clickCount, options.modifiers || []);
    } catch (error: any) {
      log.warn(`sendInputEvent click failed, falling back to CDP: ${error?.message || error}`);
      await this.dispatchClickCdp(
        webContents,
        windowId,
        point,
        button,
        clickCount,
        options.modifiers || [],
      );
    }
  }

  private async dispatchClickElectron(
    webContents: Electron.WebContents,
    point: { x: number; y: number },
    button: MouseButton,
    clickCount: number,
    modifiers: string[],
  ): Promise<void> {
    const electronModifiers = toElectronModifiers(modifiers);
    webContents.focus();
    webContents.sendInputEvent({
      type: "mouseMove",
      x: point.x,
      y: point.y,
      modifiers: electronModifiers,
    } as any);
    // 给 hover 菜单/浮层一帧时间，避免 mouseMove 后立即点击落到刚展开的层上
    await sleep(20);
    for (let i = 0; i < clickCount; i++) {
      const count = i + 1;
      webContents.sendInputEvent({
        type: "mouseDown",
        x: point.x,
        y: point.y,
        button,
        clickCount: count,
        modifiers: electronModifiers,
      } as any);
      webContents.sendInputEvent({
        type: "mouseUp",
        x: point.x,
        y: point.y,
        button,
        clickCount: count,
        modifiers: electronModifiers,
      } as any);
      if (i < clickCount - 1) {
        // 双击/三击需要落在系统双击间隔内，同时给页面一次事件循环
        await sleep(60);
      }
    }
  }

  private async dispatchClickCdp(
    webContents: Electron.WebContents,
    windowId: string,
    point: { x: number; y: number },
    button: MouseButton,
    clickCount: number,
    modifiers: string[],
  ): Promise<void> {
    await this.withCdp(webContents, windowId, async (send) => {
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: point.x,
        y: point.y,
        modifiers: cdpModifierMask(modifiers),
      });
      for (let i = 0; i < clickCount; i++) {
        const count = i + 1;
        await send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: point.x,
          y: point.y,
          button,
          clickCount: count,
          modifiers: cdpModifierMask(modifiers),
        });
        await send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: point.x,
          y: point.y,
          button,
          clickCount: count,
          modifiers: cdpModifierMask(modifiers),
        });
        if (i < clickCount - 1) {
          await sleep(60);
        }
      }
    });
  }

  private async dispatchMouseMove(
    webContents: Electron.WebContents,
    windowId: string,
    x: number,
    y: number,
    trusted: boolean,
  ): Promise<void> {
    if (!trusted) {
      await webContents.executeJavaScript(
        `(() => {
          const el = document.elementFromPoint(${x}, ${y});
          if (!el) return;
          el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: ${x}, clientY: ${y} }));
          el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: ${x}, clientY: ${y} }));
        })()`,
        false,
      );
      return;
    }

    // sendInputEvent 的单个 mouseMove 在隐藏窗口/未聚焦页面上不一定产生
    // mouseover；CDP 的 mouseMoved 更稳定，因此 hover 以 CDP 为主。
    try {
      await this.withCdp(webContents, windowId, async (send) => {
        await send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: 1,
          y: 1,
        });
        await send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y,
        });
      });
    } catch (error: any) {
      log.warn(`CDP mousemove failed, falling back to sendInputEvent: ${error?.message || error}`);
      webContents.focus();
      webContents.sendInputEvent({ type: "mouseMove", x, y } as any);
    }
  }

  private dispatchKeyElectron(
    webContents: Electron.WebContents,
    parsed: ParsedKey,
    modifiers: string[],
  ): void {
    const electronModifiers = toElectronModifiers(modifiers);
    const hasCommandModifier = modifiers.some((m) =>
      ["control", "ctrl", "meta", "cmd", "command", "alt"].includes(m.toLowerCase()),
    );
    const base = {
      keyCode: parsed.electronKeyCode,
      modifiers: electronModifiers,
    };
    webContents.focus();
    webContents.sendInputEvent({ type: "keyDown", ...base } as any);
    if (parsed.printable && !hasCommandModifier) {
      webContents.sendInputEvent({
        type: "char",
        keyCode: parsed.printable,
        modifiers: electronModifiers,
      } as any);
    }
    webContents.sendInputEvent({ type: "keyUp", ...base } as any);
  }

  private async dispatchKeyCdp(
    webContents: Electron.WebContents,
    windowId: string,
    parsed: ParsedKey,
    modifiers: string[],
  ): Promise<void> {
    const hasCommandModifier = modifiers.some((m) =>
      ["control", "ctrl", "meta", "cmd", "command", "alt"].includes(m.toLowerCase()),
    );
    const mask = cdpModifierMask(modifiers);
    const text = parsed.printable && !hasCommandModifier ? parsed.printable : undefined;

    await this.withCdp(webContents, windowId, async (send) => {
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: parsed.key,
        code: parsed.code,
        windowsVirtualKeyCode: parsed.vk,
        nativeVirtualKeyCode: parsed.vk,
        modifiers: mask,
        ...(text ? { text } : {}),
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: parsed.key,
        code: parsed.code,
        windowsVirtualKeyCode: parsed.vk,
        nativeVirtualKeyCode: parsed.vk,
        modifiers: mask,
      });
    });
  }

  private async dispatchKeyScript(
    webContents: Electron.WebContents,
    parsed: ParsedKey,
    modifiers: string[],
  ): Promise<void> {
    const hasCommandModifier = modifiers.some((m) =>
      ["control", "ctrl", "meta", "cmd", "command", "alt"].includes(m.toLowerCase()),
    );
    await webContents.executeJavaScript(
      `(() => {
        const el = document.activeElement || document.body;
        if (!el) return;
        const init = { key: ${JSON.stringify(parsed.key)}, code: ${JSON.stringify(parsed.code)}, bubbles: true, cancelable: true, ctrlKey: ${modifiers.some((m) => ["control", "ctrl"].includes(m.toLowerCase()))}, shiftKey: ${modifiers.some((m) => m.toLowerCase() === "shift")}, altKey: ${modifiers.some((m) => m.toLowerCase() === "alt")}, metaKey: ${modifiers.some((m) => ["meta", "cmd", "command"].includes(m.toLowerCase()))} };
        el.dispatchEvent(new KeyboardEvent('keydown', init));
        if (${JSON.stringify(!hasCommandModifier)} && el instanceof HTMLElement) {
          el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ${JSON.stringify(parsed.printable || "")}, bubbles: true, cancelable: true }));
        }
        el.dispatchEvent(new KeyboardEvent('keyup', init));
      })()`,
      true,
    );
  }

  private async dispatchWheelCdp(
    webContents: Electron.WebContents,
    windowId: string,
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    await this.withCdp(webContents, windowId, async (send) => {
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x,
        y,
        deltaX,
        deltaY,
      });
    });
  }

  private async clickScript(
    webContents: Electron.WebContents,
    selector: string,
    point: { x: number; y: number },
    button: MouseButton,
    clickCount: number,
    modifiers: string[],
  ): Promise<void> {
    const result = await webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const init = { bubbles: true, cancelable: true, view: window, clientX: ${point.x}, clientY: ${point.y}, button: ${button === "right" ? 2 : button === "middle" ? 1 : 0}, ctrlKey: ${modifiers.some((m) => ["control", "ctrl"].includes(m.toLowerCase()))}, shiftKey: ${modifiers.some((m) => m.toLowerCase() === "shift")}, altKey: ${modifiers.some((m) => m.toLowerCase() === "alt")}, metaKey: ${modifiers.some((m) => ["meta", "cmd", "command"].includes(m.toLowerCase()))} };
        if (${JSON.stringify(button)} === 'right') {
          el.dispatchEvent(new MouseEvent('contextmenu', init));
          return true;
        }
        for (let i = 0; i < ${clickCount}; i++) {
          el.dispatchEvent(new MouseEvent('mousedown', Object.assign({}, init, { detail: i + 1 })));
          el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, init, { detail: i + 1 })));
          el.dispatchEvent(new MouseEvent('click', Object.assign({}, init, { detail: i + 1 })));
        }
        if (${clickCount} > 1) {
          el.dispatchEvent(new MouseEvent('dblclick', Object.assign({}, init, { detail: 2 })));
        }
        return true;
      })()`,
      true,
    );
    if (!result) {
      throw new BrowserBridgeError(
        "ACTION_FAILED",
        `Element "${selector}" disappeared before the click could be dispatched.`,
        { selector },
      );
    }
  }

  // ── 页面辅助 ──

  private async focusElement(
    webContents: Electron.WebContents,
    selector: string,
  ): Promise<void> {
    await webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el && typeof el.focus === 'function') el.focus();
      })()`,
      false,
    );
  }

  private async selectAll(
    webContents: Electron.WebContents,
    selector: string,
  ): Promise<void> {
    await webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return;
        if (el.isContentEditable) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = window.getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        } else if (typeof el.select === 'function') {
          try { el.select(); } catch (_) {}
        }
      })()`,
      false,
    );
  }

  private async setValueScript(
    webContents: Electron.WebContents,
    selector: string,
    value: string,
  ): Promise<boolean> {
    const result = await webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const value = ${JSON.stringify(value)};
        if (el.isContentEditable) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = window.getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
          if (value.length > 0) {
            document.execCommand('insertText', false, value);
          } else {
            document.execCommand('delete', false);
          }
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
          return true;
        }
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value');
        if (setter && setter.set) setter.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`,
      true,
    );
    return result === true;
  }

  private async readScrollState(
    webContents: Electron.WebContents,
    selector?: string,
  ): Promise<{ x: number; y: number; elementX: number; elementY: number }> {
    const value = await webContents.executeJavaScript(
      `(() => {
        const el = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : "null"};
        return {
          x: window.scrollX,
          y: window.scrollY,
          elementX: el ? el.scrollLeft : 0,
          elementY: el ? el.scrollTop : 0,
        };
      })()`,
      false,
    );
    return {
      x: Number(value?.x) || 0,
      y: Number(value?.y) || 0,
      elementX: Number(value?.elementX) || 0,
      elementY: Number(value?.elementY) || 0,
    };
  }

  private async viewportSize(
    webContents: Electron.WebContents,
  ): Promise<{ width: number; height: number }> {
    const value = await webContents.executeJavaScript(
      "({ width: window.innerWidth, height: window.innerHeight })",
      false,
    );
    return {
      width: Number(value?.width) || 800,
      height: Number(value?.height) || 600,
    };
  }

  private async withCdp<T>(
    webContents: Electron.WebContents,
    windowId: string,
    action: (send: (method: string, params?: any) => Promise<any>) => Promise<T>,
  ): Promise<T> {
    const debuggerApi = webContents.debugger;
    let attachedByUs = false;
    const wasVisible = this.host.isWindowVisible(windowId);
    if (!wasVisible) {
      this.host.setWebviewRenderable(windowId, true);
      await sleep(100);
    }

    try {
      if (!debuggerApi.isAttached()) {
        debuggerApi.attach("1.3");
        attachedByUs = true;
      }
      return await action((method, params) => debuggerApi.sendCommand(method, params));
    } finally {
      if (attachedByUs && debuggerApi.isAttached()) {
        try {
          debuggerApi.detach();
        } catch {
          /* ignore */
        }
      }
      if (!wasVisible) {
        this.host.setWebviewRenderable(windowId, false);
      }
    }
  }

  private result(
    webContents: Electron.WebContents,
    action: string,
    target?: string,
    extra?: Record<string, unknown>,
  ): any {
    return {
      ok: true,
      action,
      ...(target ? { target } : {}),
      url: webContents.getURL(),
      title: webContents.getTitle(),
      ...(extra || {}),
    };
  }
}

// ── 页面探测脚本 ──

function buildProbeScript(selector: string, alignment: ScrollAlignment): string {
  return `(async () => {
    const selector = ${JSON.stringify(selector)};
    const alignment = ${JSON.stringify(alignment)};
    const sample = ${STABILITY_SAMPLE_MS};
    const el = document.querySelector(selector);
    if (!el) {
      return {
        found: false,
        visible: false,
        enabled: false,
        editable: false,
        stable: false,
        inViewport: false,
        covered: true,
        tagName: '',
        rect: { x: 0, y: 0, width: 0, height: 0 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    }

    try {
      el.scrollIntoView({ behavior: 'instant', block: alignment, inline: 'center' });
    } catch (_) {
      el.scrollIntoView();
    }
    await new Promise((r) => setTimeout(r, 0));

    const read = () => {
      const rect = el.getBoundingClientRect();
      return {
        x: Number(rect.x) || 0,
        y: Number(rect.y) || 0,
        width: Number(rect.width) || 0,
        height: Number(rect.height) || 0,
      };
    };
    const same = (a, b) =>
      Math.abs(a.x - b.x) < 0.5 &&
      Math.abs(a.y - b.y) < 0.5 &&
      Math.abs(a.width - b.width) < 0.5 &&
      Math.abs(a.height - b.height) < 0.5;

    const first = read();
    await new Promise((r) => setTimeout(r, sample));
    const second = read();

    const style = getComputedStyle(el);
    const visible = second.width > 0 && second.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    const tagName = el.tagName ? el.tagName.toLowerCase() : '';
    const type = (el.getAttribute && el.getAttribute('type')) || '';
    const disabled = !!el.disabled || (el.getAttribute && el.getAttribute('aria-disabled') === 'true') || !!(el.closest && el.closest('[inert]'));
    const isFormField = (tagName === 'input' && !['file', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image'].includes(type.toLowerCase())) || tagName === 'textarea';
    const editable = !!el.isContentEditable || (isFormField && !el.disabled && !el.readOnly);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = Math.max(0, Math.min(vw - 1, second.x + second.width / 2));
    const cy = Math.max(0, Math.min(vh - 1, second.y + second.height / 2));
    const hit = visible ? document.elementFromPoint(cx, cy) : null;
    const covered = !hit || !(hit === el || (el.contains && el.contains(hit)));

    const result = {
      found: true,
      visible,
      enabled: !disabled,
      editable,
      stable: same(first, second),
      inViewport:
        second.y + second.height > 0 &&
        second.x + second.width > 0 &&
        second.y < vh &&
        second.x < vw,
      covered,
      tagName,
      type,
      rect: second,
      viewport: { width: vw, height: vh },
    };

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      result.valueLength = typeof el.value === 'string' ? el.value.length : 0;
      if (el.type !== 'password') result.value = el.value;
      if (el.type === 'checkbox' || el.type === 'radio') result.checked = !!el.checked;
    } else if (el instanceof HTMLSelectElement) {
      result.selectedValues = Array.from(el.selectedOptions).map((o) => o.value);
      result.valueLength = Array.from(el.selectedOptions).length;
      result.value = Array.from(el.selectedOptions).map((o) => o.value).join(',');
    } else if (el.isContentEditable) {
      result.valueLength = (el.innerText || '').length;
      result.value = el.innerText || '';
    }

    return result;
  })()`;
}

function normalizeProbe(raw: any): ActionProbe {
  const rect = raw?.rect || {};
  const viewport = raw?.viewport || {};
  return {
    found: raw?.found === true,
    visible: raw?.visible === true,
    enabled: raw?.enabled === true,
    editable: raw?.editable === true,
    stable: raw?.stable === true,
    inViewport: raw?.inViewport === true,
    covered: raw?.covered === true,
    tagName: String(raw?.tagName || ""),
    ...(raw?.type ? { type: String(raw.type) } : {}),
    ...(typeof raw?.checked === "boolean" ? { checked: raw.checked } : {}),
    ...(typeof raw?.value === "string" ? { value: raw.value } : {}),
    ...(typeof raw?.valueLength === "number" ? { valueLength: raw.valueLength } : {}),
    ...(Array.isArray(raw?.selectedValues)
      ? { selectedValues: raw.selectedValues.map(String) }
      : {}),
    rect: {
      x: Number(rect.x) || 0,
      y: Number(rect.y) || 0,
      width: Number(rect.width) || 0,
      height: Number(rect.height) || 0,
    },
    viewport: {
      width: Number(viewport.width) || 0,
      height: Number(viewport.height) || 0,
    },
  };
}

function actionabilityReason(
  probe: ActionProbe,
  requirements: ActionRequirements,
  force: boolean,
): string | null {
  if (!probe.found) return "not-found";
  if (force) return null;
  if (probe.rect.width <= 0 || probe.rect.height <= 0) return "hidden";
  if (!probe.visible) return "hidden";
  if (requirements.enabled && !probe.enabled) return "disabled";
  if (requirements.editable && !probe.editable) return "not-editable";
  if (requirements.stable !== false && !probe.stable) return "not-stable";
  if (!probe.inViewport) return "outside-viewport";
  if (requirements.covered !== false && probe.covered) return "covered";
  return null;
}

function centerPoint(probe: ActionProbe): { x: number; y: number } {
  const rawX = probe.rect.x + probe.rect.width / 2;
  const rawY = probe.rect.y + probe.rect.height / 2;
  const maxX = probe.viewport.width > 0 ? probe.viewport.width - 1 : rawX;
  const maxY = probe.viewport.height > 0 ? probe.viewport.height - 1 : rawY;
  return {
    x: Math.round(Math.max(0, Math.min(maxX, rawX))),
    y: Math.round(Math.max(0, Math.min(maxY, rawY))),
  };
}

function normalizeTimeout(value: unknown, fallback = DEFAULT_ACTION_TIMEOUT_MS): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_ACTION_TIMEOUT_MS, Math.max(100, Math.round(n)));
}

function normalizeButton(value: unknown): MouseButton {
  return value === "right" || value === "middle" ? value : "left";
}

function normalizeClickCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(3, Math.max(1, Math.round(n)));
}

function normalizeModifier(value: string): string {
  const lower = value.toLowerCase();
  if (lower === "ctrl") return "control";
  if (lower === "cmd" || lower === "command") return "meta";
  if (lower === "controlormeta") {
    return process.platform === "darwin" ? "meta" : "control";
  }
  return lower;
}

function toElectronModifiers(
  modifiers: string[],
): Array<"shift" | "control" | "alt" | "meta"> {
  const out: Array<"shift" | "control" | "alt" | "meta"> = [];
  for (const raw of modifiers || []) {
    const value = normalizeModifier(String(raw));
    if (
      (value === "shift" || value === "control" || value === "alt" || value === "meta") &&
      !out.includes(value)
    ) {
      out.push(value);
    }
  }
  return out;
}

function cdpModifierMask(modifiers: string[]): number {
  let mask = 0;
  for (const raw of modifiers || []) {
    const value = normalizeModifier(String(raw));
    if (value === "alt") mask |= 1;
    else if (value === "control") mask |= 2;
    else if (value === "meta") mask |= 4;
    else if (value === "shift") mask |= 8;
  }
  return mask;
}

interface ParsedKey {
  key: string;
  code: string;
  vk: number;
  electronKeyCode: string;
  printable?: string;
  modifiers: string[];
}

const SPECIAL_KEYS: Record<
  string,
  { key: string; code: string; vk: number; electronKeyCode: string }
> = {
  enter: { key: "Enter", code: "Enter", vk: 13, electronKeyCode: "Enter" },
  tab: { key: "Tab", code: "Tab", vk: 9, electronKeyCode: "Tab" },
  escape: { key: "Escape", code: "Escape", vk: 27, electronKeyCode: "Escape" },
  esc: { key: "Escape", code: "Escape", vk: 27, electronKeyCode: "Escape" },
  backspace: { key: "Backspace", code: "Backspace", vk: 8, electronKeyCode: "Backspace" },
  delete: { key: "Delete", code: "Delete", vk: 46, electronKeyCode: "Delete" },
  del: { key: "Delete", code: "Delete", vk: 46, electronKeyCode: "Delete" },
  arrowup: { key: "ArrowUp", code: "ArrowUp", vk: 38, electronKeyCode: "Up" },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", vk: 40, electronKeyCode: "Down" },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37, electronKeyCode: "Left" },
  arrowright: { key: "ArrowRight", code: "ArrowRight", vk: 39, electronKeyCode: "Right" },
  up: { key: "ArrowUp", code: "ArrowUp", vk: 38, electronKeyCode: "Up" },
  down: { key: "ArrowDown", code: "ArrowDown", vk: 40, electronKeyCode: "Down" },
  left: { key: "ArrowLeft", code: "ArrowLeft", vk: 37, electronKeyCode: "Left" },
  right: { key: "ArrowRight", code: "ArrowRight", vk: 39, electronKeyCode: "Right" },
  home: { key: "Home", code: "Home", vk: 36, electronKeyCode: "Home" },
  end: { key: "End", code: "End", vk: 35, electronKeyCode: "End" },
  pageup: { key: "PageUp", code: "PageUp", vk: 33, electronKeyCode: "PageUp" },
  pagedown: { key: "PageDown", code: "PageDown", vk: 34, electronKeyCode: "PageDown" },
  space: { key: " ", code: "Space", vk: 32, electronKeyCode: "Space" },
  " ": { key: " ", code: "Space", vk: 32, electronKeyCode: "Space" },
};

function parseKeyCombo(input: string): ParsedKey {
  const raw = String(input || "");
  if (!raw) {
    throw new BrowserBridgeError("INVALID_ARGUMENT", "press(key) requires a key name");
  }
  if (raw === "+") {
    return {
      key: "+",
      code: "Unidentified",
      vk: 187,
      electronKeyCode: "+",
      printable: "+",
      modifiers: [],
    };
  }

  const parts = raw.split("+");
  const keyPart = parts.pop() || "";
  const normalizedKey = keyPart.toLowerCase();
  const modifiers = parts.map((part) => normalizeModifier(part));

  if (SPECIAL_KEYS[normalizedKey]) {
    return { ...SPECIAL_KEYS[normalizedKey], modifiers };
  }

  if (normalizedKey.startsWith("f") && /^f([1-9]|1[0-2])$/.test(normalizedKey)) {
    const n = Number(normalizedKey.slice(1));
    return {
      key: `F${n}`,
      code: `F${n}`,
      vk: 111 + n,
      electronKeyCode: `F${n}`,
      modifiers,
    };
  }

  if (keyPart.length === 1) {
    const upper = keyPart.toUpperCase();
    if (upper >= "A" && upper <= "Z") {
      return {
        key: keyPart,
        code: `Key${upper}`,
        vk: upper.charCodeAt(0),
        electronKeyCode: upper,
        printable: keyPart,
        modifiers,
      };
    }
    if (keyPart >= "0" && keyPart <= "9") {
      return {
        key: keyPart,
        code: `Digit${keyPart}`,
        vk: keyPart.charCodeAt(0),
        electronKeyCode: keyPart,
        printable: keyPart,
        modifiers,
      };
    }
    return {
      key: keyPart,
      code: "Unidentified",
      vk: upper.charCodeAt(0),
      electronKeyCode: keyPart,
      printable: keyPart,
      modifiers,
    };
  }

  throw new BrowserBridgeError(
    "INVALID_ARGUMENT",
    `Unsupported key: "${input}". Use a single character or a name like Enter, Tab, Escape, ArrowDown, Control+A.`,
    { key: input },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scrollChanged(
  before: { x: number; y: number; elementX: number; elementY: number },
  after: { x: number; y: number; elementX: number; elementY: number },
): boolean {
  return (
    before.x !== after.x ||
    before.y !== after.y ||
    before.elementX !== after.elementX ||
    before.elementY !== after.elementY
  );
}
