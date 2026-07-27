const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const electronPath = require("electron");

const fixturePath = path.join(__dirname, "test-webview-navigation-crash-electron.js");
function reserveUnusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function runFixture(scenario, targetUrl) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(electronPath, [fixturePath, scenario, targetUrl], {
      cwd: path.join(__dirname, ".."),
      env: childEnv,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 20000);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const events = stdout
        .split(/\r?\n/)
        .filter((line) => line.startsWith("WEBVIEW_CRASH_EVENT="))
        .map((line) => JSON.parse(line.slice("WEBVIEW_CRASH_EVENT=".length)));
      resolve({ scenario, targetUrl, code, signal, timedOut, stdout, stderr, events });
    });
  });
}

function printResult(result) {
  const observed = result.events.map((event) => event.type).join(", ");
  console.log(JSON.stringify({
    scenario: result.scenario,
    targetUrl: result.targetUrl,
    exitCode: result.code,
    signal: result.signal,
    timedOut: result.timedOut,
    observedEvents: observed,
  }));
  if (result.stderr) process.stderr.write(result.stderr);
}

function requireEvent(result, type) {
  if (!result.events.some((event) => event.type === type)) {
    throw new Error(`Missing ${type} in ${JSON.stringify(result, null, 2)}`);
  }
}

async function main() {
  const refusedPort = await reserveUnusedPort();
  const refusedUrl = `http://127.0.0.1:${refusedPort}/`;
  const refused = await runFixture("connection-refused", refusedUrl);
  printResult(refused);
  requireEvent(refused, "fixture-observed-attach");
  const failure = refused.events.find((event) => event.type === "fixture-observed-failure");
  if (!failure || failure.errorCode !== -102 || failure.errorDescription !== "ERR_CONNECTION_REFUSED") {
    throw new Error(`ERR_CONNECTION_REFUSED was not observed: ${JSON.stringify(refused, null, 2)}`);
  }
  if (
    refused.code !== 0 ||
    refused.signal ||
    refused.timedOut ||
    !refused.events.some((event) => event.type === "fixture-finish")
  ) {
    throw new Error(`ERR_CONNECTION_REFUSED still destabilized Electron: ${JSON.stringify(refused, null, 2)}`);
  }

  const chromeError = await runFixture("chrome-error", "chrome-error://chromewebdata/");
  printResult(chromeError);
  requireEvent(chromeError, "fixture-observed-attach");
  if (chromeError.code !== 0 || chromeError.signal || chromeError.timedOut) {
    throw new Error(`chrome-error case did not survive: ${JSON.stringify(chromeError, null, 2)}`);
  }
  requireEvent(chromeError, "fixture-finish");

  console.log("WEBVIEW_NAVIGATION_CRASH_FIXED=true");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
