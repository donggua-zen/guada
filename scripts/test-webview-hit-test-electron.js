const { app, BrowserWindow, webContents } = require("electron");
const path = require("node:path");

app.setPath(
  "userData",
  path.join(require("node:os").tmpdir(), `guada-hit-test-${process.pid}`),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function main() {
  await app.whenReady();

  const win = new BrowserWindow({
    width: 900,
    height: 600,
    show: true,
    skipTaskbar: true,
    // 测试脚本不能假设终端没有遮挡窗口：保持测试窗在前，capturePage 才有帧。
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  await win.loadFile(
    path.join(__dirname, "fixtures", "webview-hit-test-host.html"),
  );

  const guestId = await waitFor(
    () =>
      win.webContents.executeJavaScript(
        "document.getElementById('wv').getWebContentsId?.() || 0",
      ),
    8000,
    "webview attach",
  );
  const guest = webContents.fromId(guestId);
  assert(guest && !guest.isDestroyed(), "guest webContents missing");
  await waitFor(() => guest.getURL().startsWith("file:"), 8000, "guest load");
  await new Promise((resolve) => setTimeout(resolve, 300));

  const probe = () =>
    win.webContents.executeJavaScript(`(() => {
      const wv = document.getElementById('wv');
      const wrapper = document.getElementById('wrapper');
      const hit = document.elementFromPoint(10, 10);
      const rect = wrapper.getBoundingClientRect();
      return {
        pointerEvents: getComputedStyle(wv).pointerEvents,
        opacity: getComputedStyle(wrapper).opacity,
        hitId: hit ? hit.id : undefined,
        hitTag: hit ? hit.tagName : undefined,
        rectRight: rect.right,
        rectBottom: rect.bottom,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      };
    })()`);

  // 1) 截图临时表面 + inert：点击必须穿透到下层按钮
  const renderable = await probe();
  assert(
    renderable.pointerEvents === "none",
    `renderable webview must disable pointer-events, got ${renderable.pointerEvents}`,
  );
  assert(renderable.opacity === "0.001", `expected opacity 0.001, got ${renderable.opacity}`);
  assert(
    renderable.hitId === "underlying",
    `renderable surface must not be hit-testable, got ${renderable.hitId || renderable.hitTag}`,
  );
  assert(
    renderable.rectRight <= renderable.innerWidth + 1 &&
      renderable.rectBottom <= renderable.innerHeight + 1,
    `renderable surface must fit the host window: ${JSON.stringify(renderable)}`,
  );
  console.log("HIT_TEST_OK renderable pass-through");

  // 2) 去掉 inert，只靠 pointer-events 也必须穿透（防 CSS 回归）
  await win.webContents.executeJavaScript(
    "document.getElementById('wrapper').removeAttribute('inert')",
  );
  const withoutInert = await probe();
  assert(
    withoutInert.pointerEvents === "none",
    "renderable webview must keep pointer-events:none",
  );
  assert(
    withoutInert.hitId === "underlying",
    `pointer-events:none alone must pass clicks through, got ${withoutInert.hitId || withoutInert.hitTag}`,
  );
  console.log("HIT_TEST_OK pointer-events only");

  // 3) 前台可交互：webview 才接收命中
  await win.webContents.executeJavaScript("window.__setInteractive()");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const interactive = await probe();
  assert(
    interactive.pointerEvents === "auto",
    `interactive webview should accept pointer events, got ${interactive.pointerEvents}`,
  );
  assert(
    interactive.hitTag === "WEBVIEW",
    `interactive webview should be hit target, got ${interactive.hitTag}`,
  );
  console.log("HIT_TEST_OK interactive hit");

  // 4) 回到临时表面，guest 仍能产帧（不被 pointer-events/inert 影响）
  await win.webContents.executeJavaScript("window.__setRenderable(true)");
  win.moveTop();
  win.focus();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const surface = await Promise.race([
    guest.capturePage(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("guest capturePage timeout")), 8000),
    ),
  ]);
  assert(!surface.isEmpty(), "renderable guest should still produce frames");
  const size = surface.getSize();
  assert(size.width > 0 && size.height > 0, `capture size invalid: ${JSON.stringify(size)}`);
  console.log("HIT_TEST_OK capture still works");

  win.destroy();
  console.log("WEBVIEW_HIT_TEST_OK");
  app.exit(0);
}

main().catch((error) => {
  console.error("WEBVIEW_HIT_TEST_FAILED", error);
  app.exit(1);
});
