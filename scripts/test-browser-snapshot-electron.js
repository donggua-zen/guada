const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const yaml = require("js-yaml");

app.setPath("userData", path.join(os.tmpdir(), `guada-snapshot-test-${process.pid}`));
const {
  BrowserAutomationService,
} = require("../electron/dist/browser-automation-service.js");

const requestedUrl = process.argv[2];
const fixtureHtml = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Accessibility Snapshot Fixture</title></head>
<body>
  <div><div><div><nav aria-label="主导航">
    <a href="#home">首页</a>
    <a href="#shows">番剧</a>
    <a href="#live">直播</a>
  </nav></div></div></div>
  <main>
    <div><section><div><h1>快照测试页面</h1></div></section></div>
    <p>这是一段普通可见正文</p>
    <div><div><button id="submit" type="button">提交</button></div></div>
    <label for="search">搜索内容</label>
    <div><div><textarea id="search" aria-label="搜索内容"></textarea></div></div>
    <select aria-label="主题"><option>浅色</option><option>深色</option></select>
    <div role="checkbox" aria-label="记住设置" aria-checked="true" tabindex="0"></div>
    <div id="shadow-host"></div>
    <div aria-hidden="true"><button>不可见按钮</button></div>
  </main>
  <script>
    document.getElementById('submit').addEventListener('click', function() {
      document.body.dataset.clicked = 'yes';
    });
    document.getElementById('search').addEventListener('input', function(event) {
      document.body.dataset.inputValue = event.target.value;
    });
    const shadow = document.getElementById('shadow-host').attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button aria-label="Shadow Action">Shadow Action</button>';
  </script>
