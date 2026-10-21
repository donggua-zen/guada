const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

app.setPath(
  "userData",
  path.join(os.tmpdir(), `guada-actions-test-${process.pid}`),
);

const {
  BrowserAutomationService,
} = require("../electron/dist/browser-automation-service.js");

const fixture = fs.readFileSync(
  path.join(__dirname, "fixtures", "browser-actions.html"),
  "utf8",
);

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fixture);
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        url: `http://127.0.0.1:${server.address().port}/`,
      });
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectError(fn, code, reason) {
  try {
    await fn();
  } catch (error) {
    assert(error && error.code === code, `expected ${code}, got ${error && error.code}: ${error && error.message}`);
    if (reason) {
      assert(
        error.details && error.details.reason === reason,
        `expected reason ${reason}, got ${JSON.stringify(error.details && error.details.reason)}`,
      );
    }
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL(url);

  const info = {
    windowId: "win_test",
    title: "Browser Actions Fixture",
    url,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    isActive: true,
    isMainApp: false,
    isVisible: true,
    metadata: { createdBy: "actions-test" },
  };
  const manager = {
    getWindowList: () => [info],
    getWebContents: () => win.webContents,
    getWebviewWebContents: async () => win.webContents,
    isWindowVisible: () => true,
    setWebviewRenderable: () => {},
  };
  const service = new BrowserAutomationService();
  service.initializeWindowManager(manager);

  const read = (code) => win.webContents.executeJavaScript(code, false);

  // 0. navigation allowlist
  await expectError(
    () => service.navigate("javascript:alert(1)", true, "actions-test"),
    "NAVIGATION_BLOCKED",
  );
  await expectError(
    () => service.navigate("file:///tmp/escape.html", true, "actions-test"),
    "NAVIGATION_BLOCKED",
  );
  console.log("ACTION_OK navigation allowlist");

  // 1. probe
  const state = await service.elementState("#normal", "win_test", "actions-test");
  assert(state.found && state.visible && state.enabled, "normal button should be actionable");
  assert(state.covered === false, "normal button should not be covered");
  console.log("ACTION_OK elementState");

  // 2. trusted click
  await service.click("#normal", "win_test", "actions-test");
  const clickState = await read("({ clicks: window.__clicks, events: window.__events })");
  assert(clickState.clicks === 1, `expected 1 click, got ${clickState.clicks}`);
  const normalEvent = clickState.events.find((e) => e.name === "normal-click");
  assert(normalEvent && normalEvent.trusted === true, "normal click should be trusted");
  console.log("ACTION_OK trusted click");

  // 2b. double click option
  await service.click("#multi", "win_test", "actions-test", { clickCount: 2 });
  const multiState = await read("window.__dblClicks");
  assert(multiState >= 1, `double click count was ${multiState}`);
  console.log("ACTION_OK click options");

  // 3. disabled / hidden / covered
  await expectError(
    () => service.click("#disabled", "win_test", "actions-test", { timeout: 200 }),
    "NOT_ACTIONABLE",
    "disabled",
  );
  await expectError(
    () => service.click("#hidden", "win_test", "actions-test", { timeout: 200 }),
    "NOT_ACTIONABLE",
    "hidden",
  );
  await expectError(
    () => service.click("#covered", "win_test", "actions-test", { timeout: 200 }),
    "NOT_ACTIONABLE",
    "covered",
  );
  console.log("ACTION_OK actionability failures");

  // 4. force clicks the top layer (the overlay), proving coverage was bypassed
  await service.click("#covered", "win_test", "actions-test", { force: true });
  const forceState = await read("({ overlay: window.__overlayClicks, covered: window.__coveredClicks })");
  assert(forceState.overlay >= 1, "force click should hit the overlay layer");
  assert(forceState.covered === 0, "covered button should not receive the forced click");
  console.log("ACTION_OK force");

  // 5. fill
  await service.fillForm("#text-input", "hello world", "win_test", "actions-test");
  const textValue = await read("document.getElementById('text-input').value");
  assert(textValue === "hello world", `text input value was ${textValue}`);
  const textEvents = await read("window.__events.map(e => e.name)");
  assert(textEvents.includes("text-input"), "fill should dispatch input");
  await service.fillForm("#ce", "hello ce", "win_test", "actions-test");
  const ceValue = await read("document.getElementById('ce').innerText");
  assert(ceValue === "hello ce", `contenteditable value was ${ceValue}`);
  await expectError(
    () => service.fillForm("#select", "cn", "win_test", "actions-test"),
    "UNSUPPORTED",
  );
  await expectError(
    () => service.fillForm("#check", "yes", "win_test", "actions-test"),
    "UNSUPPORTED",
  );
  console.log("ACTION_OK fill");

  // 6. selectOption
  const selected = await service.selectOption(
    "#select",
    { label: "China" },
    "win_test",
    "actions-test",
  );
  assert(
    Array.isArray(selected.selected) &&
      selected.selected.length === 1 &&
      selected.selected[0] === "cn",
    `selected was ${JSON.stringify(selected.selected)}`,
  );
  console.log("ACTION_OK selectOption");

  // 7. check / uncheck
  const checked = await service.check("#check", true, "win_test", "actions-test");
  assert(checked.checked === true, "check should report true");
  assert(
    (await read("document.getElementById('check').checked")) === true,
    "checkbox should be checked",
  );
  const unchecked = await service.check("#check", false, "win_test", "actions-test");
  assert(unchecked.checked === false, "uncheck should report false");
  assert(
    (await read("document.getElementById('check').checked")) === false,
    "checkbox should be unchecked",
  );
  console.log("ACTION_OK check");

  // 8. hover
  await service.hover("#hover-target", "win_test", "actions-test");
  const menuDisplay = await read("getComputedStyle(document.getElementById('menu')).display");
  assert(menuDisplay === "block", `menu display was ${menuDisplay}`);
  console.log("ACTION_OK hover");

  // 9. press
  await service.press("Enter", "win_test", "actions-test", { selector: "#keylog" });
  await service.press("Control+A", "win_test", "actions-test", { selector: "#keylog" });
  const keys = await read("window.__events.filter(e => e.name === 'keydown')");
  assert(
    keys.some((e) => e.key === "Enter"),
    `Enter keydown missing: ${JSON.stringify(keys)}`,
  );
  assert(
    keys.some((e) => e.key === "a" && e.ctrl === true),
    `Control+A keydown missing: ${JSON.stringify(keys)}`,
  );
  console.log("ACTION_OK press");

  // 10. scroll inner container
  const scrolled = await service.scroll("win_test", "actions-test", {
    selector: "#scroller",
    deltaY: 400,
  });
  const scrollTop = await read("document.getElementById('scroller').scrollTop");
  assert(
    scrollTop > 0 || scrolled.elementScrollTop > 0,
    `scroller scrollTop was ${scrollTop}, result ${JSON.stringify(scrolled)}`,
  );
  console.log("ACTION_OK scroll");

  // 11. wait states
  const delayed = await service.waitForSelector(
    "#delayed",
    2000,
    "win_test",
    "actions-test",
    undefined,
    "visible",
  );
  assert(delayed.ok === true && delayed.state === "visible", "delayed wait failed");
  const removed = await service.waitForSelector(
    "#removable",
    2000,
    "win_test",
    "actions-test",
    undefined,
    "detached",
  );
  assert(removed.ok === true && removed.state === "detached", "detached wait failed");
  await expectError(
    () => service.waitForSelector("#never", 300, "win_test", "actions-test", undefined, "visible"),
    "TIMEOUT",
  );
  console.log("ACTION_OK wait states");

  win.destroy();
  server.close();
  console.log("ACTION_TEST_OK");
}

main()
  .then(() => {
    app.exit(0);
  })
  .catch((error) => {
    console.error("ACTION_TEST_FAILED", error);
    app.exit(1);
  });
