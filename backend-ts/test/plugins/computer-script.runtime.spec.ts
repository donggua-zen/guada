import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ComputerScriptRuntime } from "../../src/modules/plugins/builtins/computer-script/computer-script-runtime";
import { ComputerScriptHooks, ComputerScriptError } from "../../src/modules/plugins/builtins/computer-script/computer-script.types";
import { ComputerLeaseRegistry } from "../../src/modules/plugins/builtins/computer-use/lease";
import { BridgeRequestError } from "../../src/modules/bridge/bridge-client";

jest.setTimeout(15_000);

function createBridge(responses: Record<string, any> = {}) {
  return {
    request: jest.fn(async (method: string, params: any) => {
      const value = responses[method];
      return typeof value === "function" ? value(params) : value;
    }),
  };
}

function createHooks(
  overrides: Partial<ComputerScriptHooks> = {},
): ComputerScriptHooks {
  return {
    sessionId: "session-1",
    leases: new ComputerLeaseRegistry(),
    isPlanMode: () => false,
    authorize: jest.fn(async () => undefined),
    ...overrides,
  };
}

async function makeScreenshotFixture(): Promise<{
  file: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "computer-runtime-test-"));
  const file = path.join(dir, "shot.png");
  await fs.writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return {
    file,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

function run(
  runtime: ComputerScriptRuntime,
  script: string,
  hooks: ComputerScriptHooks,
  timeoutMs?: number,
) {
  return runtime.run({ script, hooks, timeoutMs });
}

describe("ComputerScriptRuntime", () => {
  it("auto-carries the observation generation and clears the lease after input", async () => {
    const bridge = createBridge({
      computer_a11y_observe: {
        generation: 7,
        entries: [{ ref: 3, role: "button", name: "Save" }],
        text: "[3] button Save",
      },
      computer_input: { message: "clicked" },
    });
    const hooks = createHooks();
    const runtime = new ComputerScriptRuntime(bridge as any);

    const result = await run(
      runtime,
      "await computer.a11y(); await computer.click({ name: 'Save' }); return { ok: true };",
      hooks,
    );

    expect(result.status).toBe("completed");
    expect(bridge.request).toHaveBeenCalledWith(
      "computer_input",
      expect.objectContaining({
        action: "click_element",
        expected_generation: 7,
        element_name: "Save",
      }),
      expect.anything(),
    );
    expect(hooks.leases.peek("session-1")).toBeUndefined();
  });

  it("rejects input without an observation", async () => {
    const bridge = createBridge();
    const runtime = new ComputerScriptRuntime(bridge as any);

    const result = await run(
      runtime,
      "await computer.click({ name: 'Save' }); return { ok: true };",
      createHooks(),
    );

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("NO_OBSERVATION");
    expect(bridge.request).not.toHaveBeenCalled();
  });

  it("rejects an element click based on a screenshot observation", async () => {
    const shot = await makeScreenshotFixture();
    const bridge = createBridge({
      computer_observe: {
        image_path: shot.file,
        width: 10,
        height: 10,
        generation: 2,
      },
    });
    const runtime = new ComputerScriptRuntime(bridge as any);

    const result = await run(
      runtime,
      "await computer.screenshot(); await computer.click({ name: 'Save' }); return { ok: true };",
      createHooks(),
    );

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("WRONG_OBSERVATION_KIND");
    expect(bridge.request).not.toHaveBeenCalledWith(
      "computer_input",
      expect.anything(),
      expect.anything(),
    );

    await shot.cleanup();
  });

  it("clears the lease when the sidecar reports STALE_REFERENCE", async () => {
    const bridge = createBridge({
      computer_a11y_observe: {
        generation: 1,
        entries: [{ ref: 1, role: "button", name: "Save" }],
        text: "[1] button Save",
      },
      computer_input: () => {
        throw new BridgeRequestError("STALE_REFERENCE", "stale");
      },
    });
    const hooks = createHooks();
    const runtime = new ComputerScriptRuntime(bridge as any);

    const result = await run(
      runtime,
      "await computer.a11y(); await computer.click({ name: 'Save' }); return { ok: true };",
      hooks,
    );

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("STALE_REFERENCE");
    expect(hooks.leases.peek("session-1")).toBeUndefined();
  });

  it("aborts the script when authorization is denied", async () => {
    const bridge = createBridge({
      computer_a11y_observe: {
        generation: 1,
        entries: [{ ref: 1, role: "button", name: "Save" }],
        text: "[1] button Save",
      },
      computer_input: { message: "clicked" },
    });
    const hooks = createHooks({
      authorize: jest.fn(async (request: any) => {
        if (request.phase === "input") {
          throw new ComputerScriptError("POLICY_DENIED", "denied by test");
        }
      }),
    });
    const runtime = new ComputerScriptRuntime(bridge as any);

    const result = await run(
      runtime,
      "await computer.a11y(); await computer.click({ name: 'Save' }); return { ok: true };",
      hooks,
    );

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("POLICY_DENIED");
    expect(bridge.request).not.toHaveBeenCalledWith(
      "computer_input",
      expect.anything(),
      expect.anything(),
    );
  });

  it("blocks mutating actions in plan mode but allows observation", async () => {
    const shot = await makeScreenshotFixture();
    const bridge = createBridge({
      computer_observe: {
        image_path: shot.file,
        width: 10,
        height: 10,
        generation: 3,
      },
      computer_input: { message: "clicked" },
    });
    const hooks = createHooks({ isPlanMode: () => true });
    const runtime = new ComputerScriptRuntime(bridge as any);

    const result = await run(
      runtime,
      "await computer.screenshot(); await computer.click({ x: 1, y: 2 }); return { ok: true };",
      hooks,
    );

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("PLAN_MODE_DENIED");
    expect(bridge.request).not.toHaveBeenCalledWith(
      "computer_input",
      expect.anything(),
      expect.anything(),
    );

    await shot.cleanup();
  });

  it("excludes approval wait time from the overall timeout", async () => {
    const bridge = createBridge({
      computer_a11y_observe: {
        generation: 1,
        entries: [],
        text: "",
      },
      computer_input: { message: "typed" },
    });
    const hooks = createHooks({
      authorize: jest.fn(async (request: any) => {
        if (request.phase === "input") {
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }),
    });
    const runtime = new ComputerScriptRuntime(bridge as any);

    const result = await run(
      runtime,
      "await computer.a11y(); await computer.type('x'); return { ok: true };",
      hooks,
      1000,
    );

    expect(result.status).toBe("completed");
  });

  it("times out a runaway script", async () => {
    const bridge = createBridge();
    const runtime = new ComputerScriptRuntime(bridge as any);

    const result = await run(runtime, "while (true) {}", createHooks(), 1000);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("TIMEOUT");
  });

  it("exposes only the sandbox globals", async () => {
    const bridge = createBridge();
    const runtime = new ComputerScriptRuntime(bridge as any);

    const result = await run(
      runtime,
      "return { require: typeof require, process: typeof process, fetch: typeof fetch, computer: typeof computer };",
      createHooks(),
    );

    expect(result.status).toBe("completed");
    expect(result.value).toEqual({
      require: "undefined",
      process: "undefined",
      fetch: "undefined",
      computer: "object",
    });
  });

  it("reports an unserializable return value", async () => {
    const bridge = createBridge();
    const runtime = new ComputerScriptRuntime(bridge as any);

    const result = await run(runtime, "return () => 1;", createHooks());

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("RESULT_UNSERIALIZABLE");
  });

  it("maps pixel click options to sidecar actions", async () => {
    const shot = await makeScreenshotFixture();
    const bridge = createBridge({
      computer_observe: {
        image_path: shot.file,
        width: 10,
        height: 10,
        generation: 9,
      },
      computer_input: { message: "clicked" },
    });
    const runtime = new ComputerScriptRuntime(bridge as any);

    const result = await run(
      runtime,
      "await computer.screenshot(); await computer.click({ x: 5, y: 6, clicks: 2 }); return { ok: true };",
      createHooks(),
    );

    expect(result.status).toBe("completed");
    expect(bridge.request).toHaveBeenCalledWith(
      "computer_input",
      expect.objectContaining({
        action: "double_click",
        expected_generation: 9,
        x: 5,
        y: 6,
      }),
      expect.anything(),
    );

    await shot.cleanup();
  });

  it("returns apps without creating an observation lease", async () => {
    const bridge = createBridge({
      computer_observe: (params: any) => {
        expect(params.action).toBe("list_apps");
        return {
          apps: [{ pid: 10, name: "Notepad" }],
          text: "Notepad (pid 10)",
        };
      },
    });
    const hooks = createHooks();
    const runtime = new ComputerScriptRuntime(bridge as any);

    const result = await run(
      runtime,
      "return await computer.apps();",
      hooks,
    );

    expect(result.status).toBe("completed");
    expect(result.value).toEqual({
      apps: [{ pid: 10, name: "Notepad" }],
      text: "Notepad (pid 10)",
    });
    expect(hooks.leases.peek("session-1")).toBeUndefined();
  });

  it("enforces the action budget", async () => {
    const bridge = createBridge({
      launch_app: { ok: true, message: "launched" },
    });
    const runtime = new ComputerScriptRuntime(bridge as any);

    const result = await run(
      runtime,
      "for (let i = 0; i < 61; i += 1) { await computer.launch('C:/x.exe'); } return { ok: true };",
      createHooks(),
    );

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("ACTION_LIMIT");
    expect(bridge.request).toHaveBeenCalledTimes(60);
  });
});
