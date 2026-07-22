import * as yaml from "js-yaml";
import { BrowserPlugin } from "../../src/modules/plugins/builtins/browser.plugin";
import { Toolkit } from "../../src/modules/plugins/toolkit/toolkit";

function createPlugin(bridgeResponses: Record<string, any>) {
  const bridgeClient = {
    request: jest.fn(async (method: string, params: any) => {
      const response = bridgeResponses[method];
      return typeof response === "function" ? response(params) : response;
    }),
  };
  const workspaceService = {
    resolveFilePath: (filePath: string) => filePath,
  };
  const plugin = new BrowserPlugin(workspaceService as any, bridgeClient as any);
  let toolkitDef: any;
  plugin.onLoad({
    registerToolKit: (def: any) => {
      toolkitDef = def;
    },
  } as any);
  const toolkit = new Toolkit(toolkitDef, "browser");
  toolkitDef.onLoad(toolkit);
  return { plugin, bridgeClient, tools: toolkit.getTools() };
}

function context() {
  return {
    session: {
      sessionId: "session-1",
      parentSessionId: undefined,
      workspacePath: "C:/tmp/session",
    },
  } as any;
}

describe("BrowserPlugin snapshot contract", () => {
  it("exposes simple, struct and summary snapshot types", () => {
    const { tools } = createPlugin({});
    const snapshot = tools.find((tool) => tool.name === "browser_snapshot")!;
    const type = snapshot.parameters.properties.type;
    expect(type.enum).toEqual(["simple", "struct", "summary"]);
  });

  it("uses simple as browser_navigate default and formats it as YAML", async () => {
    const { tools, bridgeClient } = createPlugin({
      browser_navigate: {
        success: true,
        tab_id: "win_1",
      },
      browser_snapshot: {
        success: true,
        type: "simple",
        snapshot: {
          role: "document",
          name: "Demo",
          ref: "root",
          children: [{ role: "button", name: "Submit", ref: "e0" }],
        },
      },
      browser_tabs: {
        success: true,
        tabs: [
          {
            title: "Demo",
            url: "https://example.com",
            is_current: true,
          },
        ],
      },
    });
    const navigate = tools.find((tool) => tool.name === "browser_navigate")!;
    const output = await navigate.handler(
      { url: "https://example.com", load_delay: 0 },
      context(),
    );

    expect(bridgeClient.request).toHaveBeenCalledWith(
      "browser_snapshot",
      expect.objectContaining({ type: "simple" }),
    );
    expect(output).toContain("Tabs:");
    expect(output).toContain("role: document");
    expect(output).toContain("name: Submit");
    expect(output).not.toContain("success:");
  });

  it("formats struct as JSON without service metadata", async () => {
    const { tools } = createPlugin({
      browser_snapshot: {
        success: true,
        type: "struct",
        windowId: "win_1",
        url: "https://example.com",
        title: "Demo",
        struct: {
          role: "document",
          ref: "e0",
          children: [{ role: "button", text: "Submit", ref: "e1" }],
        },
      },
    });
    const snapshot = tools.find((tool) => tool.name === "browser_snapshot")!;
    const output = await snapshot.handler({ type: "struct" }, context());
    const parsed = JSON.parse(output);

    expect(parsed.role).toBe("document");
    expect(parsed.children[0].text).toBe("Submit");
    expect(parsed.success).toBeUndefined();
    expect(parsed.url).toBeUndefined();
  });

  it("keeps summary output behavior", async () => {
    const { tools } = createPlugin({
      browser_snapshot: {
        success: true,
        type: "summary",
        title: "Demo",
        url: "https://example.com",
        text: "Main content",
        headings: [{ level: 1, text: "Heading" }],
        links: [{ text: "Home", href: "/" }],
      },
    });
    const snapshot = tools.find((tool) => tool.name === "browser_snapshot")!;
    const output = await snapshot.handler({ type: "summary" }, context());

    expect(output).toContain("--- Page Text ---");
    expect(output).toContain("Main content");
    expect(output).toContain("H1: Heading");
    expect(output).toContain("[Home] -> /");
    expect(output).not.toContain("Title: Demo");
  });

  it("rejects input interactions without a value before sending bridge request", async () => {
    const { tools, bridgeClient } = createPlugin({});
    const interact = tools.find((tool) => tool.name === "browser_interact")!;

    await expect(
      interact.handler({ action: "input", selector: "e0" }, context()),
    ).rejects.toThrow("value is required when action is input");
    expect(bridgeClient.request).not.toHaveBeenCalled();
  });

  it("returns valid simple YAML for direct snapshot calls", async () => {
    const { tools } = createPlugin({
      browser_snapshot: {
        success: true,
        type: "simple",
        snapshot: { role: "document", ref: "root" },
      },
    });
    const snapshot = tools.find((tool) => tool.name === "browser_snapshot")!;
    const output = await snapshot.handler({}, context());
    expect(yaml.load(output)).toEqual({ role: "document", ref: "root" });
  });
});
