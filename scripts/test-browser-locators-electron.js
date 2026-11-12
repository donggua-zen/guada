const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

app.setPath("userData", path.join(os.tmpdir(), `guada-locators-test-${process.pid}`));

const {
  BrowserAutomationService,
} = require("../electron/dist/browser-automation-service.js");

const fixture = fs.readFileSync(
  path.join(__dirname, "fixtures", "browser-locators.html"),
  "utf8",
);

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fixture);
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectError(fn, code) {
  try {
    await fn();
  } catch (error) {
    assert(error && error.code === code, `expected ${code}, got ${error && error.code}: ${error && error.message}`);
    return error;
  }
  throw new Error(`expected ${code}, but the action succeeded`);
}

async function main() {
  await app.whenReady();
  const { server, url } = await startServer();
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(url);
  await new Promise((r) => setTimeout(r, 400));

  const info = {
    windowId: "win_test",
    title: "Browser Locator Fixture",
    url,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    isActive: true,
    isMainApp: false,
    isVisible: true,
    metadata: { createdBy: "loc-test" },
  };
  const manager = {
    getWindowList: () => [info],
    getWebContents: () => win.webContents,
    getWebviewWebContents: async () => win.webContents,
    isWindowVisible: () => true,
    setWebviewRenderable: () => {},
    // 真实 BrowserWebviewManager 会初始化这个字段；service 依赖 typeof 判断是否接线
    onOpenInNewTab: null,
  };
  const service = new BrowserAutomationService();
  service.initializeWindowManager(manager);
  await service.tabsManage("select", "loc-test", 0);

  // 无当前标签 + 非导航命令：错误必须指向 tab.goto，而不是已退役的 browser_navigate
  let noTabError = null;
  try {
    await service.handleToolCall({
      id: "0",
      method: "browser_snapshot",
      params: { created_by: "fresh-session" },
    });
  } catch (error) {
    noTabError = error;
  }
  assert(noTabError, "expected a no-active-tab error");
  const noTabMessage = String(noTabError.message || noTabError);
  assert(
    noTabMessage.includes("tab.goto(url)"),
    `no-tab error should mention tab.goto: ${noTabMessage}`,
  );
  assert(
    !noTabMessage.includes("browser_navigate"),
    `no-tab error should not mention browser_navigate: ${noTabMessage}`,
  );
  console.log("LOCATOR_OK no-tab guidance");

  // 每会话标签上限：8 个时新建返回 TAB_LIMIT；当前指针缺失时接管已有标签
  const capWindows = Array.from({ length: 8 }, (_, i) => ({
    windowId: `cap_${i}`,
    title: `Cap ${i}`,
    url: `https://cap${i}.test/`,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    isActive: false,
    isMainApp: false,
    isVisible: false,
    metadata: { createdBy: "cap-test", sessionId: "cap-test" },
  }));
  const originalGetWindowList = manager.getWindowList;
  manager.getWindowList = () => capWindows;
  try {
    const capError = await expectError(
      () =>
        service.handleToolCall({
          id: "0",
          method: "browser_navigate",
          params: {
            url: "https://example.com",
            new_tab: true,
            created_by: "cap-test",
            session_id: "cap-test",
          },
        }),
      "TAB_LIMIT",
    );
    assert(capError.details?.limit === 8, "TAB_LIMIT details.limit missing");
    assert(
      capError.details?.tabs?.length === 8,
      `TAB_LIMIT details.tabs wrong: ${JSON.stringify(capError.details)}`,
    );

    const adopted = await service.handleToolCall({
      id: "0",
      method: "browser_tabs",
      params: { action: "current", created_by: "cap-test" },
    });
    assert(
      adopted && adopted.tabId === "cap_0",
      `current tab adoption failed: ${JSON.stringify(adopted)}`,
    );
    console.log("LOCATOR_OK tab limit and current adoption");

    // window.open 满额回退：把 URL 加载回 origin 标签
    const originalGetWebContents = manager.getWebContents;
    const loads = [];
    manager.getWebContents = (windowId) =>
      windowId === "cap_0"
        ? {
            isDestroyed: () => false,
            loadURL: async (url) => {
              loads.push(url);
            },
          }
        : null;
    manager.onOpenInNewTab("https://popup.test/", "cap_0");
    await new Promise((resolve) => setTimeout(resolve, 50));
    manager.getWebContents = originalGetWebContents;
    assert(
      loads.includes("https://popup.test/"),
      `popup cap fallback failed: ${JSON.stringify(loads)}`,
    );
    console.log("LOCATOR_OK popup fallback at tab limit");
  } finally {
    manager.getWindowList = originalGetWindowList;
  }

  const loc = (action, descriptor, extra = {}) =>
    service.handleToolCall({
      id: "0",
      method: "browser_locator",
      params: { action, descriptor, created_by: "loc-test", ...extra },
    });
  const pageRun = (code) => win.webContents.executeJavaScript(code, false);

  // role + trusted click
  await loc("click", { kind: "role", role: "button", name: "Submit" });
  assert((await pageRun("window.__clicks")).includes("submit"), "submit click failed");
  assert((await pageRun("document.querySelectorAll('[data-guada-loc]').length")) === 0, "temp attribute leaked");
  console.log("LOCATOR_OK role click");

  // aria-label / aria-labelledby
  await loc("click", { kind: "role", role: "button", name: "Close" });
  await loc("click", { kind: "role", role: "button", name: "Save changes" });
  assert((await pageRun("window.__clicks")).includes("close"), "aria-label click failed");
  assert((await pageRun("window.__clicks")).includes("save"), "aria-labelledby click failed");
  console.log("LOCATOR_OK accessible names");

  // any element: heading and text
  await loc("click", { kind: "role", role: "heading", name: "Section heading" });
  await loc("click", { kind: "text", text: "More info" });
  assert((await pageRun("window.__clicks")).includes("heading"), "heading click failed");
  assert((await pageRun("window.__clicks")).includes("link"), "text click failed");
  console.log("LOCATOR_OK any element");

  // fill / select / check
  await loc("fill", { kind: "label", text: "Email" }, { value: "user@example.com" });
  assert((await pageRun("document.getElementById('email').value")) === "user@example.com", "label fill failed");
  await loc("fill", { kind: "placeholder", text: "Search" }, { value: "hello" });
  assert((await pageRun("document.getElementById('search').value")) === "hello", "placeholder fill failed");
  await loc("click", { kind: "testid", testId: "submit-testid" });
  assert((await pageRun("window.__clicks")).includes("testid"), "testid click failed");
  await loc("check", { kind: "role", role: "checkbox", name: "Remember me" });
  assert((await pageRun("document.getElementById('remember').checked")) === true, "check failed");
  const selected = await loc("selectOption", { kind: "role", role: "combobox", name: "Country" }, { values: "cn" });
  assert(selected.selected && selected.selected[0] === "cn", "selectOption failed");
  console.log("LOCATOR_OK forms");

  // alt / title / custom role
  assert((await loc("count", { kind: "altText", text: "Company logo" })) === 1, "alt text count failed");
  assert((await loc("count", { kind: "title", text: "Tooltip title" })) === 1, "title count failed");
  assert((await loc("count", { kind: "role", role: "button", name: { __regexp: "^Sub", flags: "i" } })) === 1, "regex name count failed");
  await loc("click", { kind: "role", role: "button", name: "Custom role button" });
  assert((await pageRun("window.__clicks")).includes("custom"), "custom role click failed");
  console.log("LOCATOR_OK extra getBy*");

  // strictness + first/last/nth
  const ambiguous = await expectError(
    () => loc("click", { kind: "role", role: "button", name: "Delete" }),
    "AMBIGUOUS",
  );
  assert(
    Array.isArray(ambiguous.details?.candidates) && ambiguous.details.candidates.length === 2,
    "ambiguous candidates missing",
  );
  await loc("click", { kind: "role", role: "button", name: "Delete", index: 1 });
  const clicks = await pageRun("window.__clicks");
  assert(clicks.includes("delete:bob"), `nth click failed: ${JSON.stringify(clicks)}`);
  await loc("click", { kind: "role", role: "button", name: "Delete", index: 0 });
  assert((await pageRun("window.__clicks")).includes("delete:alice"), "first click failed");
  await loc("click", { kind: "selector", selector: ".delete", index: 1 });
  const selectorClicks = await pageRun("window.__clicks");
  assert(
    selectorClicks.filter((name) => name === "delete:bob").length >= 2,
    "CSS nth click failed",
  );
  console.log("LOCATOR_OK strictness");

  // chained scopes: parent chain with per-step index
  const chainAmbiguous = await expectError(
    () =>
      loc("click", {
        kind: "selector",
        selector: "p",
        scope: [{ kind: "selector", selector: "article" }],
      }),
    "AMBIGUOUS",
  );
  assert(
    chainAmbiguous.details?.candidates?.length === 6,
    `chained ambiguity candidates: ${JSON.stringify(chainAmbiguous.details)}`,
  );
  const zeta = await loc("text", {
    kind: "selector",
    selector: "p",
    index: 1,
    scope: [{ kind: "selector", selector: "article", index: 2 }],
  });
  assert(zeta === "Zeta body", `chained per-step index failed: ${zeta}`);
  await loc("click", {
    kind: "role",
    role: "button",
    name: "Open",
    scope: [{ kind: "selector", selector: "#post-2" }],
  });
  assert((await pageRun("window.__clicks")).includes("open:two"), "chained scoped click failed");
  const chainedState = await loc("state", {
    kind: "role",
    role: "button",
    name: "Open",
    scope: [{ kind: "selector", selector: "#post-3" }],
  });
  assert(chainedState.found && chainedState.visible, "chained state failed");
  console.log("LOCATOR_OK chained scopes");

  // state / count / text / isVisible
  const state = await loc("state", { kind: "label", text: "Email" });
  assert(state.found && state.visible && state.editable, "state probe failed");
  assert((await loc("count", { kind: "role", role: "button" })) >= 5, "count failed");
  assert((await loc("text", { kind: "text", text: "More info" })) === "More info", "text failed");
  assert((await loc("isVisible", { kind: "role", role: "button", name: "Hidden button", exact: true })) === false, "hidden isVisible failed");
  assert((await loc("isVisible", { kind: "role", role: "button", name: "Submit" })) === true, "visible isVisible failed");
  console.log("LOCATOR_OK state reads");

  // 基础读取：getAttribute / inputValue / boundingBox，以及 focus / clear / dblclick 动作
  assert(
    (await loc("attribute", { kind: "role", role: "link", name: "More info" }, { attribute: "href" })) === "#target",
    "getAttribute href failed",
  );
  assert(
    (await loc("attribute", { kind: "role", role: "button", name: "Submit" }, { attribute: "data-missing" })) === null,
    "getAttribute missing should be null",
  );
  await loc("fill", { kind: "label", text: "Email" }, { value: "typed@example.com" });
  const emailState = await loc("state", { kind: "label", text: "Email" });
  assert(emailState.value === "typed@example.com", `inputValue failed: ${emailState.value}`);
  const box = emailState.rect;
  assert(box.width > 0 && box.height > 0, `boundingBox failed: ${JSON.stringify(box)}`);

  await loc("clear", { kind: "label", text: "Email" });
  assert((await pageRun("document.getElementById('email').value")) === "", "clear failed");

  await loc("focus", { kind: "label", text: "Email" });
  assert(
    (await pageRun("document.activeElement && document.activeElement.id")) === "email",
    "focus failed",
  );

  await pageRun("window.__dbl = 0; document.getElementById('submit').addEventListener('dblclick', () => { window.__dbl += 1; });");
  await loc("dblclick", { kind: "role", role: "button", name: "Submit" });
  assert((await pageRun("window.__dbl")) >= 1, "dblclick did not fire");
  console.log("LOCATOR_OK basic readers and actions");

  // wait states
  const delayed = await loc("wait", { kind: "text", text: "Delayed" }, { state: "visible", timeout: 2000 });
  assert(delayed.ok === true && delayed.state === "visible", "visible wait failed");
  const hidden = await loc("wait", { kind: "role", role: "button", name: "Hidden button", exact: true }, { state: "hidden", timeout: 2000 });
  assert(hidden.ok === true, "hidden wait failed");
  const hiddenText = await loc("wait", { kind: "text", text: "Hidden text", exact: true }, { state: "hidden", timeout: 2000 });
  assert(hiddenText.ok === true, "hidden text wait failed");
  const detached = await loc("wait", { kind: "text", text: "Removable" }, { state: "detached", timeout: 2000 });
  assert(detached.ok === true, "detached wait failed");
  console.log("LOCATOR_OK wait states");

  // shadow DOM: query works, action unsupported
  assert((await loc("count", { kind: "role", role: "button", name: "Shadow Action" })) === 1, "shadow count failed");
  await expectError(
    () => loc("click", { kind: "role", role: "button", name: "Shadow Action" }),
    "UNSUPPORTED",
  );
  console.log("LOCATOR_OK shadow query / action guard");

  // iframe: top-frame only
  assert((await loc("count", { kind: "role", role: "button", name: "Inside Frame" })) === 0, "iframe should not be queryable");
  console.log("LOCATOR_OK iframe top-frame");

  // live re-resolution after DOM replacement
  await pageRun(`document.getElementById("dynamic").outerHTML = '<button id="dynamic-new">Dynamic</button>'`);
  const dynamicText = await loc("text", { kind: "text", text: "Dynamic" });
  assert(dynamicText === "Dynamic", "dynamic text failed");
  const dynamicState = await loc("state", { kind: "text", text: "Dynamic" });
  assert(dynamicState.found && dynamicState.visible, "dynamic state failed");
  console.log("LOCATOR_OK live re-resolution");

  // 成功导航结果附带标签摘要（复用当前标签：count/current，不重复完整列表）
  const navResult = await service.handleToolCall({
    id: "0",
    method: "browser_navigate",
    params: {
      url,
      created_by: "loc-test",
      wait_until: "domcontentloaded",
    },
  });
  assert(
    navResult.tabs && navResult.tabs.count === 1 && navResult.tabs.limit === 8,
    `tabs summary missing: ${JSON.stringify(navResult.tabs)}`,
  );
  assert(
    navResult.tabs.current && navResult.tabs.current.isCurrent === true,
    "tabs summary current missing",
  );
  console.log("LOCATOR_OK tabs summary");

  win.destroy();
  server.close();
  console.log("LOCATOR_TEST_OK");
  app.exit(0);
}

main().catch((error) => {
  console.error("LOCATOR_TEST_FAILED", error);
  app.exit(1);
});
