import {
  BrowserScriptRuntime,
} from "../../src/modules/plugins/builtins/browser-script/browser-script-runtime";
import { BridgeRequestError } from "../../src/modules/bridge/bridge-client";

function createBridge() {
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
          return {
            type: params.type || "simple",
            url: "https://example.com",
            title: "Example",
            source: "ax",
            stats: { nodes: 2 },
            tree: {
              role: "document",
              children: [{ role: "button", name: "Submit" }],
            },
          };
        case "browser_locator": {
          if (params.action === "count") return 2;
          if (params.action === "text") return "More info";
          if (params.action === "isVisible") return true;
          if (params.action === "wait") {
            return {
              ok: true,
              found: true,
              state: params.state,
              descriptor: params.descriptor,
            };
          }
          if (params.action === "state") {
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
          }
          return {
            ok: true,
            action: params.action,
            target: '[data-guada-loc="t"]',
            url: "https://example.com",
            title: "Example",
            ...(params.value !== undefined ? { value: params.value } : {}),
            ...(params.values !== undefined ? { selected: [String(params.values)] } : {}),
            ...(params.checked !== undefined ? { checked: params.checked } : {}),
          };
        }
        case "browser_press":
          return { ok: true, action: "press", key: params.key };
        case "browser_scroll":
          return { ok: true, action: "scroll", deltaY: params.delta_y };
        case "browser_evaluate":
          return 1;
        case "browser_screenshot":
          // 后端只回字节 + 尺寸；截图落盘由 persistScreenshot 回调负责
          return {
            ok: true,
            data: Buffer.from("fake-png-bytes").toString("base64"),
            mime_type: "image/png",
            width: 800,
            height: 600,
          };
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

async function runScript(
  bridge: any,
  script: string,
  persistScreenshot?: (
    data: Buffer,
    meta: { width?: number; height?: number; saveTo?: string },
  ) => Promise<{ ref?: any; absolutePath?: string; exportedPath?: string }>,
) {
  const runtime = new BrowserScriptRuntime(bridge);
  return runtime.run({
    script,
    createdBy: "s1",
    ownerSessionId: "s1",
    sessionPath: "C:/tmp",
    ...(persistScreenshot ? { persistScreenshot } : {}),
  });
}

describe("BrowserScriptRuntime live locator contract", () => {
  jest.setTimeout(15000);

  it("使用 locator descriptor，不再依赖 snapshot/ref", async () => {
    const { bridge, calls } = createBridge();
    const result = await runScript(
      bridge,
      `
await tab.goto("https://example.com");
const clicked = await tab.getByRole("button", { name: "Submit" }).click();
const filled = await tab.getByLabel("Email").fill("user@example.com");
const count = await tab.getByPlaceholder("Search").count();
const text = await tab.getByText("More info").text();
const visible = await tab.getByTestId("submit").isVisible();
const state = await tab.getByRole("button", { name: "Submit" }).state();
const waited = await tab.waitFor(
  tab.getByRole("button", { name: "Next" }),
  { state: "hidden", timeout: 500 },
);
return { clicked, filled, count, text, visible, state, waited };
`,
    );

    expect(result.status).toBe("completed");
    const value: any = result.value;
    expect(value.clicked).toMatchObject({ ok: true, action: "click" });
    expect(value.filled).toMatchObject({
      ok: true,
      action: "fill",
      value: "user@example.com",
    });
    expect(value.count).toBe(2);
    expect(value.text).toBe("More info");
    expect(value.visible).toBe(true);
    expect(value.state).toMatchObject({ ok: true, visible: true, editable: true });
    expect(value.waited).toMatchObject({ ok: true, state: "hidden" });

    expect(calls.some((call) => call.method === "browser_snapshot")).toBe(false);

    const locatorCalls = calls.filter((call) => call.method === "browser_locator");
    expect(locatorCalls.map((call) => call.params.action)).toEqual([
      "click",
      "fill",
      "count",
      "text",
      "isVisible",
      "state",
      "wait",
    ]);
    expect(locatorCalls[0].params.descriptor).toMatchObject({
      kind: "role",
      role: "button",
      name: "Submit",
    });
    expect(locatorCalls[1].params.descriptor).toMatchObject({
      kind: "label",
      text: "Email",
    });
    expect(locatorCalls[6].params.state).toBe("hidden");
    expect(locatorCalls[6].params.timeout).toBe(500);
  });

  it("透传 getByRole 的全部 Playwright options 与动作 options", async () => {
    const { bridge, calls } = createBridge();
    const result = await runScript(
      bridge,
      `
await tab.getByRole("button", {
  name: "Submit",
  exact: true,
  checked: true,
  disabled: false,
  expanded: true,
  includeHidden: true,
  level: 2,
  pressed: false,
  selected: true,
}).click({
  button: "right",
  clickCount: 2,
  modifiers: ["Control"],
  force: true,
  timeout: 1500,
  trusted: false,
});
return 1;
`,
    );

    expect(result.status).toBe("completed");
    const call = calls.find((entry) => entry.method === "browser_locator");
    expect(call?.params.descriptor).toMatchObject({
      kind: "role",
      role: "button",
      name: "Submit",
      exact: true,
      checked: true,
      disabled: false,
      expanded: true,
      includeHidden: true,
      level: 2,
      pressed: false,
      selected: true,
    });
    expect(call?.params.options).toMatchObject({
      button: "right",
      clickCount: 2,
      modifiers: ["Control"],
      force: true,
      timeout: 1500,
      trusted: false,
    });
    expect(call?.params.timeout).toBe(1500);
  });

  it("把 RegExp locator 序列化为 Bridge 可传输的 wire format", async () => {
    const { bridge, calls } = createBridge();
    const result = await runScript(
      bridge,
      `await tab.getByRole("button", { name: /submit/i }).click(); return 1;`,
    );

    expect(result.status).toBe("completed");
    const call = calls.find((entry) => entry.method === "browser_locator");
    expect(call?.params.descriptor.name).toEqual({
      __regexp: "submit",
      flags: "i",
    });
  });

  it("tab 级便利方法同样透传顶层 options", async () => {
    const { bridge, calls } = createBridge();
    const result = await runScript(
      bridge,
      `
await tab.click(tab.getByRole("button", { name: "Submit" }), {
  button: "right",
  timeout: 1500,
});
await tab.fill(tab.getByLabel("Email"), "user@example.com");
return 1;
`,
    );

    expect(result.status).toBe("completed");
    const locatorCalls = calls.filter((call) => call.method === "browser_locator");
    expect(locatorCalls[0].params.options).toMatchObject({
      button: "right",
      timeout: 1500,
    });
    expect(locatorCalls[0].params.timeout).toBe(1500);
    expect(locatorCalls[1].params).toMatchObject({
      action: "fill",
      value: "user@example.com",
    });
  });

  it("保留 Bridge 结构化错误码与 details", async () => {
    const { bridge } = createBridge();
    bridge.request = async (method: string) => {
      if (method === "browser_locator") {
        throw new BridgeRequestError(
          "AMBIGUOUS",
          "Locator matched 2 elements",
          { candidates: [{ tag: "button", text: "Delete" }] },
          "browser_locator",
        );
      }
      throw new Error("unexpected method " + method);
    };

    const result = await runScript(
      bridge,
      `await tab.getByRole("button", { name: "Delete" }).click(); return 1;`,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({
      code: "AMBIGUOUS",
      details: { candidates: [{ tag: "button", text: "Delete" }] },
    });
  });

  it("拒绝已移除的 ref target", async () => {
    const { bridge, calls } = createBridge();
    const result = await runScript(bridge, `await tab.click("e3"); return 1;`);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_ARGUMENT");
    expect(result.error?.message).toContain("Ref targets were removed");
    expect(calls.length).toBe(0);
  });

  it("waitFor 默认 visible，并支持 attached/detached", async () => {
    const { bridge, calls } = createBridge();
    const result = await runScript(
      bridge,
      `
await tab.waitFor(tab.getByText("Next"));
await tab.waitFor(tab.getByText("Next"), { state: "attached" });
await tab.waitFor(tab.getByText("Next"), { state: "detached" });
return 1;
`,
    );

    expect(result.status).toBe("completed");
    const waits = calls.filter(
      (call) => call.method === "browser_locator" && call.params.action === "wait",
    );
    expect(waits.map((call) => call.params.state)).toEqual([
      "visible",
      "attached",
      "detached",
    ]);
  });

  it("snapshot 不再返回 generation/ref", async () => {
    const { bridge } = createBridge();
    const result = await runScript(
      bridge,
      `const snap = await tab.snapshot(); return snap;`,
    );

    expect(result.status).toBe("completed");
    const snapshot: any = result.value;
    expect(snapshot.generation).toBeUndefined();
    expect(snapshot.tree.children[0].ref).toBeUndefined();
  });

  it("截图：字节交给 persistScreenshot，不回传 worker，state 不存 base64", async () => {
    const { bridge, calls } = createBridge();
    const seen: Array<{ bytes: Buffer; meta: any }> = [];
    const ref = {
      mediaType: "image/jpeg",
      bytes: 14,
      name: "shot.jpg",
      url: "sessions/s1/images/20261022/shot_1200_abc123.jpg",
      previewUrl: "sessions/s1/previews/20261022/shot_1200_abc123.jpg",
      fileExtension: "jpg",
      refType: "session" as const,
    };

    const result = await runScript(
      bridge,
      `const shot = await tab.screenshot({ fullPage: true }); return shot;`,
      async (data, meta) => {
        seen.push({ bytes: data, meta });
        return {
          ref,
          absolutePath: "C:/sessions/s1/images/20261022/shot_1200_abc123.jpg",
        };
      },
    );

    expect(result.status).toBe("completed");

    // 1) 落盘回调拿到原始字节与尺寸
    expect(seen).toHaveLength(1);
    expect(Buffer.isBuffer(seen[0].bytes)).toBe(true);
    expect(seen[0].bytes.toString()).toBe("fake-png-bytes");
    expect(seen[0].meta).toMatchObject({ width: 800, height: 600 });

    // 2) 返回给 worker 的值不含 base64
    const value: any = result.value;
    expect(value).toMatchObject({ ok: true, width: 800, height: 600 });
    expect(value.data).toBeUndefined();

    // 3) 结果里只留引用；meta/结果都不含 base64
    expect(result.screenshots).toHaveLength(1);
    expect(result.screenshots[0].ref).toEqual(ref);
    expect(JSON.stringify(result.screenshots)).not.toContain("ZmFrZS1wbmctYnl0ZXM");

    // 4) 桥请求不再携带 file_path / session_path
    const shotCall = calls.find((call) => call.method === "browser_screenshot");
    expect(shotCall?.params).toMatchObject({
      created_by: "s1",
      full_page: true,
      wants_save: false,
    });
    expect(shotCall?.params.file_path).toBeUndefined();
    expect(shotCall?.params.session_path).toBeUndefined();
  });
});
