import {
  BrowserScriptRuntime,
} from "../../src/modules/plugins/builtins/browser-script/browser-script-runtime";
import { BridgeRequestError } from "../../src/modules/bridge/bridge-client";

function createBridge() {
  let snapshotGeneration = 0;
  const calls: Array<{ method: string; params: any }> = [];
  const bridge: any = {
    async request(method: string, params: any) {
      calls.push({ method, params });
      switch (method) {
        case "browser_navigate":
          return {
            ok: true,
            tabId: "t1",
            url: params.url,
            title: "Example",
            readyState: "interactive",
          };
        case "browser_snapshot":
          snapshotGeneration += 1;
          return {
            generation: snapshotGeneration,
            type: params.type || "simple",
            url: "https://example.com",
            title: "Example",
            source: "ax",
            stats: { nodes: 2 },
            tree: {
              role: "document",
              ref: "root",
              children: [{ role: "button", name: "Submit", ref: "e0" }],
            },
          };
        case "browser_click":
          return {
            ok: true,
            action: "click",
            target: params.selector,
            url: "https://example.com",
            title: "Example",
            button: params.button || "left",
            clickCount: params.click_count || 1,
          };
        case "browser_input":
          return {
            ok: true,
            action: "fill",
            target: params.selector,
            value: params.value,
            url: "https://example.com",
            title: "Example",
          };
        case "browser_hover":
          return {
            ok: true,
            action: "hover",
            target: params.selector,
            url: "https://example.com",
            title: "Example",
          };
        case "browser_press":
          return {
            ok: true,
            action: "press",
            target: params.selector,
            key: params.key,
            url: "https://example.com",
            title: "Example",
          };
        case "browser_scroll":
          return {
            ok: true,
            action: "scroll",
            deltaX: params.delta_x || 0,
            deltaY: params.delta_y || 0,
            scrollX: 0,
            scrollY: 500,
            url: "https://example.com",
            title: "Example",
          };
        case "browser_select":
          return {
            ok: true,
            action: "select",
            target: params.selector,
            selected: ["cn"],
            url: "https://example.com",
            title: "Example",
          };
        case "browser_check":
          return {
            ok: true,
            action: "check",
            target: params.selector,
            checked: params.checked !== false,
            url: "https://example.com",
            title: "Example",
          };
        case "browser_element_state":
          return {
            ok: true,
            found: true,
            visible: true,
            enabled: true,
            editable: true,
            stable: true,
            inViewport: true,
            covered: false,
            tagName: "button",
            rect: { x: 0, y: 0, width: 100, height: 30 },
            viewport: { width: 800, height: 600 },
          };
        case "browser_wait":
          return {
            ok: true,
            found: true,
            selector: params.selector,
            state: params.state,
          };
        case "browser_evaluate":
          return 1;
        case "browser_screenshot":
          return { ok: true, path: "C:/tmp/shot.png", width: 800, height: 600 };
        case "browser_console":
          return ["log one", "log two"];
        case "browser_history":
          return { ok: true, url: "https://example.com" };
        case "browser_tabs":
          if (params.action === "list") {
            return [
              {
                index: 0,
                tabId: "t1",
                url: "https://a.example",
                title: "A",
                isCurrent: true,
              },
              {
                index: 1,
                tabId: "t2",
                url: "https://b.example",
                title: "B",
                isCurrent: false,
              },
            ];
          }
          if (params.action === "current") {
            return {
              index: 0,
              tabId: "t1",
              url: "https://a.example",
              title: "A",
              isCurrent: true,
            };
          }
          if (params.action === "select") {
            return {
              index: params.index,
              tabId: "t2",
              url: "https://b.example",
              title: "B",
              isCurrent: true,
            };
          }
          if (params.action === "close") {
            return { ok: true, closedTabId: "t1", currentTabId: "t2" };
          }
          if (params.action === "close_all") {
            return { ok: true, closedCount: 2 };
          }
          throw new Error("unexpected tabs action");
        default:
          throw new Error("unexpected method " + method);
      }
    },
  };
  return { bridge, calls };
}