</body>
</html>`;

function findNodeByName(node, name) {
  if (!node) return undefined;
  if (node.name === name) return node;
  for (const child of node.children || []) {
    const found = findNodeByName(child, name);
    if (found) return found;
  }
  return undefined;
}

function findRefByName(node, name) {
  if (!node) return undefined;
  if (node.name === name && node.ref) return node.ref;
  for (const child of node.children || []) {
    const ref = findRefByName(child, name);
    if (ref) return ref;
  }
  return undefined;
}

function fakeWindowInfo(url) {
  const now = Date.now();
  return {
    windowId: "win_test",
    title: "Snapshot Test",
    url,
    createdAt: now,
    lastActiveAt: now,
    isActive: false,
    isMainApp: false,
    isVisible: false,
    metadata: { createdBy: "snapshot-test" },
  };
}

async function run() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const targetUrl = requestedUrl || `data:text/html;charset=utf-8,${encodeURIComponent(fixtureHtml)}`;
  const loadStarted = Date.now();
  await win.loadURL(targetUrl);
  const loadDurationMs = Date.now() - loadStarted;

  const info = fakeWindowInfo(targetUrl);
  const manager = {
    getWindowList: () => [info],
    getWebContents: () => win.webContents,
    getWebviewWebContents: async () => win.webContents,
  };
  const service = new BrowserAutomationService();
  service.initializeWindowManager(manager);

  const originalHtmlLength = await win.webContents.executeJavaScript(
    "document.documentElement.outerHTML.length",
  );

  const structStarted = Date.now();
  const struct = await service.getPageStruct("win_test", "snapshot-test");
  const structDurationMs = Date.now() - structStarted;

  const simpleStarted = Date.now();
  const simple = await service.getPageSimpleSnapshot("win_test", "snapshot-test");
  const simpleDurationMs = Date.now() - simpleStarted;
  const simpleYaml = yaml.dump(simple.snapshot, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
  const structJson = JSON.stringify(struct.struct, null, 2);

  const result = {
    page: requestedUrl || "local-fixture",
    source: simple.source,
    loadDurationMs,
    originalHtmlLength,
    struct: {
      chars: structJson.length,
      nodeCount: struct.stats.nodeCount,
      maxDepth: struct.stats.maxDepth,
      durationMs: structDurationMs,
    },
    simple: {
      chars: simpleYaml.length,
      nodeCount: simple.stats.outputNodeCount,
      interactiveNodeCount: simple.stats.interactiveNodeCount,
      maxDepth: simple.stats.maxDepth,
      rawNodeCount: simple.stats.rawNodeCount,
      durationMs: simpleDurationMs,
    },
    reductionVsStructPercent:
      structJson.length === 0
        ? 0
        : Number(((1 - simpleYaml.length / structJson.length) * 100).toFixed(2)),
    interaction: null,
    simpleYaml: requestedUrl ? undefined : simpleYaml,
    simpleYamlPreview: requestedUrl ? simpleYaml.slice(0, 1200) : undefined,
  };

  if (!requestedUrl) {
    const buttonRef = findRefByName(simple.snapshot, "提交");
    const inputRef = findRefByName(simple.snapshot, "搜索内容");
    const prose = findNodeByName(simple.snapshot, "这是一段普通可见正文");
    const theme = findNodeByName(simple.snapshot, "主题");
    const checkbox = findNodeByName(simple.snapshot, "记住设置");
    const hidden = findNodeByName(simple.snapshot, "不可见按钮");
    const shadowAction = findNodeByName(simple.snapshot, "Shadow Action");
    if (!buttonRef || !inputRef) {
      throw new Error(
        `Expected refs missing: button=${buttonRef || "none"}, input=${inputRef || "none"}\n${simpleYaml}`,
      );
    }
    if (!prose) throw new Error("Visible prose missing from simple snapshot");
    if (!theme?.children?.some((node) => node.name === "浅色")) {
      throw new Error("Composite control options missing from simple snapshot");
    }
    if (checkbox?.checked !== true) throw new Error("Checkbox state was not normalized");
    if (hidden) throw new Error("aria-hidden content leaked into simple snapshot");
    if (shadowAction?.ref) throw new Error("Shadow DOM node received an unusable top-document ref");
    if (win.webContents.debugger.isAttached()) {
      throw new Error("Debugger remained attached after snapshot capture");
    }

    const refAttributes = await win.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll('[data-ai-ref]')).map(function(el) {
        return { ref: el.getAttribute('data-ai-ref'), tag: el.tagName.toLowerCase() };
      })
    `);
    const inputValue = "hello'\\line\nnext";
    await service.click(buttonRef, "win_test", "snapshot-test");
    await service.fillForm(inputRef, inputValue, "win_test", "snapshot-test");
    const state = await win.webContents.executeJavaScript(`({
      clicked: document.body.dataset.clicked,
      inputValue: document.body.dataset.inputValue,
      actualInputValue: document.getElementById('search').value
    })`);

    if (state.clicked !== "yes") throw new Error("Ref click did not reach target button");
    if (state.inputValue !== inputValue || state.actualInputValue !== inputValue) {
      throw new Error("Ref input did not preserve quotes, backslashes and newlines");
    }
    win.webContents.debugger.attach("1.3");
    const fallback = await service.getPageSimpleSnapshot(
      "win_test",
      "snapshot-test",
    );
    if (fallback.source !== "dom-fallback") {
      throw new Error(`Expected DOM fallback, got ${fallback.source}`);
    }
    if (!win.webContents.debugger.isAttached()) {
      throw new Error("Snapshot fallback detached a debugger it did not own");
    }
    win.webContents.debugger.detach();

    const unrelatedFailListener = () => {};
    win.webContents.on("did-fail-load", unrelatedFailListener);
    const failListenersBefore = win.webContents.listenerCount("did-fail-load");
    const nextNavigation = win.webContents.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent("<!doctype html><title>Listener Test</title><p>ready</p>")}`,
    );
    const waitedNavigation = service.waitForPageLoad(win.webContents, 5000);
    await Promise.all([nextNavigation, waitedNavigation]);
    const failListenersAfter = win.webContents.listenerCount("did-fail-load");
    win.webContents.removeListener("did-fail-load", unrelatedFailListener);
    if (failListenersAfter !== failListenersBefore) {
      throw new Error(
        `Page-load listener leak: before=${failListenersBefore}, after=${failListenersAfter}`,
      );
    }

    await win.webContents.executeJavaScript("document.body.remove()");
    let extractionFailurePropagated = false;
    try {
      await service.getPageStruct("win_test", "snapshot-test");
    } catch {
      extractionFailurePropagated = true;
    }
    if (!extractionFailurePropagated) {
      throw new Error("DOM extraction failure was reported as success");
    }

    result.interaction = {
      buttonRef,
      inputRef,
      refAttributes,
      clickPassed: true,
      inputPassed: true,
      prosePassed: true,
      compositeControlPassed: true,
      hiddenContentPassed: true,
      debuggerDetached: true,
      shadowRefExcluded: true,
      fallbackPassed: true,
      pageLoadListenerCleanupPassed: true,
      extractionFailurePropagationPassed: true,
    };
  }

  console.log("SNAPSHOT_BENCHMARK_JSON=" + JSON.stringify(result));
  await win.close();
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  });
