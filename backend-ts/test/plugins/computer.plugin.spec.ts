import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ComputerPlugin } from "../../src/modules/plugins/builtins/computer.plugin";
import { Toolkit } from "../../src/modules/plugins/toolkit/toolkit";
import { DEFAULT_COMPUTER_POLICY } from "../../src/modules/plugins/builtins/computer-use/policy";

interface HarnessOptions {
  enabled?: boolean;
  actions?: Record<string, string>;
  responses?: Record<string, any>;
}

async function createHarness(options?: HarnessOptions) {
  const bridgeClient = {
    request: jest.fn(async (method: string, params: any) => {
      const response = options?.responses?.[method];
      return typeof response === "function" ? response(params) : response;
    }),
  };
  const settingsStorage = {
    getSettings: jest.fn(async () => ({
      enabled: options?.enabled ?? true,
      actions: { ...DEFAULT_COMPUTER_POLICY, ...(options?.actions ?? {}) },
    })),
  };
  const askService = {
    requestComputerUseApproval: jest.fn(async () => undefined),
  };
  const sessionImages = {
    save: jest.fn(async (_sessionId: string, _data: Buffer, opts: any) => ({
      ref: {
        mediaType: "image/jpeg",
        bytes: 10,
        name: `${opts?.baseName ?? "computer-screenshot"}.jpg`,
        url: `sessions/session-1/images/${opts?.baseName ?? "computer-screenshot"}.jpg`,
        previewUrl: `sessions/session-1/previews/${opts?.baseName ?? "computer-screenshot"}.jpg`,
        fileExtension: "jpg",
        refType: "session",
      },
      absolutePath: `C:/sessions/session-1/images/${opts?.baseName ?? "computer-screenshot"}.jpg`,
    })),
  };

  const plugin = new ComputerPlugin(
    bridgeClient as any,
    settingsStorage as any,
    askService as any,
    sessionImages as any,
  );

  let toolkitDef: any;
  await plugin.onLoad({
    registerNls: () => {},
    registerToolKit: (definition: any) => {
      toolkitDef = definition;
    },
  } as any);

  const toolkit = new Toolkit(toolkitDef, "computer");
  toolkitDef.onLoad(toolkit);

  return {
    plugin,
    bridgeClient,
    settingsStorage,
    askService,
    sessionImages,
    toolkitDef,
    toolkit,
    tools: toolkit.getTools(),
    skills: toolkit.toRegistration().skills,
  };
}

function context(overrides: Record<string, any> = {}) {
  return {
    toolCallId: "call-1",
    session: {
      sessionId: "session-1",
      parentSessionId: undefined,
      workspacePath: "C:/tmp/session",
      hasAnswerSurface: () => true,
      getPlanEnabled: () => false,
      getSandboxMode: () => "workspace-write",
      getModelConfig: () => ({ config: { inputCapabilities: ["image"] } }),
      supportsFeature: () => true,
      ...overrides,
    },
  } as any;
}

function tool(tools: any[], name: string) {
  const found = tools.find((entry) => entry.name === name);
  if (!found) throw new Error(`tool ${name} is missing`);
  return found;
}

