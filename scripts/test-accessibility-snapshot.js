const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  buildSimpleAccessibilityTree,
  buildSimpleTreeFromLegacyStruct,
  captureAccessibilitySnapshot,
} = require("../electron/dist/accessibility-snapshot.js");

function ax(nodeId, role, name, childIds = [], extra = {}) {
  return {
    nodeId,
    role: { value: role },
    name: { value: name || "" },
    childIds,
    ...extra,
  };
}

test("flattens ignored and anonymous generic containers", () => {
  const result = buildSimpleAccessibilityTree([
    ax("root", "RootWebArea", "Demo", ["generic"]),
    ax("generic", "generic", "", ["ignored"]),
    { ...ax("ignored", "generic", "", ["link"]), ignored: true },
    ax("link", "link", "Home", [], { backendDOMNodeId: 10 }),
  ]);

  assert.equal(result.tree.role, "document");
  assert.equal(result.tree.name, "Demo");
  assert.equal(result.tree.children.length, 1);
  assert.deepEqual(result.tree.children[0], {
    role: "link",
    name: "Home",
    ref: "e0",
  });
  assert.deepEqual(result.refTargets, [{ ref: "e0", backendDOMNodeId: 10 }]);
  assert.equal(result.stats.maxDepth, 1);
});

test("assigns refs only to interactive nodes with DOM backing", () => {
  const result = buildSimpleAccessibilityTree([
    ax("root", "RootWebArea", "Demo", ["heading", "button", "virtual"]),
    ax("heading", "heading", "News"),
    ax("button", "button", "Submit", [], { backendDOMNodeId: 20 }),
    ax("virtual", "button", "Virtual"),
  ]);

  assert.equal(result.tree.children[0].ref, undefined);
  assert.equal(result.tree.children[1].ref, "e0");
  assert.equal(result.tree.children[2].ref, undefined);
  assert.equal(result.stats.interactiveNodeCount, 1);
});

test("preserves visible prose without InlineTextBox duplication", () => {
  const result = buildSimpleAccessibilityTree([
    ax("root", "RootWebArea", "Demo", ["paragraph"]),
    ax("paragraph", "paragraph", "", ["text"]),
    ax("text", "StaticText", "Visible paragraph", ["inline"]),
    ax("inline", "InlineTextBox", "Visible paragraph"),
  ]);

  assert.deepEqual(result.tree.children, [
    { role: "text", name: "Visible paragraph" },
  ]);
});

test("keeps composite control descendants", () => {
  const result = buildSimpleAccessibilityTree([
    ax("root", "RootWebArea", "Demo", ["listbox"]),
    ax("listbox", "listbox", "Theme", ["light", "dark"], {
      backendDOMNodeId: 20,
    }),
    ax("light", "option", "Light", [], { backendDOMNodeId: 21 }),
    ax("dark", "option", "Dark", [], { backendDOMNodeId: 22 }),
  ]);

  assert.equal(result.tree.children[0].role, "listbox");
  assert.deepEqual(
    result.tree.children[0].children.map((node) => node.name),
    ["Light", "Dark"],
  );
});

test("keeps unlabeled DOM-backed controls as interactable refs", () => {
  const result = buildSimpleAccessibilityTree([
    ax("root", "RootWebArea", "Demo", ["button"]),
    ax("button", "button", "", [], { backendDOMNodeId: 25 }),
  ]);

  assert.deepEqual(result.tree.children, [{ role: "button", ref: "e0" }]);
});

test("preserves concise interactive state", () => {
  const result = buildSimpleAccessibilityTree([
    ax("root", "RootWebArea", "Demo", ["check", "select"]),
    ax("check", "checkbox", "Remember", [], {
      backendDOMNodeId: 30,
      properties: [
        { name: "checked", value: { value: true } },
        { name: "disabled", value: { value: false } },
      ],
    }),
    {
      ...ax("select", "combobox", "Theme", [], { backendDOMNodeId: 31 }),
      value: { value: "Dark" },
      properties: [{ name: "expanded", value: { value: false } }],
    },
  ]);

  assert.equal(result.tree.children[0].checked, true);
  assert.equal(result.tree.children[0].disabled, false);
  assert.equal(result.tree.children[1].value, "Dark");
  assert.equal(result.tree.children[1].expanded, false);
});

test("limits emitted nodes and reports omission", () => {
  const links = Array.from({ length: 5 }, (_, i) =>
    ax(`l${i}`, "link", `Link ${i}`, [], { backendDOMNodeId: 100 + i }),
  );
  const result = buildSimpleAccessibilityTree(
    [ax("root", "RootWebArea", "Demo", links.map((n) => n.nodeId)), ...links],
    { maxNodes: 3 },
  );

  assert.ok(result.stats.omittedNodeCount > 0);
  assert.equal(result.tree.children.at(-1).role, "omitted");
});

test("enforces a snapshot-wide CDP deadline and releases its debugger", async () => {
  class FakeDebugger extends EventEmitter {
    attached = false;
    isAttached() {
      return this.attached;
    }
    attach() {
      this.attached = true;
    }
    detach() {
      this.attached = false;
      this.emit("detach");
    }
    sendCommand(method) {
      if (method === "Accessibility.enable") return Promise.resolve({});
      if (method === "Accessibility.disable") return Promise.resolve({});
      return new Promise(() => {});
    }
  }
  const fakeDebugger = new FakeDebugger();
  const webContents = {
    debugger: fakeDebugger,
    executeJavaScript: async () => undefined,
  };
  const startedAt = Date.now();

  await assert.rejects(
    captureAccessibilitySnapshot(webContents, { commandTimeoutMs: 25 }),
    /snapshot deadline|timed out/,
  );
  assert.ok(Date.now() - startedAt < 250);
  assert.equal(fakeDebugger.isAttached(), false);
});

test("compresses legacy DOM struct for CDP fallback", () => {
  const result = buildSimpleTreeFromLegacyStruct({
    role: "body",
    ref: "e0",
    children: [
      {
        role: "div",
        ref: "e1",
        children: [
          { role: "link", ref: "e2", text: "Home" },
          { role: "button", ref: "e3", text: "Submit" },
        ],
      },
    ],
  });

  assert.equal(result.role, "document");
  assert.equal(result.ref, "root");
  assert.deepEqual(result.children, [
    { role: "link", name: "Home", ref: "e2" },
    { role: "button", name: "Submit", ref: "e3" },
  ]);
});