async function runScript(bridge: any, script: string) {
  const runtime = new BrowserScriptRuntime(bridge);
  return runtime.run({
    script,
    createdBy: "s1",
    ownerSessionId: "s1",
    sessionPath: "C:/tmp",
  });
}

describe("BrowserScriptRuntime Bridge contract", () => {
  jest.setTimeout(15000);

  it("透传新的脚本友好返回结构", async () => {
    const { bridge } = createBridge();
    const result = await runScript(
      bridge,
      `
const nav = await tab.goto("https://example.com");
const page = await tab.snapshot();
const clicked = await tab.click("e0");
const filled = await tab.fill("e0", "x");
const waited = await tab.waitFor("#x");
const value = await tab.evaluate(() => 1 + 1);
const shot = await tab.screenshot();
const logs = await tab.console();
const hist = await tab.reload();
const tabs = await browser.tabs.list();
const current = await browser.current();
const selected = await browser.tabs.select(1);
const closed = await browser.tabs.close(0);
const closedAll = await browser.tabs.closeAll();
return {
  nav,
  pageGeneration: page.generation,
  clicked,
  filled,
  waited,
  value,
  shot,
  logs,
  hist,
  tabCount: tabs.length,
  tabIds: tabs.map(t => t.tabId),
  current,
  selected,
  closed,
  closedAll,
};
`,
    );

    expect(result.status).toBe("completed");
    const value: any = result.value;
    expect(value.nav).toMatchObject({ ok: true, tabId: "t1" });
    expect(value.pageGeneration).toBe(1);
    expect(value.clicked).toMatchObject({
      ok: true,
      action: "click",
      target: "e0",
    });
    expect(value.filled).toMatchObject({
      ok: true,
      action: "fill",
      target: "e0",
      value: "x",
    });
    expect(value.waited).toMatchObject({
      ok: true,
      found: true,
      state: "visible",
    });
    expect(value.value).toBe(1);
    expect(value.shot.path).toBe("C:/tmp/shot.png");
    expect(value.logs).toEqual(["log one", "log two"]);
    expect(value.hist).toMatchObject({ ok: true });
    expect(value.tabCount).toBe(2);
    expect(value.tabIds).toEqual(["t1", "t2"]);
    expect(value.current.tabId).toBe("t1");
    expect(value.selected.tabId).toBe("t2");
    expect(value.closed).toMatchObject({
      ok: true,
      closedTabId: "t1",
      currentTabId: "t2",
    });
    expect(value.closedAll.closedCount).toBe(2);
  });

  it("保留 Bridge 结构化错误码与 details", async () => {
    const { bridge } = createBridge();
    bridge.request = async (method: string) => {
      if (method === "browser_snapshot") {
        return {
          generation: 1,
          type: "simple",
          url: "https://example.com",
          title: "Example",
          source: "ax",
          stats: {},
          tree: {
            role: "document",
            ref: "root",
            children: [{ role: "button", name: "Submit", ref: "e0" }],
          },
        };
      }
      if (method === "browser_click") {
        throw new BridgeRequestError(
          "STALE_REF",
          "Snapshot generation 1 is stale",
          { expected: 2, received: 1 },
          "browser_click",
        );
      }
      throw new Error("unexpected method " + method);
    };

    const result = await runScript(
      bridge,
      `
await tab.snapshot();
await tab.click("e0");
return 1;
`,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({
      code: "STALE_REF",
      details: { expected: 2, received: 1 },
    });
  });

  it("把后端 ELEMENT_NOT_FOUND 映射为 NOT_FOUND", async () => {
    const { bridge } = createBridge();
    bridge.request = async (method: string) => {
      if (method === "browser_wait") {
        throw new BridgeRequestError(
          "ELEMENT_NOT_FOUND",
          "missing",
          { selector: "#x" },
          "browser_wait",
        );
      }
      throw new Error("unexpected method " + method);
    };

    const result = await runScript(bridge, `await tab.waitFor("#x"); return 1;`);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("NOT_FOUND");
    expect(result.error?.details).toEqual({ selector: "#x" });
  });

  it("透传动作选项并支持新原语", async () => {
    const { bridge, calls } = createBridge();
    const result = await runScript(
      bridge,
      `
await tab.snapshot();
await tab.click("e0", { button: "right", clickCount: 2, modifiers: ["Control"], force: true, timeout: 1500, trusted: false });
await tab.hover("e0", { force: true });
await tab.press("Control+A", { target: "#q", modifiers: ["Shift"], timeout: 1200 });
await tab.scroll({ deltaY: 500 });
await tab.selectOption("e0", "cn");
await tab.check("e0", false);
return 1;
`,
    );

    expect(result.status).toBe("completed");
    const click = calls.find((c) => c.method === "browser_click");
    expect(click?.params).toMatchObject({
      selector: "e0",
      button: "right",
      click_count: 2,
      modifiers: ["Control"],
      force: true,
      timeout: 1500,
      trusted: false,
    });

    const hover = calls.find((c) => c.method === "browser_hover");
    expect(hover?.params).toMatchObject({
      selector: "e0",
      force: true,
    });

    const press = calls.find((c) => c.method === "browser_press");
    expect(press?.params).toMatchObject({
      selector: "#q",
      key: "Control+A",
      modifiers: ["Shift"],
      timeout: 1200,
    });

    const scroll = calls.find((c) => c.method === "browser_scroll");
    expect(scroll?.params).toMatchObject({ delta_y: 500 });

    const select = calls.find((c) => c.method === "browser_select");
    expect(select?.params).toMatchObject({ selector: "e0", values: "cn" });

    const check = calls.find((c) => c.method === "browser_check");
    expect(check?.params).toMatchObject({ selector: "e0", checked: false });
  });

  it("elementState 与 locator.isVisible 使用真实 DOM 状态", async () => {
    const { bridge, calls } = createBridge();
    const result = await runScript(
      bridge,
      `
await tab.snapshot();
const state = await tab.elementState("e0");
const visible = await tab.getByRole("button", { name: "Submit" }).isVisible();
return { state, visible };
`,
    );

    expect(result.status).toBe("completed");
    const value: any = result.value;
    expect(value.state.visible).toBe(true);
    expect(value.state.found).toBe(true);
    expect(value.visible).toBe(true);
    const stateCalls = calls.filter((c) => c.method === "browser_element_state");
    expect(stateCalls.length).toBe(2);
    expect(stateCalls.every((c) => c.params.selector === "e0")).toBe(true);
  });

  it("waitForLocator 在匹配到但不可操作时继续轮询", async () => {
    const { bridge } = createBridge();
    let snapshotCount = 0;
    bridge.request = async (method: string, params: any) => {
      if (method === "browser_snapshot") {
        snapshotCount += 1;
        const tree =
          snapshotCount === 1
            ? {
                role: "document",
                ref: "root",
                children: [{ role: "heading", name: "Submit" }],
              }
            : {
                role: "document",
                ref: "root",
                children: [{ role: "button", name: "Submit", ref: "e0" }],
              };
        return {
          generation: snapshotCount,
          type: "simple",
          url: "https://example.com",
          title: "Example",
          source: "ax",
          stats: {},
          tree,
        };
      }
      if (method === "browser_wait") {
        return {
          ok: true,
          found: true,
          selector: params.selector,
          state: params.state,
        };
      }
      throw new Error("unexpected method " + method);
    };

    const result = await runScript(
      bridge,
      `await tab.waitFor(tab.getByText("Submit")); return 1;`,
    );

    expect(result.status).toBe("completed");
    expect(snapshotCount).toBeGreaterThanOrEqual(2);
  });
});