async function makeScreenshotFixture(): Promise<{
  file: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "computer-plugin-test-"));
  const file = path.join(dir, "shot.png");
  // 内容不必是合法 PNG：插件测试里 SessionImageStore 是 mock，运行时只读字节。
  await fs.writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return {
    file,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

describe("ComputerPlugin", () => {
  it("ships disabled by default as an extended plugin", async () => {
    const { plugin } = await createHarness();
    expect(plugin.manifest.category).toBe("extended");
  });

  it("registers one eager tool and the computer-use skill", async () => {
    const { tools, toolkitDef, skills } = await createHarness();

    expect(toolkitDef.loadMode).toBe("eager");
    expect(tools.map((entry) => entry.name)).toEqual(["computer_run"]);

    const run = tool(tools, "computer_run");
    expect(run.readOnly).toBe(false);
    expect(run.allowedInPlanMode).toBe(true);
    expect(run.requiresUserInteraction).toBeUndefined();
    expect(run.dangerLevel).toBe("critical");

    const skill = skills.find((entry: any) => entry.name === "computer-use");
    expect(skill).toBeTruthy();
    expect(skill.content).toContain("computer.screenshot");
    expect(skill.content).toContain("NO_OBSERVATION");
  });

  it("runs an observe-only script and returns screenshot imageRefs", async () => {
    const shot = await makeScreenshotFixture();
    const { tools, sessionImages } = await createHarness({
      responses: {
        computer_observe: {
          image_path: shot.file,
          width: 100,
          height: 50,
          generation: 1,
        },
      },
    });

    const result = await tool(tools, "computer_run").handler(
      {
        script:
          "const s = await computer.screenshot(); return { w: s.width, h: s.height, path: s.path };",
      },
      context(),
    );

    expect(result.content).toContain("Computer script completed");
    expect(result.content).toContain('"w": 100');
    expect(result.imageRefs).toHaveLength(1);
    expect(result.imageRefs[0]).toMatchObject({
      refType: "session",
      media_type: "image/jpeg",
    });
    expect(sessionImages.save).toHaveBeenCalledTimes(1);

    await shot.cleanup();
  });

  it("auto-carries the generation and asks before an input", async () => {
    const { tools, askService, bridgeClient } = await createHarness({
      actions: { click_element: "ask" },
      responses: {
        computer_a11y_observe: {
          generation: 3,
          entries: [{ ref: 2, role: "button", name: "Save" }],
          text: "[2] button Save",
        },
        computer_input: { message: "clicked" },
      },
    });

    const result = await tool(tools, "computer_run").handler(
      {
        script:
          "await computer.a11y(); await computer.click({ name: 'Save' }); return { ok: true };",
      },
      context(),
    );

    expect(result.content).toContain("Computer script completed");
    expect(askService.requestComputerUseApproval).toHaveBeenCalledTimes(1);
    expect(bridgeClient.request).toHaveBeenCalledWith(
      "computer_input",
      expect.objectContaining({
        action: "click_element",
        expected_generation: 3,
        element_name: "Save",
      }),
      expect.anything(),
    );
  });

  it("denies input before calling the sidecar and aborts the script", async () => {
    const { tools, bridgeClient } = await createHarness({
      actions: { click_element: "deny" },
      responses: {
        computer_a11y_observe: {
          generation: 1,
          entries: [{ ref: 1, role: "button", name: "Save" }],
          text: "[1] button Save",
        },
      },
    });

    await expect(
      tool(tools, "computer_run").handler(
        {
          script:
            "await computer.a11y(); await computer.click({ name: 'Save' }); return { ok: true };",
        },
        context(),
      ),
    ).rejects.toThrow(/POLICY_DENIED/);

    expect(bridgeClient.request).not.toHaveBeenCalledWith(
      "computer_input",
      expect.anything(),
      expect.anything(),
    );
  });

  it("fails closed when an ask action has no answer surface", async () => {
    const { tools, askService, bridgeClient } = await createHarness({
      actions: { click_element: "ask" },
      responses: {
        computer_a11y_observe: {
          generation: 1,
          entries: [{ ref: 1, role: "button", name: "Save" }],
          text: "[1] button Save",
        },
      },
    });

    await expect(
      tool(tools, "computer_run").handler(
        {
          script:
            "await computer.a11y(); await computer.click({ name: 'Save' }); return { ok: true };",
        },
        context({ hasAnswerSurface: () => false }),
      ),
    ).rejects.toThrow(/APPROVAL_UNAVAILABLE/);

    expect(askService.requestComputerUseApproval).not.toHaveBeenCalled();
    expect(bridgeClient.request).not.toHaveBeenCalledWith(
      "computer_input",
      expect.anything(),
      expect.anything(),
    );
  });

  it("allows observation but blocks input in plan mode", async () => {
    const firstShot = await makeScreenshotFixture();
    const secondShot = await makeScreenshotFixture();
    let shots = 0;
    const { tools, bridgeClient } = await createHarness({
      actions: { left_click: "allow" },
      responses: {
        // 运行时会删掉 sidecar 写的临时截图；两次调用需要两个独立 fixture。
        computer_observe: () => {
          const file = shots++ === 0 ? firstShot.file : secondShot.file;
          return {
            image_path: file,
            width: 100,
            height: 50,
            generation: 4 + shots,
          };
        },
      },
    });

    const observe = await tool(tools, "computer_run").handler(
      { script: "const s = await computer.screenshot(); return { w: s.width };" },
      context({ getPlanEnabled: () => true }),
    );
    expect(observe.content).toContain("Computer script completed");

    await expect(
      tool(tools, "computer_run").handler(
        {
          script:
            "await computer.screenshot(); await computer.click({ x: 1, y: 2 }); return { ok: true };",
        },
        context({ getPlanEnabled: () => true }),
      ),
    ).rejects.toThrow(/PLAN_MODE_DENIED/);

    expect(bridgeClient.request).not.toHaveBeenCalledWith(
      "computer_input",
      expect.anything(),
      expect.anything(),
    );

    await firstShot.cleanup();
    await secondShot.cleanup();
  });

  it("rejects an element click based on a screenshot observation", async () => {
    const shot = await makeScreenshotFixture();
    const { tools } = await createHarness({
      actions: { click_element: "allow" },
      responses: {
        computer_observe: {
          image_path: shot.file,
          width: 100,
          height: 50,
          generation: 5,
        },
      },
    });

    await expect(
      tool(tools, "computer_run").handler(
        {
          script:
            "await computer.screenshot(); await computer.click({ name: 'Save' }); return { ok: true };",
        },
        context(),
      ),
    ).rejects.toThrow(/WRONG_OBSERVATION_KIND/);

    await shot.cleanup();
  });

  it("applies the launch_app policy and forwards allowed launches", async () => {
    const denied = await createHarness({ actions: { launch_app: "deny" } });
    await expect(
      tool(denied.tools, "computer_run").handler(
        {
          script:
            "return await computer.launch('C:/Windows/System32/notepad.exe');",
        },
        context(),
      ),
    ).rejects.toThrow(/POLICY_DENIED/);
    expect(denied.bridgeClient.request).not.toHaveBeenCalledWith(
      "launch_app",
      expect.anything(),
      expect.anything(),
    );

    const allowed = await createHarness({
      actions: { launch_app: "allow" },
      responses: { launch_app: { ok: true, message: "Launched notepad." } },
    });
    const result = await tool(allowed.tools, "computer_run").handler(
      {
        script:
          "return await computer.launch('C:/Windows/System32/notepad.exe');",
      },
      context(),
    );
    expect(result.content).toContain("Launched notepad.");
    expect(allowed.bridgeClient.request).toHaveBeenCalledWith(
      "launch_app",
      { path: "C:/Windows/System32/notepad.exe" },
      expect.anything(),
    );
  });

  it("does not treat the settings-group enabled flag as a second hard gate", async () => {
    const shot = await makeScreenshotFixture();
    const { tools } = await createHarness({
      enabled: false,
      responses: {
        computer_observe: {
          image_path: shot.file,
          width: 1,
          height: 1,
          generation: 1,
        },
      },
    });

    const result = await tool(tools, "computer_run").handler(
      { script: "await computer.screenshot(); return { ok: true };" },
      context(),
    );
    expect(result.content).toContain("Computer script completed");

    await shot.cleanup();
  });
});
