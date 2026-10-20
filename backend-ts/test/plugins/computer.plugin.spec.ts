import { ComputerPlugin } from "../../src/modules/plugins/builtins/computer.plugin";
import { Toolkit } from "../../src/modules/plugins/toolkit/toolkit";
import { DEFAULT_COMPUTER_POLICY } from "../../src/modules/plugins/builtins/computer-use/policy";

function createHarness(options?: {
  enabled?: boolean;
  actions?: Record<string, string>;
  responses?: Record<string, any>;
}) {
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

  const plugin = new ComputerPlugin(
    bridgeClient as any,
    settingsStorage as any,
    askService as any
  );
  let toolkitDef: any;
  plugin.onLoad({
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
    tools: toolkit.getTools(),
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

describe("ComputerPlugin", () => {
  it("ships disabled by default as an extended plugin", () => {
    const { plugin } = createHarness();
    expect(plugin.manifest.category).toBe("extended");
  });

  it("registers the three lazy tools", () => {
    const { tools } = createHarness();
    expect(tools.map((entry) => entry.name).sort()).toEqual([
      "computer_a11y_observe",
      "computer_input",
      "computer_observe",
    ]);
  });

  it("returns screenshot imageRefs for multimodal sessions", async () => {
    const { tools, bridgeClient } = createHarness({
      responses: {
        computer_observe: {
          image_path: "C:/tmp/session/computer-screenshots/shot.png",
          width: 1280,
          height: 720,
          generation: 7,
        },
      },
    });

    const result = await tool(tools, "computer_observe").handler(
      { action: "screenshot" },
      context()
    );

    expect(result.imageRefs).toHaveLength(1);
    expect(result.imageRefs[0]).toMatchObject({
      url: "C:/tmp/session/computer-screenshots/shot.png",
      refType: "local",
      media_type: "image/png",
    });
    expect(bridgeClient.request).toHaveBeenCalledWith(
      "computer_observe",
      expect.objectContaining({
        action: "screenshot",
        output_path: expect.stringContaining("computer-screenshots"),
      }),
      undefined
    );
  });

  it("allows click_element under an allow policy and clears the lease afterwards", async () => {
    const { tools, bridgeClient, askService } = createHarness({
      actions: { click_element: "allow" },
      responses: {
        computer_a11y_observe: {
          generation: 3,
          entries: [{ ref: 1, role: "button" }],
          text: "[1] button",
        },
        computer_input: { message: "clicked" },
      },
    });

    await tool(tools, "computer_a11y_observe").handler({}, context());
    const input = tool(tools, "computer_input");
    const result = await input.handler(
      { action: "click_element", expected_generation: 3, ref: 1 },
      context()
    );

    expect(result).toContain("clicked");
    expect(askService.requestComputerUseApproval).not.toHaveBeenCalled();
    expect(bridgeClient.request).toHaveBeenCalledWith(
      "computer_input",
      expect.objectContaining({
        action: "click_element",
        expected_generation: 3,
        ref: 1,
      }),
      undefined
    );

    await expect(
      input.handler({ action: "click_element", expected_generation: 3, ref: 1 }, context())
    ).rejects.toThrow(/No computer observation|Stale observation/);
  });

  it("asks before input when the policy is ask", async () => {
    const { tools, askService } = createHarness({
      actions: { click_element: "ask" },
      responses: {
        computer_a11y_observe: {
          generation: 1,
          entries: [{ ref: 2, role: "button" }],
          text: "[2] button",
        },
        computer_input: { message: "clicked" },
      },
    });

    await tool(tools, "computer_a11y_observe").handler({}, context());
    await tool(tools, "computer_input").handler(
      { action: "click_element", expected_generation: 1, ref: 2 },
      context()
    );

    expect(askService.requestComputerUseApproval).toHaveBeenCalledTimes(1);
    expect(askService.requestComputerUseApproval).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1" }),
      expect.objectContaining({ toolName: "computer_input" })
    );
  });

  it("denies input before calling the sidecar when policy is deny", async () => {
    const { tools, bridgeClient } = createHarness({
      actions: { click_element: "deny" },
      responses: {
        computer_a11y_observe: {
          generation: 1,
          entries: [{ ref: 1, role: "button" }],
          text: "[1] button",
        },
      },
    });

    await tool(tools, "computer_a11y_observe").handler({}, context());
    await expect(
      tool(tools, "computer_input").handler(
        { action: "click_element", expected_generation: 1, ref: 1 },
        context()
      )
    ).rejects.toThrow(/denies/);
    expect(bridgeClient.request).not.toHaveBeenCalledWith(
      "computer_input",
      expect.anything(),
      expect.anything()
    );
  });

  it("rejects a screenshot lease for an element click", async () => {
    const { tools } = createHarness({
      actions: { click_element: "allow" },
      responses: {
        computer_observe: {
          image_path: "C:/tmp/session/shot.png",
          width: 100,
          height: 50,
          generation: 4,
        },
      },
    });

    await tool(tools, "computer_observe").handler({ action: "screenshot" }, context());
    await expect(
      tool(tools, "computer_input").handler(
        { action: "click_element", expected_generation: 4, ref: 1 },
        context()
      )
    ).rejects.toThrow(/requires a accessibility observation/);
  });

  it("does not treat the settings-group enabled flag as a second hard gate", async () => {
    // Runtime gates are the plugin master switch and the agent toolkit switch.
    // The settings group stores the UI switch state and action policy; a stale
    // or missing "enabled" flag must not block a reachable tool call.
    const { tools, bridgeClient } = createHarness({
      enabled: false,
      responses: {
        computer_observe: {
          generation: 9,
          windows: [],
          text: "Windows (front to back):\nNo windows found.\n",
        },
      },
    });

    const result = await tool(tools, "computer_observe").handler(
      { action: "list_windows" },
      context()
    );

    expect(result).toContain("Generation: 9");
    expect(bridgeClient.request).toHaveBeenCalledWith(
      "computer_observe",
      { action: "list_windows" },
      undefined
    );
  });
});
